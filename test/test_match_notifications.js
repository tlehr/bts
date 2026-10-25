'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const admin = require('../bts/admin');
const bup = require('../bts/bupws');
const v2 = require('../bts/bupws_v2');
const helpers = require('../bts/match_utils');
let next = 0;

async function fixture() {
    const db = await database.init_test(), key = 'match-notify-' + ++next, app = { db };
    const insert = (table, docs) => promisify(db[table].insert.bind(db[table]))(docs);
    await insert('tournaments', { key, bupws_v2_enabled: true, btp_enabled: false });
    await insert('courts', { _id: 'court', tournament_key: key, match_id: 'active', num: 1 });
    await insert('matches', [
        { _id: 'active', tournament_key: key, network_score: [[2, 1]], setup: { state: 'oncourt', now_on_court: true,
            match_id: 'active', court_id: 'court', counting: '3x21', teams: [{ players: [] }, { players: [] }] } },
        { _id: 'prepared', tournament_key: key, setup: { state: 'preparation', counting: '3x21', teams: [
            { players: [1, 2].map(btp_id => ({ btp_id, name: 'Example ' + btp_id, checked_in: false })) },
            { players: [3, 4].map(btp_id => ({ btp_id, name: 'Example ' + btp_id, checked_in: false })) },
        ] } },
    ]);
    await insert('displaysettings', [{ id: 'single-style', devicemode: 'display', displaymode_style: 'teamcourt' },
        { id: 'multi-style', devicemode: 'display', displaymode_style: '2court' }]);
    const panels = [], settings_writes = [];
    const panel = (options = {}) => {
        const ws = { readyState: 1, hostname: 'fixture', client_id: 'fixture-' + panels.length, messages: [],
            send(raw) { this.messages.push(JSON.parse(raw)); }, sendmsg(message) { this.messages.push(message); } };
        v2.on_connect(app, ws);
        Object.assign(ws, { last_tournament_key: key, court_id: 'court', last_v2_match_id: 'active' }, options);
        settings_writes.push(insert('display_court_displaysettings', { client_id: ws.client_id, court_id: ws.court_id,
            panel_devicemode: ws.panel_devicemode, displaysetting_id: ws.v2_multi_court_display ? 'multi-style' : 'single-style' }));
        panels.push(ws); return ws;
    };
    return { app, db, key, panel, ready: () => Promise.all(settings_writes), cleanup() { panels.forEach(ws => v2.on_close(app, ws)); } };
}

describe('notifications for a match without a court', function() {
    it('handles four real check-ins without refreshing 13 unrelated TVs or copying V1 payloads', async function() {
        const f = await fixture(), running = [], changes = [];
        const select = helpers.queue_auto_execute_preparation_selections, call = helpers.auto_call_matches_on_free_courts;
        const refresh = v2.handle_score_change, read = f.db.model.read_display_context_part, fetch = f.db.fetch_all;
        const viewer = { sendmsg: message => changes.push(message) };
        let reads = 0, v1_reads = 0;
        for (let i = 0; i < 13; i++) {
            const court_id = i ? 'court-' + i : 'court', match_id = i ? 'active-' + i : 'active';
            if (i) {
                await promisify(f.db.courts.insert.bind(f.db.courts))({ _id: court_id, tournament_key: f.key, match_id, num: i + 1 });
                await promisify(f.db.matches.insert.bind(f.db.matches))({ _id: match_id, tournament_key: f.key, network_score: [[2, 1]],
                    setup: { match_id, court_id, state: 'oncourt', now_on_court: true, counting: '3x21',
                        teams: [{ players: [] }, { players: [] }] } });
            }
            f.panel({ court_id, last_v2_match_id: match_id });
        }
        f.panel({ panel_devicemode: 'umpire' });
        await f.ready();
        f.db.model.read_display_context_part = (...args) => { reads++; return read(...args); };
        f.db.fetch_all = (...args) => { v1_reads++; return fetch.apply(f.db, args); };
        v2.handle_score_change = (...args) => { const result = refresh(...args); running.push(result); return result; };
        helpers.queue_auto_execute_preparation_selections = (_app, _key, done) => done();
        helpers.auto_call_matches_on_free_courts = (_app, _key, done) => done();
        admin.on_connect(f.app, viewer);
        try {
            await Promise.all([1, 2, 3, 4].map(player_id => new Promise((resolve, reject) =>
                admin.handle_match_player_check_in(f.app, { respond: (_message, error) => error ? reject(error) : resolve() },
                    { tournament_key: f.key, match_id: 'prepared', player_id, checked_in: true, require_preparation: true }))));
            await Promise.all(running);
            assert.strictEqual(reads, 0, 'unrelated TV contexts must not enter datastore queues');
            assert.strictEqual(v1_reads, 0, 'no legacy recipient needs the full tournament or histories');
            const match = await f.db.matches.findOne_async({ _id: 'prepared' });
            assert(match.setup.teams.flatMap(team => team.players).every(player => player.checked_in));
            assert.strictEqual(match.btp_needsync, true);
            assert.strictEqual(changes.filter(message => message.ctype === 'match_edit').length, 4);
        } finally {
            helpers.queue_auto_execute_preparation_selections = select; helpers.auto_call_matches_on_free_courts = call;
            v2.handle_score_change = refresh; f.db.fetch_all = fetch; admin.on_close(f.app, viewer); f.cleanup();
        }
    });

    it('refreshes a picker and stale display while leaving other occupied courts alone', async function() {
        const f = await fixture();
        const unrelated = f.panel(), stale = f.panel({ last_v2_match_id: 'bts_prepared' });
        const picker = f.panel({ court_id: undefined, last_v2_match_id: null });
        await f.ready();
        try {
            await v2.handle_score_change(f.app, f.key, undefined, { changed_match_id: 'prepared' });
            assert.strictEqual(unrelated.messages.length, 0);
            assert(stale.messages.some(message => message.type === 'display_state'), JSON.stringify(stale.messages));
            assert(picker.messages.some(message => message.type === 'court_picker_state'));
        } finally { f.cleanup(); }
    });

    it('keeps the global refresh and explicit old-court refresh available', async function() {
        const f = await fixture(), tv = f.panel();
        await f.ready();
        try {
            await v2.handle_score_change(f.app, f.key, undefined);
            assert(tv.messages.some(message => message.type === 'display_points_update'), JSON.stringify(tv.messages));
            tv.messages.length = 0;
            await f.db.matches.update_async({ _id: 'active' }, { $set: { network_score: [[3, 1]] } }, {});
            await v2.handle_score_change(f.app, f.key, 'court', { changed_match_id: 'prepared' });
            assert(tv.messages.some(message => message.type === 'display_points_update'), JSON.stringify(tv.messages));
        } finally { f.cleanup(); }
    });

    it('retains multi-court displays that still show the changed match and skips unrelated overviews', async function() {
        const f = await fixture();
        const stale = f.panel({ v2_multi_court_display: true, last_v2_match_ids_by_court: new Map([['court', 'bts_prepared']]) });
        const unrelated = f.panel({ v2_multi_court_display: true, last_v2_match_ids_by_court: new Map([['court', 'active']]) });
        await f.ready();
        try {
            await v2.handle_score_change(f.app, f.key, undefined, { changed_match_id: 'prepared' });
            assert(stale.messages.some(message => message.type === 'display_multi_state'), JSON.stringify(stale.messages));
            assert.strictEqual(unrelated.messages.length, 0);
        } finally { f.cleanup(); }
    });

    it('preserves match scope when a serialized BTP effect is replayed', function() {
        const notify = bup.handle_score_change, calls = [], app = {};
        bup.handle_score_change = (...args) => calls.push(args);
        try {
            require('../bts/btp_sync_effects').restore({ command: { target: 'bupws', method: 'notify_courts',
                args: ['key', null, 'old-court', { changed_match_id: 'match' }] } }).run(app);
            assert.deepStrictEqual(calls, [[app, 'key', null, { changed_match_id: 'match' }], [app, 'key', 'old-court']]);
        } finally { bup.handle_score_change = notify; }
    });
});
