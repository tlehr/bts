'use strict';

const assert = require('assert');
const proto = require('../bts/btp_proto');
const { reset: reset_btp } = require('../bts/btp_court_assignments_reset');
const reset = (connection, matches) => reset_btp(connection, matches, { verify_timeout_ms: 0 });

function peer(options = {}) {
	const requests = [];
	const nodes = [1, 2, 3, 4].map(id => ({ ID: [id], DrawID: [10], PlanningID: [id],
		CourtID: [7], Status: [id], Highlight: [6], PlannedTime: ['preserved'], DisplayOrder: [id === 4 ? 0 : id * 10] }));
	nodes[2].Winner = [1];
	const courts = [{ ID: [7], MatchID: [2] }];
	let pending_update;
	let reads_after_update = 0;
	function apply_update(request) {
		for (const row of request.Update.Tournament.Matches) {
			const node = nodes.find(node => node.ID[0] === row.Match.ID);
			// Reproduce the real BTP requirement: an explicit zero and Status.
			if (row.Match.CourtID === 0 && row.Match.Status != null) delete node.CourtID;
			// BTP defaults an omitted MatchOrder to zero on every match update.
			node.DisplayOrder = [options.reorder ? 999 : (row.Match.MatchOrder ?? 0)];
		}
	}
	const connection = {
		key_unicode: 'session', password: 'secret',
		send(request, callback) {
			requests.push(request);
			const response = { Action: [{ Result: [1] }] };
			if (request.Action.ID === 'SENDTOURNAMENTINFO') {
				if (pending_update && ++reads_after_update >= 2) { apply_update(pending_update); pending_update = null; }
				response.Result = [{ Tournament: [{ Matches: [{ Match: structuredClone(nodes) }], Courts: [{ Court: courts }] }] }];
			} else {
				assert.strictEqual(request.Action.ID, 'SENDUPDATE');
				if (options.reject) response.Action[0].Result = [0];
				else if (!options.ignore) {
					if (options.delayed) pending_update = request;
					else apply_update(request);
				}
			}
			setImmediate(() => callback(options.offline ? null : response));
		},
	};
	const matches = [1, 2, 3, 4].map(id => ({ _id: 'm' + id, setup: { match_num: id },
		btp_match_ids: [{ id, draw: 10, planning: id }] }));
	return { connection, requests, nodes, courts, matches };
}

describe('BTP court assignment reset', function() {
	it('sends and verifies explicit removal, preserving order, status, time and preparation highlights', async function() {
		const { connection, requests, nodes, courts, matches } = peer();
		const before = structuredClone(nodes);
		const result = await reset(connection, matches);
		assert.deepStrictEqual(result, { allowed_match_ids: ['m1', 'm4'], btp_changed_matches: 2, skipped_matches: 2 });
		assert.deepStrictEqual(requests.map(request => request.Action.ID), ['SENDTOURNAMENTINFO', 'SENDUPDATE', 'SENDTOURNAMENTINFO']);
		const update = requests[1];
		assert.strictEqual(update.Action.Unicode, 'session');
		assert.deepStrictEqual(update.Update.Tournament.Matches.map(row => row.Match), [1, 4].map(id => ({
			ID: id, DrawID: 10, PlanningID: id, CourtID: 0, Status: id, Highlight: 6, MatchOrder: id === 4 ? 0 : id * 10,
		})));
		const xml = proto._req2xml(update);
		assert(xml.includes('TYPE="Integer" ID="CourtID">0</ITEM>'));
		assert(xml.includes('TYPE="Integer" ID="MatchOrder">10</ITEM>'));
		assert(!xml.includes('Sets') && !xml.includes('Players') && !xml.includes('PlannedTime'));
		for (const index of [0, 3]) delete before[index].CourtID;
		assert.deepStrictEqual(nodes, before);
		assert.deepStrictEqual(courts, [{ ID: [7], MatchID: [2] }]);
	});

	it('handles multiple BTP nodes belonging to one local match and already empty assignments', async function() {
		const { connection, nodes, requests } = peer();
		delete nodes[3].CourtID;
		const matches = [{ _id: 'combined', setup: {}, btp_match_ids: [{ id: 1 }, { id: 4 }] }, { _id: 'local', setup: {} }];
		assert.deepStrictEqual(await reset(connection, matches), {
			allowed_match_ids: ['combined', 'local'], btp_changed_matches: 1, skipped_matches: 0,
		});
		assert.strictEqual(requests[1].Update.Tournament.Matches.length, 1);
		assert.strictEqual((await reset(connection, matches)).btp_changed_matches, 0);
	});

	it('fails when BTP acknowledges a write but keeps the field assigned', async function() {
		const { connection, matches } = peer({ ignore: true });
		await assert.rejects(reset(connection, matches), /nicht entfernt/);
	});

	it('reports a changed order even if the field was successfully removed', async function() {
		const { connection, matches } = peer({ reorder: true });
		await assert.rejects(reset(connection, matches), /Spielreihenfolge/);
	});

	it('waits for an acknowledged batch to finish before verifying the fields and order', async function() {
		const { connection, matches, nodes, requests } = peer({ delayed: true });
		const result = await reset_btp(connection, matches, { verify_timeout_ms: 500, verify_interval_ms: 1 });
		assert.strictEqual(result.btp_changed_matches, 2);
		assert.strictEqual(nodes[0].DisplayOrder[0], 10);
		assert(!nodes[0].CourtID);
		assert.strictEqual(requests.filter(request => request.Action.ID === 'SENDUPDATE').length, 1);
		assert.strictEqual(requests.filter(request => request.Action.ID === 'SENDTOURNAMENTINFO').length, 3);
	});

	it('uses the current BTP order instead of a stale local order or request-list position', async function() {
		const { connection, matches, nodes, requests } = peer();
		matches[0].match_order = 987;
		matches[3].match_order = 654;
		nodes[0].DisplayOrder = [5];
		nodes[3].DisplayOrder = [2];
		await reset(connection, [matches[3], matches[0]]);
		assert.deepStrictEqual(requests[1].Update.Tournament.Matches.map(row => [row.Match.ID, row.Match.MatchOrder]), [[4, 2], [1, 5]]);
		assert.strictEqual(nodes[0].DisplayOrder[0], 5);
		assert.strictEqual(nodes[3].DisplayOrder[0], 2);
	});

	it('reports rejection or connection failures before claiming success', async function() {
		for (const options of [{ reject: true }, { offline: true }]) {
			const { connection, matches } = peer(options);
			await assert.rejects(reset(connection, matches), /nicht bestätigt/);
		}
	});

	it('requires an active writable session', async function() {
		for (const connection of [null, { terminated: true }, { key_unicode: 'session', readonly: true }]) {
			await assert.rejects(reset(connection, []), /nicht bereit|Nur-Lesen/);
		}
	});

	it('refuses missing BTP matches without sending a partial batch', async function() {
		const { connection, requests, matches } = peer();
		await assert.rejects(reset(connection, [...matches, { _id: 'missing', setup: {}, btp_match_ids: [{ id: 999 }] }]), /nicht gefunden/);
		assert.strictEqual(requests.length, 1);
	});
});
