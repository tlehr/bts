'use strict';

const { renderer, prepare_tabletoperators, tabletoperator_groups } = require('./text');
const { cmp_scheduled_match_order } = require('../match_automation');

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
    const assigned = match => !!(match.setup.court_id && match.setup.now_on_court);
    const open = matches.filter(match => match.setup && match.setup.is_match !== false &&
        OPEN.has(match.setup.state) && typeof match.team1_won !== 'boolean' && match.score_status !== 'no_match')
        // Mirror the unassigned list: a preparation/candidate flag must not
        // move a later game ahead of the earlier scheduled games. Known teams
        // from unresolved pairings keep their game's position too.
        .sort((a, b) => Number(assigned(a)) - Number(assigned(b)) || cmp_scheduled_match_order(a, b) ||
            String(a._id).localeCompare(String(b._id)));
    const active = new Set(open.filter(match => ['oncourt', 'preparation'].includes(match.setup.state) || preferred.has(match._id))
        .map(match => discipline(match.setup)).filter(Boolean));
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
