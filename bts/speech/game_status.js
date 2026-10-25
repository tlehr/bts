'use strict';

const crypto = require('crypto');
const { cmp_scheduled_match_order } = require('../match_automation');
const { description } = require('./inventory');

const COLUMNS = [['call', ['D01']], ['preparation', ['D02']], ['start', ['D03']],
    ['other', ['D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12']]];

function matchState(match, candidates) {
    const setup = match.setup;
    if (typeof match.team1_won === 'boolean' || match.score_status === 'no_match' || setup.state === 'finished') return 'finished';
    if (setup.state === 'oncourt' || setup.now_on_court && setup.court_id) return 'oncourt';
    if (setup.state === 'preparation') return 'preparation';
    if (candidates.has(match._id)) return 'candidate';
    if (setup.state === 'blocked') return 'blocked';
    if (setup.incomplete || setup.state === 'incomplete') return 'incomplete';
    return 'scheduled';
}

function describeGames(tournament, matches, preferred = []) {
    const candidates = new Set(preferred);
    const courts = new Map((tournament.courts || []).map(court => [court._id, court]));
    const locations = new Map((tournament.locations || []).map(location => [location._id, location]));
    return matches.filter(match => match.setup && match.setup.is_match !== false).slice().sort(cmp_scheduled_match_order).map(match => {
        const setup = match.setup, court = courts.get(setup.court_id), location = locations.get(setup.location_id);
        return { id: match._id, number: setup.match_num, date: setup.scheduled_date || '', time: setup.scheduled_time_str || '',
            event: setup.event_name || '', round: setup.match_name || '', match_state: matchState(match, candidates),
            highlight: Number.isInteger(Number(setup.highlight)) ? Number(setup.highlight) : 0,
            preparation_call_timestamp: setup.preparation_call_timestamp != null && Number.isFinite(Number(setup.preparation_call_timestamp)) ? Number(setup.preparation_call_timestamp) : null,
            teams: [0, 1].map(index => (setup.teams?.[index]?.players || []).map(player => player?.name || '').filter(Boolean).join(' / ')),
            court_id: setup.court_id || null, location_id: setup.location_id || null, location: location?.name || '',
            court: court ? String(court.num ?? court.name ?? court._id).replace(/^.*_/, '') : '' };
    });
}

function counts(calls, progress) {
    const keys = new Set(calls.flatMap(call => call.keys));
    const reasons = [...new Set(calls.map(call => call.unresolved).filter(Boolean))];
    const value = { total: keys.size, ready: 0, missing: 0, queued: 0, processing: 0, failed: 0,
        blocked: reasons.length > 0, reasons, state: 'none' };
    for (const key of keys) {
        const part = progress(key);
        for (const field of ['ready', 'queued', 'processing', 'failed']) value[field] += part[field];
    }
    value.missing = value.total - value.ready;
    value.state = !calls.length ? 'none' : value.failed ? 'failed' : value.blocked ? 'blocked' :
        !value.missing ? 'ready' : value.processing ? 'processing' : value.queued ? 'queued' : 'missing';
    return value;
}

class GameStatus {
    constructor(games, calls, labels, parts, fields = []) {
        const byMatch = new Map(), byCourt = new Map();
        for (const call of calls) {
            if (call.match_id) {
                if (!byMatch.has(call.match_id)) byMatch.set(call.match_id, []);
                byMatch.get(call.match_id).push(call);
            } else if (call.group === 'D03') byCourt.set(call.court_id, call);
        }
        const pools = new Map();
        const poolFor = location => {
            if (pools.has(location)) return pools.get(location);
            const eligible = fields.filter(field => !location || field.location_id === location);
            const opening = [...new Set(eligible.flatMap(field => field.opening))];
            const closing = [...new Set(eligible.flatMap(field => field.closing))];
            const preparation = new Map();
            for (const field of eligible) for (const variant of field.preparation) {
                if (!preparation.has(variant.location_id)) preparation.set(variant.location_id, new Set());
                variant.parts.forEach(key => preparation.get(variant.location_id).add(key));
            }
            const pool = { keys: { D01: [...new Set([...opening, ...closing])], D04: closing,
                D06: opening, D07: opening, D08: opening },
                preparation, starts: eligible.map(field => byCourt.get(field.court_id)).filter(Boolean) };
            pools.set(location, pool); return pool;
        };
        this.games = games.map(game => {
            const pool = !game.court_id ? poolFor(game.location_id) : null;
            const calls = (byMatch.get(game.id) || []).map(call => {
                const fieldKeys = pool && (call.group === 'D02' ? [...(pool.preparation.get(call.location_id) || [])] : pool.keys[call.group]);
                if (!fieldKeys || call.unresolved && call.unresolved_kind !== 'court') return call;
                if (!pool.starts.length) return { ...call, unresolved: 'Kein aktives Spielfeld verfügbar' };
                return { ...call, keys: [...new Set([...call.keys, ...fieldKeys])], unresolved: null,
                    variant: [call.variant, 'Alle möglichen Felder'].filter(Boolean).join(' · ') };
            });
            if (pool?.starts.length) calls.push(...pool.starts);
            else calls.push(byCourt.get(game.court_id) || { id: 'start:' + game.id, group: 'D03', keys: [],
                text: '', unresolved: game.court_id ? 'Spielfeld nicht im aktuellen Plan vorhanden' : 'Kein aktives Spielfeld verfügbar' });
            calls.sort((a, b) => a.group.localeCompare(b.group));
            return { game, calls, columns: COLUMNS.map(([id, groups]) => ({ id, calls: calls.filter(call => groups.includes(call.group)) })) };
        });
        this.labels = new Map(labels);
        this.parts = parts;
    }

    async snapshot(broker, tournament, voice, matchId, previousRevision) {
        const available = new Map();
        const progress = key => {
            if (available.has(key)) return available.get(key);
            const entry = broker.entries.get(key), saved = broker.disk?.lookup(broker.identity, key);
            const ready = !!(saved || entry?.status === 'completed' && (!entry.local || broker.disk?.file(entry.audio_id)));
            const owned = !ready && entry?.tournaments.has(tournament);
            const value = { ready: Number(ready), processing: Number(!!owned && entry.status === 'processing'),
                queued: Number(!!owned && !entry.terminal_failure && ['unsubmitted', 'queued', 'processing', 'failed'].includes(entry.status)),
                failed: Number(!!owned && entry.status === 'failed') };
            available.set(key, value); return value;
        };
        const items = [];
        let detail = null;
        for (const { game, calls, columns } of this.games) {
            items.push({ ...game, ...counts(calls, progress), columns: columns.map(({ id, calls }) => ({ id, ...counts(calls, progress) })) });
            if (game.id === matchId) detail = { id: game.id, announcements: calls.map(call => ({
                id: call.id, group: call.group, label: this.labels.get(call.group) + (call.variant ? ' · ' + call.variant : ''), text: call.text,
                unresolved: call.unresolved || null, ...counts([call], progress),
                components: call.keys.map(key => {
                    const value = progress(key);
                    return { id: key, text: description(this.parts.get(key)?.part).text,
                        state: value.ready ? 'ready' : value.failed ? 'failed' : value.processing ? 'processing' : value.queued ? 'queued' : 'missing',
                        error: value.failed ? broker.failures?.get_current(broker.identity, key)?.code || null : null };
                }),
            })) };
            // Only the speech process computes these counts. Yield between games
            // so an open status page cannot hold up playback requests there.
            if (items.length % 24 === 0) await new Promise(resolve => setImmediate(resolve));
        }
        const revision = crypto.createHash('sha256').update(JSON.stringify([voice, items])).digest('hex');
        return { voice, revision, ...(revision === previousRevision ? { unchanged: true } : { items }), detail };
    }
}

module.exports = { describeGames, GameStatus };
