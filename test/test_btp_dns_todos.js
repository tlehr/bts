'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { collect } = require('../static/js/btp_dns_todos');

const player = (id = 53, status = 'DNS') => ({ btp_id: id, name: 'Player ' + id, entries: { 5: status, 2: '<none>' } });
function match(number, participant = player(), extra = {}) {
	return { _id: 'm' + number, score_status: 'normal', btp_match_ids: [{ draw: 5, planning: number * 10 }],
		setup: { match_num: number, event_name: 'JE U13', is_match: true,
			teams: [{ players: [participant] }, { players: [player(99, '<none>')] }] }, ...extra };
}

describe('BTP DNS consistency todos', function() {
	it('refers to the first actual match, including a previously played normal loss', function() {
		const first = match(129, player(), { team1_won: false, network_score: [[12, 21], [16, 21]] });
		const later = match(196);
		const before = JSON.stringify([later, first]);
		assert.deepStrictEqual(collect([later, first]), [{ name: 'Player 53', event_name: 'JE U13', match_num: 129,
			match_id: 'm129', team_index: 0 }]);
		assert.strictEqual(JSON.stringify([later, first]), before, 'must not change results or player status');
	});

	it('uses only DNS for the current draw, leaving other disciplines and WDN alone', function() {
		const mixed = match(3); mixed.setup.event_name = 'MX U13'; mixed.btp_match_ids[0].draw = 2;
		assert.deepStrictEqual(collect([mixed, match(129, player(53, 'WDN'))]), []);
		assert.strictEqual(collect([mixed, match(129)])[0].match_num, 129);
	});

	it('handles numeric and string DNS codes, typed player IDs and imported team status', function() {
		for (const status of [108, '108', 'DNS']) {
			const first = match(129, player('53', status)), later = match(196, player(53, status));
			assert.strictEqual(collect([later, first]).length, 1);
		}
		const source = match(129); delete source.setup.teams[0].players[0].entries;
		source.setup.teams[0].entry_status = 'DNS';
		assert.strictEqual(collect([source]).length, 1);
	});

	it('requires the walkover loss to belong to the DNS participant in the first match', function() {
		const first = match(129), later = match(196);
		for (const score_status of ['walkover', 'no_match']) {
			first.score_status = score_status; first.no_match_losing_team = 0;
			assert.deepStrictEqual(collect([first, later]), []);
			first.no_match_losing_team = 1;
			assert.strictEqual(collect([first, later]).length, 1, 'a walkover win does not resolve DNS');
			delete first.no_match_losing_team; first.team1_won = false;
			assert.deepStrictEqual(collect([first, later]), []);
			delete first.team1_won;
			assert.strictEqual(collect([first, later]).length, 1, 'an unknown loser is not sufficient');
		}
		first.score_status = 'normal'; later.score_status = 'walkover'; later.no_match_losing_team = 0;
		assert.strictEqual(collect([later, first]).length, 1, 'a later walkover must not hide the missing first result');
	});

	it('removes and restores the todo on live DNS removal, result changes and reactivation', function() {
		const first = match(129);
		assert.strictEqual(collect([first]).length, 1);
		first.setup.teams[0].players[0].entries[5] = '<none>';
		first.setup.teams[0].entry_status = 'DNS';
		assert.deepStrictEqual(collect([first]), [], 'explicit current entry status overrides a stale team label');
		first.setup.teams[0].players[0].entries[5] = 'DNS'; first.score_status = 'walkover'; first.team1_won = false;
		assert.deepStrictEqual(collect([first]), []);
		first.score_status = 'normal'; delete first.team1_won;
		assert.strictEqual(collect([first]).length, 1);
	});

	it('skips placeholders and completed bye branches when choosing the first match', function() {
		const placeholder = match(100); placeholder.setup.is_match = false;
		const bye = match(110, player(), { team1_won: true, btp_winner: 1 });
		bye.setup.teams[1].players = []; bye.setup.state = 'finished';
		const marked = match(120, player(), { _btp_auto_bye_winner_sync: true });
		assert.strictEqual(collect([placeholder, bye, marked, match(129), match(196)])[0].match_num, 129);
	});

	it('follows known predecessors before mutable match numbers and orders independent roots by schedule', function() {
		const first = match(300), successor = match(100);
		successor.setup.links = { from1: 3000 };
		assert.strictEqual(collect([successor, first])[0].match_num, 300);
		delete successor.setup.links;
		first.setup.scheduled_date = successor.setup.scheduled_date = '2026-10-13';
		first.setup.scheduled_time_str = '09:00'; successor.setup.scheduled_time_str = '10:00';
		assert.strictEqual(collect([successor, first])[0].match_num, 300);
	});

	it('keeps one todo per affected doubles team across groups and placement matches', function() {
		const first = match(129); first.setup.event_name = 'JD U13 - Gruppe A';
		first.setup.teams[0].players.push(player(52));
		const later = match(196); later.setup.event_name = 'JD U13 - Position 5';
		later.setup.teams[0].players.push(player(52));
		const todos = collect([later, first]);
		assert.strictEqual(todos.length, 1); assert.strictEqual(todos[0].name, 'Player 53 / Player 52');
		assert.strictEqual(todos[0].event_name, 'JD U13');
	});

	it('renders the new todo in the existing yellow box alongside registration todos', function() {
		const source = fs.readFileSync(require.resolve('../static/js/cmatch'), 'utf8');
		const renderer = source.slice(source.indexOf('function render_manual_btp_stage_status_warnings('),
			source.indexOf('function refresh_manual_btp_stage_status_warnings('));
		const nodes = [], translations = [];
		const current = { matches: [match(129)] };
		const context = vm.createContext({ curt: current, btp_dns_todos: { collect },
			get_manual_btp_stage_status_warnings: () => [],
			ctournament: { get_registration_main_todos: () => ['Registration todo'] },
			ci18n: (key, values) => { translations.push({ key, values }); return key; },
			uiu: { el: (parent, tag, className, text) => { const node = { parent, tag, className, text }; nodes.push(node); return node; } },
		});
		vm.runInContext(renderer, context);
		context.render_manual_btp_stage_status_warnings({});
		assert.strictEqual(nodes[0].className, 'manual_btp_stage_status_warning');
		assert.strictEqual(nodes[1].text, 'ToDos');
		const todo = translations.find(t => t.key.endsWith(':dns_mismatch'));
		assert.strictEqual(todo.values.match_num, '#129'); assert.strictEqual(todo.values.name, 'Player 53');
		assert(nodes.some(node => node.text === 'Registration todo'));
		current.matches[0].setup.teams[0].players[0].entries[5] = '<none>';
		nodes.length = 0; translations.length = 0;
		context.render_manual_btp_stage_status_warnings({});
		assert(!translations.some(t => t.key.endsWith(':dns_mismatch')));
	});
});
