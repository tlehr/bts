'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { collect } = require('../static/js/btp_dsq_todos');

function match(num, status = 'DSQ', extra = {}) {
	return { _id: 'm' + num, score_status: 'normal', btp_match_ids: [{ draw: 5 }], ...extra,
		setup: { is_match: true, event_name: 'JE U13', match_num: num, teams: [
			{ players: [{ btp_id: 1, name: 'Player One', firstname: 'Player', lastname: 'One', entries: { 5: status, 2: '<none>' } }] },
			{ players: [{ btp_id: 2, name: 'Opponent', entries: { 5: '<none>' } }] },
		] } };
}

function ui(matches) {
	const source = fs.readFileSync(require.resolve('../static/js/cmatch'), 'utf8');
	const functions = source.slice(source.indexOf('function _team_status_label('), source.indexOf('function _update_setup('));
	const nodes = [], translations = [];
	const context = vm.createContext({ curt: { matches }, btp_entry_status: require('../static/js/btp_entry_status'),
		btp_dns_todos: require('../static/js/btp_dns_todos'), btp_dsq_todos: { collect },
		ctournament: { get_registration_main_todos: () => [] },
		ci18n: (key, values) => { translations.push({ key, values }); return key; },
		uiu: { el: (parent, tag, className, text) => { const node = { parent, tag, className, text }; nodes.push(node); return node; } },
	});
	vm.runInContext(functions, context);
	return { context, nodes, translations };
}

describe('BTP DSQ consistency todos', function() {
	it('reports imported DSQ without a matching disqualification, independently of the first match', function() {
		const earlier = match(10, '<none>', { team1_won: false, network_score: [[15, 21], [17, 21]] });
		const later = match(30, '7'), before = JSON.stringify([earlier, later]);
		assert.deepStrictEqual(collect([earlier, later, match(40, 7)]), [{ name: 'Player One', event_name: 'JE U13' }]);
		assert.strictEqual(JSON.stringify([earlier, later]), before);
	});

	it('accepts a disqualification loss in any round, including a BTP winner without a local winner boolean', function() {
		const source = match(30, '<none>', { score_status: 'disqualified', team1_won: false });
		assert.deepStrictEqual(collect([match(40), source]), []);
		delete source.team1_won; source.btp_winner = 2;
		assert.deepStrictEqual(collect([match(40), source]), []);
		delete source.btp_winner; source.no_match_losing_team = 0;
		assert.deepStrictEqual(collect([match(40), source]), []);
	});

	it('does not resolve DSQ through a win, an unknown loser, a walkover or a retirement', function() {
		for (const score_status of ['normal', 'walkover', 'retired', 'no_match']) {
			assert.strictEqual(collect([match(30, 'DSQ', { score_status, team1_won: false })]).length, 1);
		}
		assert.strictEqual(collect([match(30, 'DSQ', { score_status: 'disqualified', team1_won: true })]).length, 1);
		assert.strictEqual(collect([match(30, 'DSQ', { score_status: 'disqualified' })]).length, 1);
	});

	it('keeps disciplines separate but includes group and placement rounds and typed player IDs', function() {
		const source = match(30, '<none>', { score_status: 'disqualified', team1_won: false });
		source.setup.event_name = 'MX U13';
		assert.strictEqual(collect([source, match(40)]).length, 1);
		source.setup.event_name = 'JE U13 - Gruppe A'; source.setup.teams[0].players[0].btp_id = '1';
		const later = match(40); later.setup.event_name = 'JE U13 - Position 5';
		assert.deepStrictEqual(collect([source, later]), []);
	});

	it('removes and restores the todo after status changes, ignoring stale aggregate labels', function() {
		const current = match(30); current.setup.teams[0].entry_status = 'DSQ';
		current.setup.teams[0].players[0].entries[5] = '<none>';
		assert.deepStrictEqual(collect([current]), []);
		current.setup.teams[0].players[0].entries[5] = 7;
		assert.strictEqual(collect([current]).length, 1);
		current.btp_match_ids[0].draw = 2;
		assert.deepStrictEqual(collect([current]), []);
	});

	it('tracks both doubles partners and skips placeholders and bye markers', function() {
		const current = match(30);
		current.setup.teams[0].players.push({ btp_id: 3, name: 'Partner', entries: { 5: 'DSQ' } });
		assert.strictEqual(collect([current]).length, 2);
		current.score_status = 'disqualified'; current.team1_won = false;
		assert.deepStrictEqual(collect([current]), []);
		const placeholder = match(40); placeholder.setup.is_match = false;
		const bye = match(50); bye.setup.is_bye = true;
		assert.deepStrictEqual(collect([placeholder, bye, match(60, 'DSQ', { _btp_auto_bye_winner_sync: true })]), []);
	});

	it('requests DSQ in BTP after a disqualified result and does not accept WDN as its replacement', function() {
		const current = match(30, 'WDN', { score_status: 'disqualified', team1_won: false });
		const { context } = ui([current]);
		assert.strictEqual(context.get_manual_btp_stage_status_warnings()[0].target_status, 'tournament:manual_btp_stage_status:target_dsq');
		current.setup.teams[0].players[0].entries[5] = 7;
		assert.strictEqual(context.get_manual_btp_stage_status_warnings().length, 0);
	});

	it('does not downgrade DSQ for older or cascaded withdrawal results and accepts FWDN as withdrawal', function() {
		for (const score_status of ['retired', 'no_match', 'walkover']) {
			const current = match(30, 'DSQ', { score_status, team1_won: false, no_match_losing_team: 0 });
			assert.strictEqual(ui([current]).context.get_manual_btp_stage_status_warnings().length, 0);
		}
		const current = match(30, 'FWDN', { score_status: 'retired', team1_won: false });
		assert.strictEqual(ui([current]).context.get_manual_btp_stage_status_warnings().length, 0);
	});

	it('gives the DSQ todo priority over an earlier/cascaded withdrawal todo in either order', function() {
		const source = match(30, '<none>', { score_status: 'disqualified', btp_winner: 2 });
		const following = match(40, '<none>', { score_status: 'no_match', no_match_losing_team: 0 });
		for (const matches of [[source, following], [following, source]]) {
			const warnings = ui(matches).context.get_manual_btp_stage_status_warnings();
			assert.strictEqual(warnings.length, 1);
			assert.strictEqual(warnings[0].target_status, 'tournament:manual_btp_stage_status:target_dsq');
		}
	});

	it('renders both mismatch directions in the existing yellow box and clears them after resolution', function() {
		const current = match(30), { context, nodes, translations } = ui([current]);
		context.render_manual_btp_stage_status_warnings({});
		assert.strictEqual(nodes[0].className, 'manual_btp_stage_status_warning');
		assert.strictEqual(nodes[1].text, 'ToDos');
		assert.strictEqual(translations.find(t => t.key.endsWith(':dsq_mismatch')).values.name, 'Player One');
		current.score_status = 'disqualified'; current.team1_won = false;
		nodes.length = 0; context.render_manual_btp_stage_status_warnings({});
		assert.strictEqual(nodes.length, 0);
		current.setup.teams[0].players[0].entries[5] = '<none>';
		context.render_manual_btp_stage_status_warnings({});
		assert.strictEqual(translations.find(t => t.key.endsWith(':entry')).values.status, 'tournament:manual_btp_stage_status:target_dsq');
	});
});
