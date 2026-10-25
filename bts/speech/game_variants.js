'use strict';

const contextPlan = require('../../static/js/speech_context');

const known = (team, count) => team?.players?.length >= count && team.players.every(player => player?.name?.trim());

// V2 names are independent of the opponent and match header. A complete
// discipline roster is a safe superset; no bracket prediction is required.
class ParticipantPools {
    constructor(tournament, matches, texts) {
        this.tournament = tournament; this.matches = matches; this.texts = texts;
        this.events = new Map(); this.stages = new Map(); this.pools = new Map();
        for (const event of tournament.events?.events || []) {
            this.events.set(event.name, event);
            for (const stage of event.stages || []) if (stage.id != null) this.stages.set(String(stage.id), event);
        }
    }

    event(setup) { return this.stages.get(String(setup.stage_id)) || this.events.get(setup.event_name); }

    get(setup) {
        if (this.tournament.speech?.context_version !== 'bts-context-v2') return null;
        const event = this.event(setup), count = setup.is_doubles ? 2 : 1;
        if (!event) return null;
        if (!this.pools.has(event)) this.pools.set(event, new Map());
        const cache = this.pools.get(event);
        if (cache.has(count)) return cache.get(count);
        cache.set(count, null);
        // Reserve and excluded entries are not participants in the draw.
        const stages = (event.stages || []).filter(stage => ![9998, 9999].includes(Number(stage.stage_type)));
        const entries = stages.flatMap(stage => stage.entries || []);
        if (!entries.length || stages.some(stage => Number(stage.entry_count || 0) > (stage.entries || []).length) ||
            entries.some(entry => !known(entry.team, count))) return null;
        const teams = new Map();
        const collect = team => {
            if (known(team, count)) teams.set(JSON.stringify(team.players.map(player => player.name)), team);
        };
        entries.forEach(entry => collect(entry.team));
        for (const match of this.matches) if (match.setup?.is_match !== false && match.setup && this.event(match.setup) === event) {
            (match.setup.teams || []).forEach(collect);
        }
        const first = new Set(), second = new Set(), against = new Set();
        for (const team of teams.values()) {
            const parts = contextPlan(this.texts, this.tournament, 'prepareName', { players: team.players }).parts;
            first.add(parts[0]); second.add(parts[1]); against.add(parts[2]);
        }
        const game = [...new Set([...first, ...against])];
        const pool = { team: teams.values().next().value, label: event.name,
            parts: { D01: game, D02: game, D04: [...second], D05: [...second], D12: [...new Set([...game, ...second])] } };
        cache.set(count, pool); return pool;
    }
}

// Only V1 combines the preparation prefix with a field in one clip. The
// fictional teams below supply the unchanged reference game; no team clip
// from this template is added to the plan or submitted for generation.
function preparationFields(tournament, texts, court, halls, fields) {
    return halls.map(hall => {
        let parts;
        if (tournament.speech?.context_version === 'bts-context-v1') {
            const setup = { ...hall, court_id: court._id, match_num: 189, event_name: 'ME U19', match_name: 'AF', teams: [
                { players: [{ name: 'Max Mustermann' }] }, { players: [{ name: 'Hans Dampf' }] },
            ] };
            const values = contextPlan(texts, tournament, 'announcePreparationMatch', setup).parts;
            parts = [values[0], values[values.length - 1]];
        } else if (tournament.speech?.context_version === 'bts-context-v2') parts = fields.slice(2, 3);
        else parts = texts.localParts([texts.createFieldPreparationAnnouncement({ court_id: court._id })]);
        return { location_id: hall.location_id || null, parts };
    });
}

module.exports = { ParticipantPools, preparationFields, known };
