'use strict';

const { renderer, prepare_tabletoperators, tabletoperator_groups } = require('./text');

const OPEN = new Set(['oncourt', 'preparation', 'scheduled', 'ready', 'incomplete']);

// Keep this inventory separate from the work queue. The broker admits one
// playback piece (and its source) only after all ordinary work is finished.
async function idlePlan(tournament, matches, umpires = [], preferred_ids = []) {
    const preferred = new Set(preferred_ids), stages = new Map();
    const events = tournament.events?.events || [];
    const eventKey = event => 'event:' + (event.id ?? event.name);
    for (const event of events) for (const stage of event.stages || []) {
        if (stage.id != null) stages.set(String(stage.id), eventKey(event));
    }
    const named = [...events].filter(event => event.name).sort((a, b) => b.name.length - a.name.length);
    const discipline = setup => {
        if (setup.stage_id != null && stages.has(String(setup.stage_id))) return stages.get(String(setup.stage_id));
        const name = String(setup.event_name || '').trim();
        const event = named.find(event => name === event.name || name.startsWith(event.name + ' '));
        return event ? eventKey(event) : name ? 'name:' + name.split(/\s+-\s+/)[0] : null;
    };
    const rank = match => match.setup.state === 'oncourt' ? 0 : match.setup.state === 'preparation' ? 1 :
        preferred.has(match._id) ? 2 : 3;
    const complete = match => match.setup.teams?.length >= 2 && match.setup.teams.slice(0, 2)
        .every(team => team.players?.length && team.players.every(player => player.name?.trim()));
    const open = matches.filter(match => match.setup && match.setup.is_match !== false &&
        OPEN.has(match.setup.state) && typeof match.team1_won !== 'boolean' && match.score_status !== 'no_match')
        .sort((a, b) => rank(a) - rank(b) ||
            Number(!complete(a)) - Number(!complete(b)) ||
            String(a.setup.scheduled_date || '').localeCompare(String(b.setup.scheduled_date || '')) ||
            String(a.setup.scheduled_time_str || '').localeCompare(String(b.setup.scheduled_time_str || '')) ||
            Number(a.setup.match_num || 0) - Number(b.setup.match_num || 0) || String(a._id).localeCompare(String(b._id)));
    const active = new Set(open.filter(match => rank(match) < 3).map(match => discipline(match.setup)).filter(Boolean));
    // At a quiet tournament start, warm the next discipline, not every later
    // discipline merely because it already has entries in BTP.
    if (!active.size && open.length && discipline(open[0].setup)) active.add(discipline(open[0].setup));
    const parts = [], texts = renderer(tournament, 'de', parts);
    let work = 0;
    const yieldWork = async () => { if (++work % 16 === 0) await new Promise(resolve => setImmediate(resolve)); };
    const addTeams = setup => prepare_tabletoperators(texts, tournament, setup, tabletoperator_groups(tournament, setup));
    for (const match of open) if (active.has(discipline(match.setup))) {
        await yieldWork();
        addTeams(match.setup);
    }
    // Teams with a known next game come first. Registered teams without a
    // resolved opponent still supply useful tablet/board announcements.
    const active_order = [...active];
    const active_events = events.filter(event => active.has(eventKey(event)))
        .sort((a, b) => active_order.indexOf(eventKey(a)) - active_order.indexOf(eventKey(b)));
    for (const event of active_events) for (const stage of event.stages || []) {
        for (const entry of stage.entries || []) {
            await yieldWork();
            if (entry.team) addTeams({ teams: [entry.team] });
        }
    }
    // Unassigned officials are useful reserve too; assigned officials are
    // already in the ordinary game plans. Use the same context recipes.
    for (const official of umpires) {
        await yieldWork();
        if (!official.name?.trim()) continue;
        for (const [role, suffix] of [['umpire', 'Umpire'], ['service_judge', 'ServiceJudge']]) {
            const setup = { [role]: official };
            texts['announceSecondCall' + suffix](setup);
            texts['announceSecondPreparationCall' + suffix](setup);
            for (const location of tournament.locations || []) {
                texts['announceSecondPreparationCall' + suffix]({ ...setup, location_id: location._id });
            }
        }
    }
    return [...new Set(parts)];
}

module.exports = idlePlan;
