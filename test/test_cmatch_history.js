'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fixture() {
	const match = { _id: 'm1', presses_deferred: true };
	const requests = [], errors = [];
	const context = { curt: { key: 'default', matches: [match] }, window: { location: { pathname: '/admin/t/default' } },
		send(message, callback) { requests.push({ message, callback }); },
		cerror: { net(error) { errors.push(error); }, silent(error) { errors.push(error); } } };
	vm.createContext(context);
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/cmatch_history.js'), 'utf8'), context);
	const answer = presses => requests[0].callback(null, { tournament_key: 'default', match_id: 'm1', presses });
	return { context, match, requests, errors, answer, load: context.cmatch_history.load };
}

describe('admin deferred match history client', function() {
	it('requests a history once, then opens only the latest requested view and reuses the loaded data', function() {
		const f = fixture(), history = [{ type: 'point', timestamp: 12 }];
		let opened = '';
		f.load(f.match, () => { opened = 'edit'; });
		f.load(f.match, () => { opened = 'scoresheet'; });
		assert.strictEqual(f.requests.length, 1);
		assert.strictEqual(f.requests[0].message.tournament_key, 'default');
		assert.strictEqual(f.requests[0].message.match_id, 'm1');
		assert.strictEqual(opened, '');
		f.answer(history);
		assert.strictEqual(opened, 'scoresheet');
		assert.strictEqual(f.match.presses, history);
		assert.strictEqual(f.match.presses_deferred, undefined);
		f.load(f.match, () => { opened = 'edit'; });
		assert.strictEqual(opened, 'edit');
		assert.strictEqual(f.requests.length, 1);
	});

	for (const reason of ['route', 'tournament', 'match']) it('discards a response after the ' + reason + ' changes', function() {
		const f = fixture();
		let opened = false;
		f.load(f.match, () => { opened = true; });
		if (reason === 'route') f.context.window.location.pathname += '/other';
		if (reason === 'tournament') f.context.curt = { key: 'default', matches: [f.match] };
		if (reason === 'match') f.context.curt.matches = [{ ...f.match }];
		f.answer([{ type: 'point' }]);
		assert.strictEqual(opened, false);
		assert.strictEqual(f.match.presses_deferred, true);
	});

	it('preserves a newer live history arriving during the request, even if the old request fails', function() {
		const f = fixture(), history = [{ type: 'point', timestamp: 99 }];
		let opened = false;
		f.load(f.match, () => { opened = true; });
		f.match.presses = history;
		delete f.match.presses_deferred;
		f.requests[0].callback(new Error('old request failed'));
		assert.strictEqual(opened, true);
		assert.strictEqual(f.match.presses, history);
		assert.deepStrictEqual(f.errors, []);
	});

	for (const reason of ['server error', 'wrong match', 'wrong tournament', 'missing history']) it('keeps history deferred and permits retry after ' + reason, function() {
		const f = fixture();
		let opened = false;
		f.load(f.match, () => { opened = true; });
		const response = { tournament_key: 'default', match_id: 'm1', presses: [] };
		if (reason === 'wrong match') response.match_id = 'other';
		if (reason === 'wrong tournament') response.tournament_key = 'other';
		if (reason === 'missing history') delete response.presses;
		f.requests[0].callback(reason === 'server error' ? new Error('failed') : null, response);
		assert.strictEqual(opened, false);
		assert.strictEqual(f.errors.length, 1);
		assert.strictEqual(f.match.presses_deferred, true);
		f.load(f.match, () => { opened = true; });
		assert.strictEqual(f.requests.length, 2);
		f.requests[1].callback(null, { tournament_key: 'default', match_id: 'm1', presses: [] });
		assert.strictEqual(opened, true);
	});
});
