'use strict';

const { renderer, prepare_tabletoperators, prepare_waiting_tabletoperators, tabletoperator_groups,
    potential_tabletoperator_groups, prepare } = require('./text');
const { isOpen, tier, compare } = require('./planning');
const inventory = require('./v2_inventory');
const contextPlan = require('../../static/js/speech_context');
const { cmp_scheduled_match_order } = require('../match_automation');

// Keep this inventory separate from the work queue. The broker admits one
// playback piece (and its source) only after all ordinary work is finished.
async function idlePlan(tournament, matches, umpires = [], preferred_ids = [], onStage) {
    const preferred = new Set(preferred_ids), stages = new Map();
    const events = tournament.events?.events || [];
    const eventKey = event => 'event:' + (event.id ?? event.key ?? event.name);
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
    const open = matches.filter(isOpen).sort((a, b) => compare(a, b, preferred));
    const active = new Set(open.filter(match => tier(match, preferred) < 3)
        .map(match => discipline(match.setup)).filter(Boolean));
    // Imminent games keep their tablet teams in the earlier game tier.
    // Additional eligible disciplines follow in the tablet reserve below.
    if (!active.size && open.length && discipline(open[0].setup)) active.add(discipline(open[0].setup));
    const v2 = tournament.speech?.context_version === 'bts-context-v2';
    const parts = [], texts = renderer(tournament, 'de', parts);
    const record = (stage, action) => {
        const start = parts.length;
        const detail = action();
        if (onStage) onStage(stage, parts.slice(start), detail);
    };
    let work = 0;
    const yieldWork = async () => { if (++work % 16 === 0) await new Promise(resolve => setImmediate(resolve)); };
    const addTeams = setup => prepare_tabletoperators(texts, tournament, setup, tabletoperator_groups(tournament, setup));
    record('tablet_waiting', () => prepare_waiting_tabletoperators(texts, tournament));
    for (const match of open) {
        await yieldWork();
        // Future game blocks, assigned officials and hall variants are reserve
        // too. Shared court/common pieces already belong to the required plan.
        const stage = ['oncourt', 'preparation', 'candidate', 'planned'][tier(match, preferred)];
        record(stage, () => {
            parts.push(...prepare(tournament, [match], 'de', { shared: false }));
            if (active.has(discipline(match.setup)) && (!v2 || tier(match, preferred) < 3)) addTeams(match.setup);
        });
    }
    // A discipline stays eligible from completed check-in until all its real
    // games finish. Missing games after drawing do not prove completion.
    const drawn = new Set(events.filter(event => event.is_drawn === true || Number(event.match_count || 0) > 0).map(eventKey));
    const finished = new Map();
    for (const match of matches) {
        if (!match.setup || match.setup.is_match === false) continue;
        const key = discipline(match.setup);
        if (!key) continue;
        drawn.add(key);
        const done = match.setup.state === 'finished' || typeof match.team1_won === 'boolean' || match.score_status === 'no_match';
        finished.set(key, (finished.get(key) ?? true) && done);
    }
    const reserve = new Set([...finished].filter(([, done]) => !done).map(([key]) => key));
    const reserve_events = events.filter(event => finished.get(eventKey(event)) !== true &&
        (reserve.has(eventKey(event)) || event.is_drawn === true || Number(event.match_count || 0) > 0 || inventory.registrationCompleted(tournament, event)));
    for (const event of reserve_events) reserve.add(eventKey(event));
    const mainStage = stage => Number(stage.stage_type) === 1 ||
        /hauptfeld|main/i.test([stage.name, stage.stage_name].filter(Boolean).join(' ')) ||
        stage.stage_type == null && !stage.name && !stage.stage_name;
    const attendance = new Map();
    const addPresent = (present, player) => {
        if (player?.btp_id != null) present.add('id:' + player.btp_id);
        if (player?.name?.trim()) present.add('name:' + player.name.trim());
    };
    for (const event of reserve_events) {
        const present = new Set();
        attendance.set(eventKey(event), present);
        const isDrawn = drawn.has(eventKey(event));
        for (const stage of event.stages || []) {
            if (isDrawn && !mainStage(stage)) continue;
            for (const entry of stage.entries || []) {
                await yieldWork();
                for (const [index, player] of (entry.team?.players || []).entries()) {
                    if (!isDrawn && inventory.registrationStatus(tournament, entry, player, index) !== 'present') continue;
                    addPresent(present, player);
                }
            }
        }
    }
    // A draw establishes attendance for speech preparation, including imported
    // draws with no local check-in. Actual match players cover missing rosters.
    for (const match of matches) {
        if (!match.setup || match.setup.is_match === false) continue;
        const present = attendance.get(discipline(match.setup));
        if (!present) continue;
        for (const team of match.setup.teams || []) for (const player of team.players || []) addPresent(present, player);
    }
    const reserveSetup = (setup, key) => {
        const present = attendance.get(key);
        const teams = (setup.teams || []).flatMap(team => {
            const players = (team?.players || []).filter(player => present?.has(player?.btp_id != null ? 'id:' + player.btp_id : 'name:' + player?.name?.trim()));
            return players.length ? [{ ...team, players, all_present: players.length === team.players.length }] : [];
        });
        return { ...setup, teams };
    };
    const planned = new Map(reserve_events.map(event => [eventKey(event), { event, requests: [],
        numbers: v2 ? inventory.firstRoundNumbers(tournament, event) : [], info: {
        id: inventory.eventKey(event), name: event.name || 'Unbenannte Disziplin', btp_order: events.indexOf(event) + 1,
    } }]));
    const collectTablet = (setup, key, match) => planned.get(key)?.requests.push({ setup: reserveSetup(setup, key), match });
    const nameCache = new Map();
    const warmName = players => {
        if (!players.length || players.some(player => !player?.name?.trim())) return;
        const key = JSON.stringify(players.map(player => player.name));
        if (!nameCache.has(key)) nameCache.set(key, contextPlan(texts, tournament, 'prepareName', { players }).parts);
        parts.push(...nameCache.get(key));
    };
    const recordTablet = ({ setup, match }, event, phase) => record('tablet', () => {
        const players = setup.teams.flatMap(team => team.players);
        if (v2) {
            if (phase !== 'people') {
                const names = new Set(players.map(player => player[phase === 'states' ? 'state' : 'club']).filter(name => name?.trim()));
                for (const name of names) warmName([{ name }]);
            } else {
                for (const player of players) warmName([player]);
                for (const team of setup.teams) if (team.all_present && team.players.length > 1) warmName(team.players);
            }
        }
        if (tournament.tabletoperator_enabled === true) {
            const byState = tournament.tabletoperator_with_state_enabled || tournament.tabletoperator_with_state_from_match_enabled;
            const individual = tournament.tabletoperator_split_doubles || byState;
            if (phase === (v2 && byState ? 'states' : 'people')) {
                addTeams({ ...setup, teams: setup.teams.filter(team => individual || team.all_present) });
            }
        }
        return { tablet_phase: phase, tablet_event: event.info, tablet_game: match ? {
            id: match._id, number: setup.match_num, time: [setup.scheduled_date, setup.scheduled_time_str].filter(Boolean).join(' '),
        } : null };
    });
    // Keep next-game order within each discipline, then its remaining entries.
    for (const match of open) if (reserve.has(discipline(match.setup)) && tier(match, preferred) === 3) collectTablet(match.setup, discipline(match.setup), match);
    for (const event of reserve_events) for (const stage of event.stages || []) {
        if (drawn.has(eventKey(event)) && !mainStage(stage)) continue;
        for (const entry of stage.entries || []) {
            await yieldWork();
            if (entry.team) collectTablet({ teams: [entry.team] }, eventKey(event));
        }
    }
    const nextGames = new Map();
    for (const match of [...open].sort((a, b) => Number(tier(a, preferred) === 0) - Number(tier(b, preferred) === 0) || cmp_scheduled_match_order(a, b))) {
        const key = discipline(match.setup);
        if (!nextGames.has(key)) nextGames.set(key, match);
    }
    for (const [key, row] of planned) {
        const next = nextGames.get(key);
        const first = row.event.first_planned_match;
        row.order_game = next || (first ? { setup: { match_num: first.number, scheduled_date: first.date,
            scheduled_time_str: first.time }, match_order: first.order } : null);
        if (next) row.info.next_game = { id: next._id, number: next.setup.match_num,
            time: [next.setup.scheduled_date, next.setup.scheduled_time_str].filter(Boolean).join(' ') };
        else if (first) row.info.first_game = first;
        if (!row.requests.length) collectTablet({}, key);
    }
    const disciplines = [...planned.values()].sort((a, b) =>
        (a.order_game && b.order_game ? cmp_scheduled_match_order(a.order_game, b.order_game) : a.order_game ? -1 : b.order_game ? 1 : 0) ||
        a.info.btp_order - b.info.btp_order);
    // Finish each discipline's federations, clubs, present players/pairs and
    // first-round numbers before the next. Shared recipes keep their first owner.
    for (const event of disciplines) {
        const labels = { state: new Set(), club: new Set(), player: new Set(), pair: new Set(), team: new Set() };
        for (const request of event.requests) {
            await yieldWork();
            for (const team of request.setup.teams) {
                for (const player of team.players) {
                    if (player.name?.trim()) labels.player.add(player.btp_id != null ? 'id:' + player.btp_id : 'name:' + player.name.trim());
                    for (const kind of ['state', 'club']) if (player[kind]?.trim()) labels[kind].add(player[kind].trim());
                }
                if (team.all_present && team.players.length && team.players.every(player => player.name?.trim())) {
                    const identity = JSON.stringify(team.players.map(player => player.btp_id != null ? 'id:' + player.btp_id : 'name:' + player.name.trim()).sort());
                    labels.team.add(identity);
                    if (team.players.length > 1) labels.pair.add(identity);
                }
            }
        }
        event.info.counts = Object.fromEntries(Object.entries(labels).map(([kind, values]) => [kind, values.size]));
        event.info.counts.number = event.numbers.length;
        for (const phase of ['states', 'clubs', 'people']) for (const request of event.requests) {
            await yieldWork();
            recordTablet(request, event, phase);
        }
        if (v2) record('tablet', () => {
            for (const number of event.numbers) {
                parts.push(...contextPlan(texts, tournament, 'prepareMatchNumber', { match_num: number }).parts);
            }
            return { tablet_phase: 'numbers', tablet_event: event.info };
        });
    }
    // Other disciplines follow candidates, scheduled games and the additional
    // tablet reserve of eligible disciplines, even when no games remain open.
    if (v2) record('registration_reserve', () => {
        const trace = onStage ? {} : null;
        parts.push(...inventory.registration(tournament, matches, null, trace));
        return trace;
    });
    // Unassigned officials are useful reserve too; assigned officials are
    // already in the ordinary game plans. Use the same context recipes.
    for (const official of v2 ? [] : umpires) {
        await yieldWork();
        if (!official.name?.trim()) continue;
        for (const [role, suffix] of [['umpire', 'Umpire'], ['service_judge', 'ServiceJudge']]) {
            const setup = { [role]: official };
            record('officials', () => {
                texts['announceSecondCall' + suffix](setup);
                texts['announceSecondPreparationCall' + suffix](setup);
                for (const location of tournament.locations || []) {
                    texts['announceSecondPreparationCall' + suffix]({ ...setup, location_id: location._id });
                }
            });
        }
    }
    // Last, cover every remaining known person/pairing, including other
    // disciplines and completed games. Existing recipes keep their earlier
    // position, and cached recordings never cause a new synthesis request.
    for (const group of potential_tabletoperator_groups(tournament, matches)) {
        await yieldWork();
        record('people', () => prepare_tabletoperators(texts, tournament, {}, [group]));
    }
    return [...new Set(parts)];
}

module.exports = idlePlan;
