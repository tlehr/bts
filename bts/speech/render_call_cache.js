'use strict';

const crypto = require('crypto');

// These are the complete text inputs read by announcement_text and the V1/V2
// recipe builders. Attendance, scores and preparation ages affect coverage's
// live status, never the wording. Keep status assembly outside this cache.
const SETTINGS = ['annoncement_include_event', 'annoncement_include_round', 'annoncement_include_matchnumber',
    'preparation_meetingpoint_enabled', 'tabletoperator_use_manual_counting_boards_enabled'];
const names = players => players?.map(player => player?.name);
function context_key(tournament) {
    const value = [SETTINGS.map(key => tournament[key]), tournament.speech?.context_version,
        tournament.normalizations, tournament.locations?.map(value => [value._id, value.preparation_addition, value.meetingpoint_announcement]),
        tournament.courts?.map(value => [value._id, value.location_id])];
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function setup_key(setup) {
    return [setup.court_id, setup.location_id, setup.match_num, setup.event_name, setup.match_name,
        setup.teams?.map(team => names(team?.players)), names(setup.tabletoperators), setup.umpire?.name, setup.service_judge?.name];
}

class RenderCallCache {
    constructor(maximum = 32 * 1024 * 1024) { this.entries = new Map(); this.bytes = 0; this.maximum = maximum; }
    clear() { this.entries.clear(); this.bytes = 0; }
    context(tournament) {
        if (!['bts-context-v1', 'bts-context-v2'].includes(tournament.speech?.context_version)) return null;
        let context;
        try { context = context_key(tournament); } catch (_) { return null; }
        return {
            key: (name, setup, args) => {
                try { return JSON.stringify([context, name, setup_key(setup), args]); } catch (_) { return null; }
            },
            get: key => {
                const value = this.entries.get(key);
                if (value) { this.entries.delete(key); this.entries.set(key, value); }
                return value?.result;
            },
            set: (key, result) => {
                const size = (key.length + JSON.stringify(result).length) * 2 + 128;
                if (size > this.maximum) return;
                while (this.entries.size >= 16384 || this.bytes + size > this.maximum) {
                    const first = this.entries.keys().next().value;
                    this.bytes -= this.entries.get(first).size; this.entries.delete(first);
                }
                this.entries.set(key, { result, size }); this.bytes += size;
            },
        };
    }
}
module.exports = RenderCallCache;
