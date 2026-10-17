'use strict';

const { cmp_scheduled_match_order } = require('../match_automation');
const { prepare } = require('./text');
const OPEN = new Set(['oncourt', 'preparation', 'scheduled', 'ready', 'incomplete']);

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

function requiredPlan(tournament, matches) {
    const games = new Map();
    for (const match of matches.filter(isRequired).sort(compare)) {
        games.set(match._id, { match: { _id: match._id, setup: match.setup }, parts: matchParts(tournament, match) });
    }
    return { games, shared: prepare(tournament, [], 'de', { waiting: false }) };
}

function requiredParts(plan) {
    const games = [...plan.games.values()].sort((a, b) => compare(a.match, b.match));
    return [...new Set([...plan.shared, ...games.flatMap(game => game.parts)])];
}

module.exports = { isOpen, isRequired, tier, compare, matchParts, requiredPlan, requiredParts };
