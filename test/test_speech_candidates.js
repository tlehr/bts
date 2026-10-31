'use strict';

const assert = require('assert');
const { calculate_location_preparation_selection, cmp_scheduled_match_order } = require('../bts/match_automation');
const { callCandidates } = require('../bts/speech/planning');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { Prefetcher } = require('../bts/speech/prefetch');
const { capture, deliver } = require('../bts/speech/snapshot');

const now = Date.parse('2026-10-23T10:00:00');
function game(number, setup = {}, extra = {}) {
    return { _id: 'match-' + number, match_order: number, setup: {
        state: 'scheduled', is_match: true, match_num: number, event_name: 'JE U19', phase_block_key: 'R16',
        scheduled_date: '2026-10-23', scheduled_time_str: '10:00', location_id: 'hall',
        teams: [0, 1].map(side => ({ players: [{ btp_id: number * 2 + side, name: 'Spieler ' + number + ' ' + side }] })),
        ...setup,
    }, ...extra };
}
function fixture() {
    return { key: 'default', language: 'de', announcement_speech_voice: 'hallensprecher',
        speech: { context_version: 'bts-context-v2' },
        locations: [{ _id: 'hall' }], courts: [{ _id: 'court', location_id: 'hall', is_active: true }],
        preparation_call_matches_ahead_of_frontier_enabled: true, preparation_call_matches_ahead_of_frontier_limit: 2,
        call_preparation_matches_automatically_enabled: true,
        matches: [game(1, { state: 'preparation' }), game(2), game(3, { state: 'blocked' }),
            game(4, { incomplete: true, teams: [{ players: [] }, { players: [] }] }), game(5), game(6)],
    };
}
const select = current => callCandidates(current, current.matches, { now_ts: now });

describe('Speech call candidates within the preparation boundary', function() {
    it('excludes deferred games from speech candidates and the boundary, and includes them again after release', function() {
        const current = { ...fixture(), preparation_call_matches_ahead_of_frontier_limit: 1,
            matches: [game(1, { preparation_call_deferred: true }), game(2, { incomplete: true }),
                game(3, { preparation_call_deferred: true }), game(4), game(5)] };
        assert.deepStrictEqual(select(current), ['match-4']);
        const selection = calculate_location_preparation_selection(current, 'hall', { now_ts: now });
        assert.strictEqual(selection.display_frontier._id, 'match-2');
        assert.strictEqual(selection.display_cutoff._id, 'match-4');
        delete current.matches[2].setup.preparation_call_deferred;
        assert.deepStrictEqual(select(current), ['match-3']);
    });

    it('includes every known game through the boundary despite covered preparation demand and busy players', function() {
        const current = fixture();
        const ui = calculate_location_preparation_selection(current, 'hall', { now_ts: now });
        assert.strictEqual(ui.missing_preparation_count, 0);
        assert.deepStrictEqual(ui.selected_matches, []);
        assert.strictEqual(ui.display_cutoff.setup.match_num, 5);
        assert.deepStrictEqual(select(current), ['match-2', 'match-3', 'match-5']);
        current.call_preparation_matches_automatically_enabled = false;
        assert.deepStrictEqual(select(current), ['match-2', 'match-3', 'match-5']);
    });

    it('excludes unresolved teams, missing doubles partners, byes, started games and results', function() {
        const current = fixture();
        current.preparation_call_matches_ahead_of_frontier_enabled = false;
        current.matches = [game(1), game(2, { state: 'preparation' }), game(3, { state: 'oncourt' }),
            game(4, { now_on_court: true }), game(5, { state: 'finished' }), game(6, { is_match: false }),
            game(7, { incomplete: true }), game(8, { teams: [{ players: [] }, { players: [{ name: 'Bekannt' }] }] }),
            game(9, { teams: [{ players: [{ name: ' ' }] }, { players: [{ name: 'Bekannt' }] }] }),
            game(10, { is_doubles: true }), game(11, {}, { team1_won: false }), game(12, {}, { score_status: 'no_match' }),
            game(13, { is_doubles: true, teams: [0, 1].map(side => ({ players: [{ name: 'Partner A' + side }, { name: 'Partner B' + side }] })) })];
        assert.deepStrictEqual(select(current), ['match-1', 'match-13']);
    });

    for (const [settings, expected] of [
        [{ preparation_call_matches_ahead_of_frontier_enabled: true, preparation_call_matches_ahead_of_frontier_limit: 1 }, [2]],
        [{ preparation_call_block_ahead_limit_enabled: true, preparation_call_block_ahead_limit: 0 }, [2]],
        [{ preparation_call_time_ahead_of_frontier_enabled: true, preparation_call_time_ahead_of_frontier_minutes: 30 }, [2, 3]],
        [{ preparation_call_time_limit_before_scheduled_enabled: true, preparation_call_time_limit_before_scheduled_minutes: 30 }, [2, 3]],
    ]) it('uses the same configured call boundary as the match table: ' + Object.keys(settings)[0], function() {
        const current = { ...fixture(), preparation_call_matches_ahead_of_frontier_enabled: false, ...settings,
            matches: [game(1, { incomplete: true }), game(2), game(3, { scheduled_time_str: '10:30', phase_block_key: 'QF' }),
                game(4, { scheduled_time_str: '11:00', phase_block_key: 'SF' })] };
        const ui = calculate_location_preparation_selection(current, 'hall', { now_ts: now });
        assert.strictEqual(ui.display_cutoff.setup.match_num, expected.at(-1));
        assert.deepStrictEqual(select(current), expected.map(n => 'match-' + n));
    });

    it('unites location windows, deduplicates games without a location and preserves explicit BTP order', function() {
        const current = fixture();
        current.locations.push({ _id: 'other' });
        current.preparation_call_matches_ahead_of_frontier_limit = 0;
        current.matches = [game(1, {}, { match_order: 8 }), game(2, { location_id: 'other' }, { match_order: 1 }),
            game(3, { location_id: null }, { match_order: 2 }),
            game(4, { incomplete: true }, { match_order: 5 }), game(5, { location_id: 'other', incomplete: true }, { match_order: 9 })];
        assert.deepStrictEqual(select(current), ['match-2', 'match-3']);
        assert.deepStrictEqual(select(current).map(id => current.matches.find(m => m._id === id)),
            current.matches.filter(m => ['match-2', 'match-3'].includes(m._id)).sort(cmp_scheduled_match_order));
    });

    it('builds the live stage and idle work directly from a snapshot without any browser selection request', async function() {
        const current = fixture(), broker = new SpeechBroker(configuration({ enabled: true,
            api_key: 'candidates-test-' + 'x'.repeat(32), cache_enabled: false }, {}));
        broker.context_version = 'bts-context-v2';
        const app = { clock: { now_ms: () => now }, speech_snapshot: async () =>
            [current, current.locations, current.courts, current.matches, [], [], []] };
        const prefetch = new Prefetcher(app, broker);
        prefetch.configure(current, false);
        try {
            await prefetch.refresh(current.key);
            const view = prefetch.planning_status(current.key);
            assert.strictEqual(view.games.candidate, 3);
            assert.strictEqual(view.games.planned, 2);
            assert(view.stages.find(stage => stage.id === 'candidate').total > 0);
            const plan = broker.idle_plans.get(current.key).parts;
            const model = prefetch.planning.get(current.key);
            const stages = plan.map(part => model.parts.get(part));
            assert(stages.lastIndexOf('candidate') < stages.indexOf('planned'));
            assert.strictEqual(broker.queue(current.key).items.filter(item => item.idle).length, 0,
                'candidate work remains idle inventory until required work is ready');
            current.preparation_call_matches_ahead_of_frontier_limit = 0;
            await prefetch.refresh(current.key);
            assert.strictEqual(prefetch.planning_status(current.key).games.candidate, 2, 'settings changes replace the old window');
        } finally { prefetch.stop(); }
    });

    it('passes ordering, boundary rules and tournament time to the worker without histories or credentials', async function() {
        const current = { ...fixture(), _id: 'tournament', btp_password: 'private',
            btp_settings: { pause_duration_ms: 60000, secret: 'private' } };
        current.matches[1].match_order = 0;
        current.matches[1].presses = [{ private: 'history' }];
        const collections = { tournaments: [current], matches: current.matches.map(m => ({ ...m, tournament_key: current.key })),
            locations: current.locations, courts: current.courts, normalizations: [], tabletoperators: [], umpires: [] };
        const db = Object.fromEntries(Object.entries(collections).map(([name, values]) => [name, { getAllData: () =>
            values.map(value => ({ ...value, ...(name !== 'tournaments' ? { tournament_key: current.key } : {}) })) }]));
        const app = { db, clock: { now_ms: () => now } }, values = capture(app, current.key), chunks = [];
        assert.strictEqual(values[0][0].preparation_call_matches_ahead_of_frontier_limit, 2);
        assert.strictEqual(values[0][0].btp_settings.pause_duration_ms, 60000);
        assert.strictEqual(values[3].find(m => m._id === 'match-2').match_order, 0);
        assert(!JSON.stringify(values).includes('private'));
        await deliver(app, current.key, chunk => chunks.push(chunk));
        assert.strictEqual(chunks.at(-1).now_ts, now);
    });
});
