'use strict';

const assert = require('assert');

const {_describe, _it} = require('./tutils.js');

const admin = require('../bts/admin.js');
const bupws = require('../bts/bupws.js');

_describe('bupws', () => {
	_it('rejects an admin finish confirmation when the match moved after the court was chosen', async () => {
		const db = await require('../bts/database').init_test();
		const insert = (store, docs) => require('util').promisify(store.insert.bind(store))(docs);
		await insert(db.tournaments, { key: 'default' });
		await insert(db.courts, [{ _id: 'old', tournament_key: 'default', match_id: 'other' }, { _id: 'new', tournament_key: 'default', match_id: 'moved' }]);
		await insert(db.matches, { _id: 'moved', tournament_key: 'default', team1_won: true, setup: { court_id: 'new', state: 'oncourt', now_on_court: true } });
		const match = db.model.tournament('default').matches.get('moved').data;
		await assert.rejects(bupws.confirm_match_finished_from_admin({ db }, 'default', 'moved', 'old'), /moved to another court/);
		assert.strictEqual(db.model.tournament('default').matches.get('moved').data, match);
		assert.strictEqual(db.model.tournament('default').courts.get('old').data.match_id, 'other');
		assert.strictEqual(db.model.tournament('default').courts.get('new').data.match_id, 'moved');
	});
	_it('clears the stored court match reference when the finished match still owns the court', (done) => {
		const notifications = [];
		const original_notify_change = admin.notify_change;
		admin.notify_change = (_app, _tournament_key, ctype, payload) => {
			notifications.push({ ctype, payload });
		};

		const app = {
			db: {
				courts: {
					update(query, update, options, cb) {
						assert.deepStrictEqual(query, { tournament_key: 'default', _id: 'court-1' });
						assert.deepStrictEqual(update, { $set: { match_id: null } });
						assert.deepStrictEqual(options, { returnUpdatedDocs: true });
						cb(null, 1, {
							_id: 'court-1',
							is_active: true,
							has_umpire: true,
							has_service_judge: false,
							match_id: null,
						});
					}
				}
			}
		};

		bupws._clear_court_match_reference_after_finish(
			app,
			'default',
			{ tournament_key: 'default', _id: 'court-1' },
			{ _id: 'court-1', match_id: 'match-1', is_active: true, has_umpire: true, has_service_judge: false },
			'match-1',
			true,
			(err, changed) => {
				admin.notify_change = original_notify_change;
				assert.ifError(err);
				assert.strictEqual(changed, true);
				assert.deepStrictEqual(notifications, [{
					ctype: 'court_changed',
					payload: {
						court_id: 'court-1',
						is_active: true,
						has_umpire: true,
						has_service_judge: false,
						match_id: null,
					}
				}]);
				done();
			}
		);
	});

	_it('does not clear the court match reference for unrelated finishes', (done) => {
		const original_notify_change = admin.notify_change;
		admin.notify_change = () => {
			throw new Error('notify_change must not be called');
		};

		const app = {
			db: {
				courts: {
					update() {
						throw new Error('court update must not be called');
					}
				}
			}
		};

		bupws._clear_court_match_reference_after_finish(
			app,
			'default',
			{ tournament_key: 'default', _id: 'court-1' },
			{ _id: 'court-1', match_id: 'other-match' },
			'match-1',
			true,
			(err, changed) => {
				admin.notify_change = original_notify_change;
				assert.ifError(err);
				assert.strictEqual(changed, false);
				done();
			}
		);
	});
});
