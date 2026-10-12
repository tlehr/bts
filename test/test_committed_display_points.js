'use strict';

const assert = require('assert');
const publish = require('../bts/score_publication/committed_points');

describe('committed display score recipients', function() {
	it('retains full refresh fallback, TTL ordering, visibility and current match/court identity', function() {
		const input = { app: { db: { courts: { ttlIndexes: {} }, matches: { ttlIndexes: {} } } }, key: 'test',
			court: { _id: 'court', match_id: 'one' }, match: { _id: 'one', setup: { match_id: 'game' } },
			panels: [{ readyState: 1, last_tournament_key: 'test', panel_devicemode: 'display', court_id: 'court', last_v2_match_id: 'game' }],
			visible: () => true, build: () => ({}), send: () => true };
		assert.strictEqual(publish({ ...input, full_state_fallback: true }), 0);
		assert.strictEqual(publish({ ...input, lock_scope_active: false }), 0);
		assert.strictEqual(publish({ ...input, visible: () => false }), 0);
		assert.strictEqual(publish({ ...input, court: { _id: 'court', match_id: 'replacement' } }), 0);
		input.app.db.courts.ttlIndexes.expires = 1; assert.strictEqual(publish(input), 0); delete input.app.db.courts.ttlIndexes.expires;
		input.app.db.matches.ttlIndexes.expires = 1; assert.strictEqual(publish(input), 0); delete input.app.db.matches.ttlIndexes.expires;
		assert.strictEqual(publish(input), 1);
	});
	it('routes one persisted update to initialized single and multi views, skipping stale, foreign and disconnected panels', function() {
		const panel = { readyState: 1, last_tournament_key: 'test', panel_devicemode: 'display', court_id: 'court', last_v2_match_id: 'game' };
		const single = { ...panel }, multi = { ...panel, court_id: 'multi', v2_multi_court_display: true, last_v2_match_ids_by_court: new Map([['court', 'game']]) };
		const delivered = []; let builds = 0;
		assert.strictEqual(publish({ app: { db: { courts: {}, matches: {} } }, key: 'test',
			court: { _id: 'court', match_id: 'one' }, match: { _id: 'one', setup: { match_id: 'game' } },
			panels: [single, multi, { ...panel, court_id: 'other' }, { ...panel, last_v2_match_id: 'old' },
				{ ...panel, last_tournament_key: 'foreign' }, { ...panel, readyState: 3 }, { ...panel, panel_devicemode: 'umpire' },
				{ ...multi, last_v2_match_ids_by_court: new Map([['court', 'old']]) }],
			visible: () => true, build: () => { builds++; return {}; }, send: ws => { delivered.push(ws); return true; },
		}), 2);
		assert.deepStrictEqual(delivered, [single, multi]); assert.strictEqual(builds, 1);
	});
});
