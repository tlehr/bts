'use strict';

const { cmp_scheduled_match_order, get_location_preparation_display_window } = require('../match_automation');
const { prepare, renderer, prepare_waiting_tabletoperators } = require('./text');
const OPEN = new Set(['oncourt', 'preparation', 'scheduled', 'ready', 'incomplete', 'blocked']);

function isOpen(match) {
    return !!match?.setup && match.setup.is_match !== false && OPEN.has(match.setup.state) &&
        typeof match.team1_won !== 'boolean' && match.score_status !== 'no_match';
}

function tier(match, preferred = new Set()) {
    const setup = match.setup;
    if (setup.state === 'oncourt' || setup.court_id && setup.now_on_court) return 0;
    if (setup.state === 'preparation') return 1;
    return preferred.has(match._id) ? 2 : 3;
}

function isRequired(match) { return isOpen(match) && tier(match) < 2; }

function callCandidates(tournament, matches, options = {}) {
    // Audio can be prepared while players are busy or resting. Reuse the UI's
    // call boundary, then require known participants rather than call readiness
    // or a vacant place in the preparation queue.
    const context = { ...tournament, matches }, candidates = new Map();
    const locations = tournament.locations?.length ? tournament.locations.map(location => location._id) : [null];
    for (const location of locations) {
        const { display_relevant_matches, display_cutoff } = get_location_preparation_display_window(context, location, options);
        if (!display_cutoff) continue;
        for (const match of display_relevant_matches) {
            const setup = match.setup;
            if (!isOpen(match) || tier(match) < 2 || setup.now_on_court || setup.incomplete ||
                cmp_scheduled_match_order(match, display_cutoff) > 0) continue;
            if (!Array.isArray(setup.teams) || setup.teams.length !== 2 || !setup.teams.every(team =>
                Array.isArray(team?.players) && team.players.length >= (setup.is_doubles ? 2 : 1) &&
                team.players.every(player => player?.name?.trim()))) continue;
            candidates.set(match._id, match);
        }
    }
    return [...candidates.values()].sort(cmp_scheduled_match_order).map(match => match._id);
}

function compare(a, b, preferred) {
    const group = tier(a, preferred), difference = group - tier(b, preferred);
    if (difference) return difference;
    const field = group === 0 ? 'called_timestamp' : group === 1 ? 'preparation_call_timestamp' : null;
    if (field) {
        const timestamp = match => {
            const value = match.setup[field];
            return value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : Infinity;
        };
        const time_difference = timestamp(a) - timestamp(b);
        if (time_difference) return time_difference;
    }
    return cmp_scheduled_match_order(a, b) || String(a._id).localeCompare(String(b._id));
}

function matchParts(tournament, match) {
    return prepare(tournament, [match], 'de', { shared: false, tablet_candidates: true });
}

function requiredPlan(tournament, matches, umpires = []) {
    const tablet_waiting = [];
    prepare_waiting_tabletoperators(renderer(tournament, 'de', tablet_waiting), tournament);
    const named = person => !!person?.name?.trim();
    const has_officials = umpires.some(named) || matches.some(match => named(match.setup?.umpire) || named(match.setup?.service_judge));
    const games = new Map();
    for (const match of matches.filter(isRequired).sort(compare)) {
        games.set(match._id, { match: { _id: match._id, setup: match.setup }, parts: matchParts(tournament, match) });
    }
    if (tournament.speech?.context_version === 'bts-context-v2') {
        const inventory = require('./v2_inventory');
        return { games, has_officials, tablet_waiting, shared: inventory.bootstrap(tournament), officials: inventory.officials(tournament, umpires) };
    }
    return { games, has_officials, tablet_waiting, shared: prepare(tournament, [], 'de', { waiting: false }) };
}

function requiredParts(plan) {
    const games = [...plan.games.values()].sort((a, b) => compare(a.match, b.match));
    return [...new Set([...plan.shared, ...(plan.officials || []),
        ...(plan.tablet_waiting || []), ...games.flatMap(game => game.parts)])];
}

module.exports = { isOpen, isRequired, tier, compare, matchParts, requiredPlan, requiredParts, callCandidates };
