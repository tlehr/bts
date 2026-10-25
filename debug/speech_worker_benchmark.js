'use strict';

// Synthetic in-memory tournament only. No local data/config, live server,
// speech service or playback. The unreachable port prevents synthesis.
const assert = require('assert');
const { performance } = require('perf_hooks');
const { promisify } = require('util');
const database = require('../bts/database');
const { create } = require('../bts/speech');
const { capture, deliver } = require('../bts/speech/snapshot');
// The real server loads its admin routes before starting speech. Keep that
// one-off module load outside the worker-start measurement here as well.
require('../bts/admin');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function measure(work) {
    let last = performance.now(), max_delay = 0, ticks = 0;
    const timer = setInterval(() => {
        const now = performance.now(); max_delay = Math.max(max_delay, now - last - 2); last = now; ticks++;
    }, 2);
    const start = performance.now();
    try {
        const value = await work();
        const elapsed_ms = performance.now() - start;
        await delay(5);
        return { elapsed_ms, heartbeat_max_delay_ms: max_delay, ticks, value };
    } finally { clearInterval(timer); }
}

async function benchmark(samples = 6) {
    const db = await database.init_test();
    const tournament = { key: 'speech-benchmark', language: 'de', name: 'Synthetic',
        annoncement_include_event: true, annoncement_include_round: true, annoncement_include_matchnumber: true,
        tabletoperator_enabled: true, announcement_speech_mode: 'auto', events: { events: [] } };
    const matches = Array.from({ length: 519 }, (_, i) => ({ _id: 'match-' + String(i).padStart(4, '0'), tournament_key: tournament.key,
        setup: { _match_id: 'match-' + i, is_match: true, state: i < 8 ? 'preparation' : 'scheduled',
            match_num: i + 1, event_name: 'JE U17', match_name: 'HF', preparation_call_timestamp: i,
            teams: [{ players: [{ name: 'Spieler ' + i, btp_id: i }] }, { players: [{ name: 'Gegner ' + i, btp_id: 519 + i }] }] },
        presses: Array.from({ length: 180 }, (_, index) => ({ type: 'score', index, timestamp: index * 1000 })) }));
    await promisify(db.tournaments.insert.bind(db.tournaments))(tournament);
    await promisify(db.matches.insert.bind(db.matches))(matches);
    const config = { enabled: true, api_key: 'benchmark-' + 'x'.repeat(32), cache_enabled: false, url: 'http://127.0.0.1:1', prefetch_interval_ms: 300000 };
    const inline = create({ db, config: { speech: { ...config, worker: false } } });
    const worker = create({ db, config: { speech: config } });
    const result = { node: process.version, matches: matches.length, samples, created_at: new Date().toISOString(),
        method: '519 synthetic matches with 180 score-history entries each, eight prepared games, alternating pairs; 2-ms main-thread heartbeat. Scheduling debounce included equally. No inference, live data, browser, score persistence or TV transport.',
        full_document_bytes: Buffer.byteLength(JSON.stringify(matches)),
        speech_snapshot_bytes: Buffer.byteLength(JSON.stringify(capture({ db }, tournament.key))), inline: [], worker: [] };
    const run = async (service, mode) => {
        const before = service.request ? (await service.request({ type: 'speech_planning', tournament_key: tournament.key })).planning.updated_at :
            service.prefetch.planning_status(tournament.key).updated_at;
        service.prefetch.schedule(tournament.key);
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            const response = service.request ? (await service.request({ type: 'speech_planning', tournament_key: tournament.key })).planning :
                service.prefetch.planning_status(tournament.key);
            if (response.phase !== 'unknown' && !response.updating && response.updated_at > before) {
                const queue = service.request ? (await service.request({ type: 'speech_queue', tournament_key: tournament.key })).queue : service.broker.queue(tournament.key);
                return { games: response.games, stages: response.stages.map(({ id, total }) => ({ id, total })),
                    items: queue.items.map(({ text, voice, priority }) => ({ text, voice, priority })) };
            }
            await delay(5);
        }
        throw new Error(mode + ' benchmark timeout');
    };
    try {
        inline.prefetch.configure(tournament, false);
        worker.start();
        // The first worker run reports startup and initial snapshot separately.
        result.cold_start = await measure(() => run(worker, 'worker'));
        const expected = await run(inline, 'inline');
        assert.deepStrictEqual(result.cold_start.value, expected);
        delete result.cold_start.value;
        for (let i = 0; i < samples; i++) for (const mode of i % 2 ? ['worker', 'inline'] : ['inline', 'worker']) {
            const sample = await measure(() => run(mode === 'worker' ? worker : inline, mode));
            assert.deepStrictEqual(sample.value, expected); delete sample.value;
            result[mode].push(sample);
        }
        const state = {}, chunks = [];
        await deliver({ db }, tournament.key, chunk => { chunks.push(chunk); }, state);
        chunks.length = 0;
        await deliver({ db }, tournament.key, chunk => { chunks.push(chunk); }, state);
        result.unchanged_snapshot_documents_transferred = chunks.reduce((n, chunk) => n + (chunk.documents?.length || 0), 0);
        result.summary = {};
        for (const mode of ['inline', 'worker']) result.summary[mode] = Object.fromEntries(['elapsed_ms', 'heartbeat_max_delay_ms'].map(field => {
            const values = result[mode].map(row => row[field]).sort((a, b) => a - b);
            return [field, { median: values[Math.floor(values.length / 2)], max: values.at(-1) }];
        }));
        return result;
    } finally { inline.stop(); worker.stop(); }
}

if (require.main === module) benchmark().then(value => console.log(JSON.stringify(value, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1; });
module.exports = benchmark;
