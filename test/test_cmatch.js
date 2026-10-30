'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {_describe, _it} = require('./tutils.js');

const calc = require('../static/bup/dev/js/calc');
const match_scoring = require('../static/js/match_scoring');
const timer = require('../static/bup/dev/js/timer');

function createFakeElement(tagName) {
	return {
		tagName,
		children: [],
		attributes: {},
		dataset: {},
		style: {},
		textContent: '',
		className: '',
		classList: {
			_values: new Set(),
			add(...names) {
				names.filter(Boolean).forEach((name) => this._values.add(name));
			},
			remove(...names) {
				names.forEach((name) => this._values.delete(name));
			},
			contains(name) {
				return this._values.has(name);
			},
			toggle(name, force) {
				const should_add = force === undefined ? !this._values.has(name) : !!force;
				if (should_add) {
					this._values.add(name);
				} else {
					this._values.delete(name);
				}
				return should_add;
			},
		},
		setAttribute(name, value) {
			this.attributes[name] = String(value);
			if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(value);
		},
		getAttribute(name) {
			return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
		},
		removeAttribute(name) {
			delete this.attributes[name];
			if (name.startsWith('data-')) delete this.dataset[name.slice(5)];
		},
		appendChild(child) {
			this.children.push(child);
			return child;
		},
		querySelectorAll() { return []; },
		addEventListener() {},
	};
}

function loadCmatchForUpdateCourtTest(tr, curt, history, query_each, search = '', contains = () => true) {
	const source = fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'cmatch.js'), 'utf8');
	const routes = [];
	const timeouts = [];
	const ci18n = (key) => key;
	ci18n.get_lang = () => 'de-DE';
	const context = {
		console,
		URLSearchParams,
		setTimeout(callback) { timeouts.push(callback); return timeouts.length; },
		clearTimeout() {},
		requestAnimationFrame() {},
		window: {
			innerWidth: 1200,
			location: { search },
			localStorage: { getItem() { return null; } },
			addEventListener() {},
			getComputedStyle() {
				return {
					getPropertyValue() {
						return '16px';
					}
				};
			},
		},
		document: {
			body: { contains },
			querySelectorAll() { return []; },
			getElementsByClassName() { return []; },
		},
		curt,
		cmatch_history: history,
		crouting: { register(pattern, load) { routes.push({ pattern, load }); } },
		ctournament: { switch_tournament(_key, callback) { callback(); } },
		change: { default_handler(fn) { return fn; } },
		ci18n,
		cerror: { net() {}, silent() {} },
		cflags: { render_flag_el() {} },
		cbts_utils: require('../static/js/cbts_utils'),
		ctabletoperator: { add_to_tabletoperator() {} },
		calc,
		match_scoring,
		timer,
		btp_entry_status: require('../static/js/btp_entry_status'),
		utils: {
			find(list, predicate) {
				return (list || []).find(predicate);
			},
			remove(list, predicate) {
				const idx = (list || []).findIndex(predicate);
				if (idx === -1) {
					return false;
				}
				list.splice(idx, 1);
				return true;
			},
		},
		uiu: {
			text(element, text) { element.textContent = text; },
			empty(element) { element.children.length = 0; },
			qs(selector) {
				if (selector === `tr[data-court_id="${tr.getAttribute('data-court_id')}"]`) {
					return tr;
				}
				return null;
			},
			qsEach(selector, callback) {
				if (query_each) query_each(selector, callback);
				else if (selector === `tr[data-court_id="${tr.getAttribute('data-court_id')}"]`) callback(tr);
			},
			el(parent, tagName, attrsOrClass, text) {
				const el = createFakeElement(tagName);
				if (typeof attrsOrClass === 'string') {
					el.className = attrsOrClass;
					if (attrsOrClass) {
						el.classList.add(...attrsOrClass.split(/\s+/).filter(Boolean));
					}
				} else if (attrsOrClass && typeof attrsOrClass === 'object') {
					Object.entries(attrsOrClass).forEach(([key, value]) => {
						if (key === 'class') {
							el.className = value;
							el.classList.add(...String(value).split(/\s+/).filter(Boolean));
						} else {
							el.setAttribute(key, value);
						}
					});
				}
				if (text !== undefined) {
					el.textContent = text;
				}
				parent.appendChild(el);
				return el;
			},
		},
	};
	vm.createContext(context);
	vm.runInContext(source, context, { filename: 'cmatch.js' });
	context.cmatch.test_routes = routes;
	context.cmatch.test_timeouts = timeouts;
	return context.cmatch;
}

_describe('cmatch', () => {
	_it('renders courts numerically from an unordered live list, including two-digit numbers and location filters', () => {
		const numbers = [13, 11, 8, 12, 6, 1, 2, 3, 4, 5, 7, 9, 10];
		const courts = numbers.map(num => ({ _id: 'court-' + num, num: String(num), is_active: num !== 8,
			location_id: num % 2 ? 'hall-one' : 'hall-two' }));
		for (const search of ['', '?location=First']) {
			const container = createFakeElement('div');
			const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), { courts, matches: [],
				locations: [{ _id: 'hall-one', name: 'First' }, { _id: 'hall-two', name: 'Second' }],
			}, null, null, search);
			cmatch.render_courts(container);
			const ids = container.children[0].children[0].children.map(row => row.getAttribute('data-court_id'));
			const expected = Array.from({ length: 13 }, (_, i) => i + 1).filter(num => !search || num % 2);
			assert.deepStrictEqual(ids, expected.map(num => 'court-' + num));
			assert.deepStrictEqual(courts.map(court => Number(court.num)), numbers, 'rendering must not mutate its input list');
		}
	});

	_it('refreshes preparation permissions without rebuilding rows or unchanged call buttons', () => {
		const location = { _id: 'hall' };
		const matches = [1, 2].map(id => ({ _id: 'm' + id, setup: { state: 'scheduled', is_match: true,
			teams: [{ players: [{ btp_id: id * 2 }] }, { players: [{ btp_id: id * 2 + 1 }] }] } }));
		let removed = 0;
		const cells = matches.map(() => {
			const cell = { buttons: [], querySelectorAll() { return this.buttons; } };
			const button = { dataset: { location_id: 'hall' }, remove() { removed++; cell.buttons = []; } };
			cell.buttons.push(button);
			return cell;
		});
		const rows = matches.map((match, index) => ({ dataset: { match_id: match._id }, querySelector() { return cells[index]; } }));
		const container = { querySelectorAll() { return rows; } };
		const unchanged_button = cells[1].buttons[0];
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), {
			matches, locations: [location], location_preparation_selection_by_location_id: {
				hall: { diagnostics_by_match_id: { m1: { manual_eligible: false }, m2: { manual_eligible: true } } },
			},
		}, null, (selector, callback) => { if (selector === '.unassigned_container') callback(container); });
		cmatch.refresh_unassigned_preparation_context();
		assert.strictEqual(removed, 1);
		assert.deepStrictEqual(cells[0].buttons, []);
		assert.strictEqual(cells[1].buttons[0], unchanged_button);
		cmatch.refresh_unassigned_preparation_context();
		assert.strictEqual(removed, 1);
		assert.strictEqual(cells[1].buttons[0], unchanged_button);
	});

	_it('moves existing scheduled rows in both directions without rebuilding cells or touching already sorted rows', () => {
		const matches = [1, 2, 3].map(id => ({ _id: 'm' + id, match_order: id + 1,
			setup: { match_num: id, scheduled_date: '2026-10-23', scheduled_time_str: '10:30' } }));
		let moves = 0;
		const tbody = { tagName: 'TBODY', children: [], insertBefore(row, before) {
			moves++;
			this.children.splice(this.children.indexOf(row), 1);
			const index = before ? this.children.indexOf(before) : this.children.length;
			this.children.splice(index, 0, row);
		} };
		const rows = matches.map(match => {
			const row = { dataset: { match_id: match._id }, parentElement: tbody, cells: [match._id] };
			Object.defineProperty(row, 'nextElementSibling', { get: () => tbody.children[tbody.children.indexOf(row) + 1] || null });
			Object.defineProperty(row, 'innerHTML', { set() { throw new Error('row was rebuilt'); } });
			return row;
		});
		tbody.children.push(...rows);
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), { matches }, null,
			(selector, callback) => {
				for (const row of rows) if (selector === 'tr[data-match_id=' + JSON.stringify(row.dataset.match_id) + ']') callback(row);
			});
		matches[2].match_order = 1;
		cmatch.reorder_match_row(matches[2], 'unassigned');
		assert.deepStrictEqual(tbody.children, [rows[2], rows[0], rows[1]]);
		assert.strictEqual(moves, 1);
		cmatch.reorder_match_row(matches[2], 'unassigned');
		assert.strictEqual(moves, 1);
		matches[2].match_order = 0;
		cmatch.reorder_match_row(matches[2], 'unassigned');
		assert.deepStrictEqual(tbody.children, rows);
		assert.strictEqual(moves, 2);
		assert.deepStrictEqual(rows.map(row => row.cells), [['m1'], ['m2'], ['m3']]);
		cmatch.reorder_match_row(matches[2], 'court_c1');
		assert.strictEqual(moves, 2, 'court positions must remain fixed');
		matches.forEach((match, index) => { match.end_ts = 3 - index; });
		matches[2].end_ts = 4;
		cmatch.reorder_match_row(matches[2], 'finished');
		assert.deepStrictEqual(tbody.children, [rows[2], rows[0], rows[1]]);
		assert.strictEqual(moves, 3);
	});

	_it('keeps unassigned BTP positions after explicitly ordered games in both browser and automation', () => {
		const matches = Array.from({ length: 13 }, (_, index) => ({ _id: String(index + 40), match_order: index < 8 ? index + 1 : 0,
			setup: { state: 'scheduled', match_num: index + 40, scheduled_date: '2026-09-26', scheduled_time_str: '11:00' } }));
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), { matches }, null);
		const compare = require('../bts/match_automation').cmp_scheduled_match_order;
		const shuffled = [...matches.slice(8), ...matches.slice(0, 8)];
		const before = JSON.stringify(shuffled);
		for (const comparator of [cmatch.cmp_match_order, compare]) {
			assert.deepStrictEqual([...shuffled].sort(comparator).map(match => match.setup.match_num), matches.map(match => match.setup.match_num));
		}
		assert.strictEqual(JSON.stringify(shuffled), before, 'sorting must not rewrite positions sent back to BTP');
		matches[12].match_order = undefined;
		assert.strictEqual(compare(matches[0], matches[12]), -1);
	});

	_it('lists no-match results under finished even without a winner or with older setup state', () => {
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), {});
		for (const state of ['scheduled', 'preparation', 'oncourt', 'finished']) {
			const match = { score_status: 'no_match', setup: { state, court_id: 'court', now_on_court: state === 'oncourt' } };
			assert.strictEqual(cmatch.calc_section(match), 'finished', state);
		}
		assert.strictEqual(cmatch.calc_section({ setup: { state: 'finished' } }), 'finished');
		assert.strictEqual(cmatch.calc_section({ setup: { state: 'scheduled' } }), 'unassigned');
		assert.strictEqual(cmatch.calc_section({ setup: { state: 'oncourt', court_id: 'court', now_on_court: true } }), 'court_court');
	});

	_it('loads deferred finished histories before editing or reconstructing a scoresheet', () => {
		const match = { _id: 'finished', setup: { state: 'finished' }, presses_deferred: true };
		const requested = [];
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), { matches: [match] },
			{ load(source) { requested.push(source); } });
		for (const view of ['edit', 'scoresheet']) {
			const url = 't/default/m/finished/' + view;
			const route = cmatch.test_routes.find(r => r.pattern.test(url));
			route.load(route.pattern.exec(url));
		}
		assert.deepStrictEqual(requested, [match, match]);
	});

	_it('detects match end for default 3x21 fallback', () => {
		assert.strictEqual(match_scoring.is_match_over([[21, 10], [21, 18]], null), true);
		assert.strictEqual(match_scoring.is_match_over([[21, 10], [18, 21]], null), false);
	});

	_it('detects match end for 1x21 scoring format', () => {
		const scoringFormat = {
			numSets: 1,
			set_points: { end_points: 21, max_points: 30 },
			last_set_points: { end_points: 21, max_points: 30 },
		};

		assert.strictEqual(match_scoring.is_match_over([[21, 19]], scoringFormat), true);
		assert.strictEqual(match_scoring.is_match_over([[20, 19]], scoringFormat), false);
	});

	_it('uses last-set limits for deciding the final set', () => {
		const scoringFormat = {
			numSets: 3,
			set_points: { end_points: 21, max_points: 30 },
			last_set_points: { end_points: 11, max_points: 15 },
		};

		assert.strictEqual(match_scoring.is_match_over([[21, 18], [19, 21], [11, 9]], scoringFormat), true);
		assert.strictEqual(match_scoring.is_match_over([[21, 18], [19, 21], [10, 9]], scoringFormat), false);
	});

	_it('hides the admin match timer after side choice', () => {
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), {});

		assert.strictEqual(cmatch._should_hide_admin_match_timer({
			presses: [{ type: 'pick_side', timestamp: 1770000005000, team1_left: true }],
		}), true);
	});

	_it('hides the admin match timer after the first point without press history', () => {
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), {});

		assert.strictEqual(cmatch._should_hide_admin_match_timer({
			network_score: [[1, 0]],
		}), true);
		assert.strictEqual(cmatch._should_hide_admin_match_timer({
			network_score: [[0, 0]],
		}), false);
	});

	_it('keeps admin pause timer visible after an interval point', () => {
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), {});
		const presses = [
			{ type: 'pick_side', timestamp: 1770000000000, team1_left: true },
			{ type: 'love-all', timestamp: 1770000001000 },
		];
		for (let idx = 0; idx < 11; idx += 1) {
			presses.push({ type: 'score', timestamp: 1770000002000 + idx * 1000, side: 'left' });
		}

		const timerState = cmatch._extract_match_timer_state({
			setup: {
				match_id: 'match-1',
				is_match: true,
				is_doubles: false,
				counting: '1x21',
				scoring_format: calc.scoring_format_from_counting('1x21'),
				teams: [
					{ players: ['Alice Example'] },
					{ players: ['Bob Example'] },
				],
			},
			presses,
		});

		assert.strictEqual(timerState.timer.start, 1770000012000);
		assert.strictEqual(timerState.timer.duration, 60000);
	});

	_it('does not reconstruct admin timers for finished matches with stale press history', () => {
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), {});
		const presses = [
			{ type: 'pick_side', timestamp: 1770000000000, team1_left: true },
			{ type: 'love-all', timestamp: 1770000001000 },
			{ type: 'score', timestamp: 1770000002000, side: 'left' },
			{ type: 'postgame-confirm', timestamp: 1770000003000 },
		];

		const timerState = cmatch._extract_match_timer_state({
			_id: 'match-1',
			team1_won: true,
			end_ts: 1770000004000,
			setup: {
				match_id: 'match-1',
				match_num: 36,
				state: 'finished',
				is_match: true,
				is_doubles: false,
				counting: '1x21',
				scoring_format: calc.scoring_format_from_counting('1x21'),
				teams: [
					{ players: ['Alice Example'] },
					{ players: ['Bob Example'] },
				],
			},
			presses,
		});

		assert.strictEqual(timerState, null);
	});
	_it('uses the field timer warning thresholds for warmup, intervals and set breaks, including overtime and resets', () => {
		const tournament = { test_clock: { mode: 'fixed', fixed_ts: 1770000000000 } };
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), tournament);
		const start = tournament.test_clock.fixed_ts;
		const setup = {
			match_id: 'timer-test', is_match: true, is_doubles: false, counting: '3x21',
			scoring_format: calc.scoring_format_from_counting('3x21'),
			teams: [{ players: ['Alice Example'] }, { players: ['Bob Example'] }],
			warmup: 'call-down', warmup_start: 180, warmup_ready: 120, called_timestamp: start,
		};
		const presses = [
			{ type: 'pick_side', timestamp: start + 1000, team1_left: true },
			{ type: 'love-all', timestamp: start + 2000 },
		];
		const scenarios = [{ name: 'configured warmup', state: cmatch._extract_match_timer_state({ setup, presses: [] }), threshold: 60499 }];
		for (let point = 1; point <= 21; point++) {
			presses.push({ type: 'score', timestamp: start + 2000 + point * 1000, side: 'left' });
			if (point === 11 || point === 21) scenarios.push({
				name: point === 11 ? 'interval' : 'set break',
				state: cmatch._extract_match_timer_state({ setup, presses: [...presses] }), threshold: 25000,
			});
		}
		for (const { name, state, threshold } of scenarios) {
			assert.strictEqual(state.timer.exigent, threshold, name);
			const parent = createFakeElement('td');
			tournament.test_clock.fixed_ts = state.timer.start + state.timer.duration - threshold - 1000;
			const handle = cmatch.create_timer(state, parent, '#cccccc', '#ff0000');
			const node = parent.children[0];
			assert.strictEqual(node.classList.contains('timer_exigent'), false, name + ' before warning');
			for (const remaining of [threshold, 40000, 20000, 1, 0, -1, -12000, threshold + 1000]) {
				tournament.test_clock.fixed_ts = state.timer.start + state.timer.duration - remaining;
				cmatch.test_timeouts[handle.timeout - 1]();
				const field = timer.calc(state, tournament.test_clock.fixed_ts);
				const warning = !!(field.exigent || field.ms <= 0);
				assert.strictEqual(node.classList.contains('timer_exigent'), warning, name + ' at ' + remaining + 'ms');
				assert.strictEqual(node.classList.contains('timer_overdue'), field.ms < 0, name + ' at ' + remaining + 'ms');
				assert.strictEqual(node.style.color, warning ? '#ff0000' : '#cccccc', name);
				assert.strictEqual(node.textContent, field.str, name);
			}
		}
	});
	_it('keeps elapsed preparation and call-up timers outside the countdown warning state', () => {
		const start = 1770000000000;
		const tournament = { test_clock: { mode: 'fixed', fixed_ts: start + 600000 } };
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), tournament);
		const parent = createFakeElement('td');
		const handle = cmatch.create_timer({ settings: {}, timer: { start, upwards: true } }, parent, '#cccccc', '#ff0000');
		for (const elapsed of [0, 600000]) {
			tournament.test_clock.fixed_ts = start + elapsed;
			cmatch.test_timeouts[handle.timeout - 1]();
			assert.strictEqual(parent.children[0].classList.contains('timer_exigent'), false);
			assert.strictEqual(parent.children[0].classList.contains('timer_overdue'), false);
			assert.strictEqual(parent.children[0].style.color, '#cccccc');
		}
	});
	_it('cancels a stopped timer without letting an already queued callback restart it', () => {
		const start = 1770000000000, tournament = { test_clock: { mode: 'fixed', fixed_ts: start } };
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), tournament);
		const parent = createFakeElement('td');
		const handle = cmatch.create_timer({ settings: {}, timer: { start, upwards: true } }, parent, '#cccccc', '#ff0000');
		const callback = cmatch.test_timeouts[handle.timeout - 1], before = parent.children[0].textContent;
		const count = cmatch.test_timeouts.length;
		handle.stop();tournament.test_clock.fixed_ts += 30000;callback();
		assert.strictEqual(handle.timeout, null);
		assert.strictEqual(parent.children[0].textContent, before);
		assert.strictEqual(cmatch.test_timeouts.length, count);
	});
	_it('updates an existing timer state and clears an obsolete background without replacing its element', () => {
		const start = 1770000000000, tournament = { test_clock: { mode: 'fixed', fixed_ts: start + 30000 } };
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), tournament);
		const parent = createFakeElement('td');
		const handle = cmatch.create_timer({ settings: {}, timer: { start, duration: 60000 }, bgColor: '#ff0000' }, parent, '#ffffff', '#ffffff');
		const element = handle.element;
		const extended = { settings: {}, timer: { start, duration: 120000 }, bgColor: '#0000ff' };
		handle.setState(extended);
		assert.strictEqual(handle.element, element);
		assert.strictEqual(parent.children.length, 1);
		assert.strictEqual(element.textContent, timer.calc(extended, tournament.test_clock.fixed_ts).str);
		assert.strictEqual(element.style.backgroundColor, '#0000ff');
		const without_background = { settings: {}, timer: { start, upwards: true } };
		handle.setState(without_background);
		assert.strictEqual(element.style.backgroundColor, '');
		assert.strictEqual(element.textContent, timer.calc(without_background, tournament.test_clock.fixed_ts).str);
		handle.stop();
	});
	_it('stops a timer discarded before its first attachment and does not resurrect it on a late callback', () => {
		const start = 1770000000000, tournament = { test_clock: { mode: 'fixed', fixed_ts: start } };
		let attached = false;
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), tournament, null, null, '', () => attached);
		const handle = cmatch.create_timer({ settings: {}, timer: { start, upwards: true } }, createFakeElement('td'), '#cccccc', '#ff0000');
		const callback = cmatch.test_timeouts[handle.timeout - 1], count = cmatch.test_timeouts.length;
		callback();
		assert.strictEqual(handle.timeout, null);
		assert.strictEqual(cmatch.test_timeouts.length, count);
		attached = true;callback();
		assert.strictEqual(cmatch.test_timeouts.length, count);
	});

	_it('allows manual preparation calls for deferred matches with tablet operators', () => {
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), {
			matches: [],
			courts: [],
		});
		const match = {
			setup: {
				state: 'scheduled',
				preparation_call_deferred: true,
				is_match: true,
				incomplete: false,
				teams: [
					{ players: [{ btp_id: 1, now_tablet_on_court: 'court-1' }] },
					{ players: [{ btp_id: 2 }] },
				],
			},
		};

		assert.strictEqual(cmatch._is_manual_preparation_call_allowed_for_location(match, { _id: 'l1' }), true);
	});

	_it('does not show stale tablet operator court badges from non-running matches', () => {
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), {
			tabletoperators: [],
			matches: [
				{
					_id: 'old-match',
					setup: {
						now_on_court: false,
						court_id: 'default_3',
						tabletoperators: [
							{ btp_id: 7, now_tablet_on_court: 'default_3' },
						],
					},
				},
			],
		});

		assert.strictEqual(
			cmatch._active_tabletoperator_court_for_player({ btp_id: 7, now_tablet_on_court: 'default_3' }),
			false
		);
	});

	_it('shows tablet operator court badges for running matches', () => {
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), {
			tabletoperators: [],
			matches: [
				{
					_id: 'running-match',
					setup: {
						now_on_court: true,
						court_id: 'default_3',
						tabletoperators: [
							{ btp_id: 7 },
						],
					},
				},
			],
		});

		assert.strictEqual(
			cmatch._active_tabletoperator_court_for_player({ btp_id: 7 }),
			'default_3'
		);
	});

	_it('marks preparation callable only when the automatic call window is eligible', () => {
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), {
			location_preparation_selection_by_location_id: {
				l1: {
					diagnostics_by_match_id: {
						manual_only: {
							manual_eligible: true,
							criteria_eligible: true,
							within_call_window: false,
							eligible: false,
						},
						automatic: {
							manual_eligible: true,
							criteria_eligible: true,
							within_call_window: true,
							eligible: true,
						},
					},
				},
			},
		});

		const callable = cmatch._get_preparation_callable_match_ids();

		assert.strictEqual(callable.has('manual_only'), false);
		assert.strictEqual(callable.has('automatic'), true);
	});

	_it('hides manual preparation calls while a player is playing', () => {
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), {
			matches: [],
			courts: [],
		});
		const match = {
			setup: {
				state: 'scheduled',
				is_match: true,
				incomplete: false,
				teams: [
					{ players: [{ btp_id: 1, now_playing_on_court: 'court-1' }] },
					{ players: [{ btp_id: 2 }] },
				],
			},
		};

		assert.strictEqual(cmatch._is_manual_preparation_call_allowed_for_location(match, { _id: 'l1' }), false);
	});

	_it('hides manual preparation calls for players removed by special result in the same discipline', () => {
		const source = {
			score_status: 'retired',
			team1_won: true,
			setup: {
				event_name: 'JE U13 - Gruppe A',
				teams: [
					{ players: [{ btp_id: 1 }] },
					{ players: [{ btp_id: 2 }] },
				],
			},
		};
		const match = {
			setup: {
				event_name: 'JE U13 - Position 1-4',
				state: 'scheduled',
				is_match: true,
				incomplete: false,
				teams: [
					{ players: [{ btp_id: 2 }] },
					{ players: [{ btp_id: 3 }] },
				],
			},
		};
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), {
			matches: [source, match],
			courts: [],
		});

		assert.strictEqual(cmatch._is_manual_preparation_call_allowed_for_location(match, { _id: 'l1' }), false);
	});

	_it('clears a stale finished match from a court row when the court is updated', () => {
		const tr = createFakeElement('tr');
		tr.setAttribute('data-court_id', 'court-1');
		tr.setAttribute('data-match_id', 'match-1');
		tr.setAttribute('data-style', 'default');
		tr.innerHTML = '<td>stale</td>';

		const cmatch = loadCmatchForUpdateCourtTest(tr, {
			matches: [{
				_id: 'match-1',
				setup: {
					is_match: true,
					state: 'finished',
					now_on_court: false,
				},
			}],
		});

		cmatch.update_court({ _id: 'court-1', num: '1', is_active: true });

		assert.strictEqual(tr.getAttribute('data-match_id'), null);
		assert.strictEqual(tr.children.length, 3);
		assert.strictEqual(tr.children[1].classList.contains('court_number'), true);
		assert.strictEqual(tr.children[2].classList.contains('empty_element'), true);
	});
	_it('detaches the old match immediately when freeing its fixed court slot', () => {
		const row = createFakeElement('tr'), court = { _id: 'court-1', num: '1', is_active: true };
		row.setAttribute('data-court_id', court._id); row.setAttribute('data-match_id', 'match-1');
		const match = { _id: 'match-1', setup: { state: 'finished' } };
		const cmatch = loadCmatchForUpdateCourtTest(row, { courts: [court], matches: [match] }, null, (selector, cb) => {
			if (selector === '.court_row[data-court_id="court-1"]') cb(row);
		});
		cmatch.remove_match_from_gui(match, 'court_court-1');
		assert.strictEqual(row.getAttribute('data-match_id'), null);
		assert.strictEqual(row.getAttribute('data-court_id'), court._id);
		assert.strictEqual(row.children[2].classList.contains('empty_element'), true);
	});
	_it('keeps a finished court green through confirmation and clears it for the next live match', () => {
		const row = createFakeElement('tr');
		row.setAttribute('data-court_id', 'court-1');
		const match = {
			_id: 'match-1', network_score: [[21, 15], [20, 18]],
			setup: { court_id: 'court-1', now_on_court: true, state: 'oncourt' },
		};
		const tournament = {
			courts: [{ _id: 'court-1', is_active: true }], matches: [match],
			location_preparation_selection_by_location_id: {},
		};
		const cmatch = loadCmatchForUpdateCourtTest(row, tournament, null, (selector, callback) => {
			if (selector === '.court_row[data-court_id]' || selector === '.court_row[data-court_id="court-1"]') callback(row);
		});
		const marked = () => row.classList.contains('preparation_demand_court');
		cmatch.update_preparation_demand_court_markers();
		assert.strictEqual(marked(), false);
		match.network_score[1] = [21, 18];
		cmatch.update_match_score(match);
		assert.strictEqual(marked(), true, 'the final live point needs a successor without fresh selection data');
		assert.strictEqual(row.getAttribute('data-preparation-demand-court'), 'true');
		match.team1_won = true;
		match.setup.state = 'finished';
		match.setup.now_on_court = false;
		cmatch.update_match(match, 'finished', 'finished');
		assert.strictEqual(marked(), true, 'confirmation must not clear the empty field');
		tournament.matches.push({
			_id: 'match-2', network_score: [[0, 0]],
			setup: { court_id: 'court-1', now_on_court: true, state: 'oncourt' },
		});
		cmatch.update_preparation_demand_court_markers();
		assert.strictEqual(marked(), false, 'a new live game replaces the finished game');
		assert.strictEqual(row.getAttribute('data-preparation-demand-court'), null);
		match.setup.now_on_court = true;
		cmatch.update_preparation_demand_court_markers();
		assert.strictEqual(marked(), false, 'an old confirmed result cannot mark its successor green');
	});
	_it('updates only the affected field with the point flag and ignores stale demand diagnostics', () => {
		const row = createFakeElement('tr'), neighbor = createFakeElement('tr');
		row.setAttribute('data-court_id', 'court-1');neighbor.setAttribute('data-court_id', 'court-2');
		const match = { _id: 'match-1', network_score: [[21, 18], [9, 7]],
			setup: { court_id: 'court-1', now_on_court: true, state: 'oncourt', needs_preparation_successor: false } };
		const tournament = { courts: [{ _id: 'court-1', is_active: true }, { _id: 'court-2', is_active: true }], matches: [match],
			location_preparation_selection_by_location_id: { hall: { demand_court_ids: [] } } };
		let neighborUpdates = 0;
		const cmatch = loadCmatchForUpdateCourtTest(row, tournament, null, (selector, callback) => {
			if (selector === '.court_row[data-court_id="court-1"]') callback(row);
			if (selector === '.court_row[data-court_id="court-2"]' || selector === '.court_row[data-court_id]') neighborUpdates++;
		});
		cmatch.update_match_score(match);
		assert.strictEqual(row.classList.contains('preparation_demand_court'), false);
		match.network_score[1][0] = 10;match.setup.needs_preparation_successor = true;
		cmatch.update_match_score(match);
		assert.strictEqual(row.classList.contains('preparation_demand_court'), true);
		assert.strictEqual(neighborUpdates, 0);
		match.network_score[1][0] = 9;match.setup.needs_preparation_successor = false;
		tournament.location_preparation_selection_by_location_id.hall.demand_court_ids = ['court-1'];
		cmatch.update_match_score(match);
		assert.strictEqual(row.classList.contains('preparation_demand_court'), false, 'an older positive diagnosis must not override the new point');
		assert.strictEqual(row.getAttribute('data-preparation-demand-court'), null);
	});
	_it('marks free active courts but excludes disabled courts from successor demand', () => {
		const active = createFakeElement('tr'), inactive = createFakeElement('tr');
		active.setAttribute('data-court_id', 'court-1');
		inactive.setAttribute('data-court_id', 'court-2');
		const tournament = {
			courts: [{ _id: 'court-1', is_active: true }, { _id: 'court-2', is_active: false }],
			matches: [], location_preparation_selection_by_location_id: { hall: { demand_court_ids: ['court-2'] } },
		};
		const cmatch = loadCmatchForUpdateCourtTest(active, tournament, null, (selector, callback) => {
			if (selector === '.court_row[data-court_id]') [active, inactive].forEach(callback);
		});
		cmatch.update_preparation_demand_court_markers();
		assert.strictEqual(active.classList.contains('preparation_demand_court'), true);
		assert.strictEqual(inactive.classList.contains('preparation_demand_court'), false);
	});
	_it('never repurposes or reorders a court slot during result updates even with an old match binding', () => {
		const row = createFakeElement('tr');
		row.setAttribute('data-court_id', 'court-1'); row.setAttribute('data-match_id', 'match-1');
		Object.defineProperty(row, 'innerHTML', { set() { throw Error('court slot was repainted as a result'); } });
		row.parentElement = { tagName: 'TBODY', get children() { throw Error('court slots were sorted by game order'); } };
		const match = { _id: 'match-1', setup: { state: 'finished' } };
		const cmatch = loadCmatchForUpdateCourtTest(row, { matches: [match] }, null, (selector, cb) => {
			if (selector === 'tr[data-match_id="match-1"]') cb(row);
		});
		cmatch.reorder_match_row(match, 'finished');
		cmatch.update_match(match, 'finished', 'finished');
	});
	_it('ignores court changes when that field is absent from a filtered admin view', () => {
		const cmatch = loadCmatchForUpdateCourtTest(createFakeElement('tr'), { matches: [] }, null, () => {});
		cmatch.update_court({ _id: 'hidden-court', num: '14', is_active: true });
	});

	_it('keeps the court match row when the referenced match is still on court', () => {
		const tr = createFakeElement('tr');
		tr.setAttribute('data-court_id', 'court-1');
		tr.setAttribute('data-match_id', 'match-1');
		tr.setAttribute('data-style', 'public');
		tr.innerHTML = '<td>old</td>';

		const cmatch = loadCmatchForUpdateCourtTest(tr, {
			key: 'default',
			btp_settings: { check_in_per_match: false },
			courts_by_id: {
				'court-1': { _id: 'court-1', num: '1', is_active: true }
			},
			matches: [{
				_id: 'match-1',
				setup: {
					is_match: true,
					state: 'oncourt',
					now_on_court: true,
					court_id: 'court-1',
					teams: [
						{ players: [{ btp_id: 1, name: 'Alice Example', firstname: 'Alice', lastname: 'Example', checked_in: true }] },
						{ players: [{ btp_id: 2, name: 'Bob Example', firstname: 'Bob', lastname: 'Example', checked_in: true }] },
					],
					match_num: 12,
					scheduled_date: '2026-04-15',
					scheduled_time_str: '10:00',
				},
			}],
		});

		cmatch.update_court({ _id: 'court-1', num: '1', is_active: true });

		assert.strictEqual(tr.getAttribute('data-match_id'), 'match-1');
		assert.notStrictEqual(tr.children.length, 0);
	});

	_it('resolves CP-VF participant dependencies per slot instead of by shared candidate order', () => {
		const tr = createFakeElement('tr');
		tr.setAttribute('data-court_id', 'court-1');
		const cmatch = loadCmatchForUpdateCourtTest(tr, {
			matches: [],
		});

		const target = {
			_id: 'target',
			btp_match_ids: [{ planning: 3005 }],
			setup: {
				links: {
					from1: 4009,
					from2: 4010,
				}
			}
		};
		const predecessor = {
			_id: 'pred-1',
			btp_match_ids: [{ planning: 4009 }],
			setup: {
				is_match: true,
				match_num: 18,
				scheduled_date: '2026-04-18',
				scheduled_time_str: '11:30',
				links: {
					winner_to: 3005,
					loser_to: 3009,
				}
			}
		};

		assert.strictEqual(
			cmatch._format_participant_dependency(target, 0, [predecessor]),
			'Winner #18 - 18.4.2026 11:30'
		);
		assert.strictEqual(
			cmatch._format_participant_dependency(target, 1, [predecessor]),
			'???'
		);
	});

	_it('uses direct link labels before trying to infer a predecessor match', () => {
		const tr = createFakeElement('tr');
		tr.setAttribute('data-court_id', 'court-1');
		const cmatch = loadCmatchForUpdateCourtTest(tr, {
			matches: [],
		});

		const target = {
			_id: 'target',
			btp_match_ids: [{ planning: 3005 }],
			setup: {
				links: {
					from1: 4009,
					from2: 4010,
					from1_link: 'CP-VF (5/12)',
				}
			}
		};

		assert.strictEqual(
			cmatch._format_participant_dependency(target, 0, []),
			'CP-VF (5/12)'
		);
	});

	_it('adds predecessor time to direct winner labels that lack it', () => {
		const tr = createFakeElement('tr');
		tr.setAttribute('data-court_id', 'court-1');
		const cmatch = loadCmatchForUpdateCourtTest(tr, {
			matches: [],
		});

		const target = {
			_id: 'target',
			btp_match_ids: [{ planning: 3005 }],
			setup: {
				links: {
					from1: 4009,
					from1_link: 'Winner #18',
				}
			}
		};
		const predecessor = {
			_id: 'pred-1',
			btp_match_ids: [{ planning: 4009 }],
			setup: {
				is_match: true,
				match_num: 18,
				scheduled_date: '2026-04-18',
				scheduled_time_str: '11:30',
				links: {
					winner_to: 3005,
				}
			}
		};

		assert.strictEqual(
			cmatch._format_participant_dependency(target, 0, [predecessor]),
			'Winner #18 - 18.4.2026 11:30'
		);
	});

	_it('localizes date in direct winner labels that already include ISO date', () => {
		const tr = createFakeElement('tr');
		tr.setAttribute('data-court_id', 'court-1');
		const cmatch = loadCmatchForUpdateCourtTest(tr, {
			matches: [],
		});

		const target = {
			_id: 'target',
			setup: {
				links: {
					from1_link: 'Winner #18 - 2026-04-18 11:30',
				}
			}
		};

		assert.strictEqual(
			cmatch._format_participant_dependency(target, 0, []),
			'Winner #18 - 18.4.2026 11:30'
		);
	});

	_it('resolves a predecessor through a placeholder planning node for the correct slot', () => {
		const tr = createFakeElement('tr');
		tr.setAttribute('data-court_id', 'court-1');
		const cmatch = loadCmatchForUpdateCourtTest(tr, {
			matches: [],
		});

		const target = {
			_id: 'target',
			btp_match_ids: [{ planning: 3005 }],
			setup: {
				links: {
					from1: 4010,
					from2: 4011,
				}
			}
		};
		const placeholder = {
			_id: 'placeholder-1',
			btp_match_ids: [{ planning: 4010 }],
			setup: {
				is_match: false,
				links: {
					from1: 5017,
					from2: 5018,
				}
			}
		};
		const predecessor = {
			_id: 'pred-1',
			btp_match_ids: [{ planning: 4009 }],
			setup: {
				is_match: true,
				match_num: 18,
				scheduled_date: '2026-04-18',
				scheduled_time_str: '11:30',
				links: {
					from1: 5017,
					from2: 5018,
					winner_to: 3005,
					loser_to: 3009,
				}
			}
		};

		assert.strictEqual(
			cmatch._format_participant_dependency(target, 0, [placeholder, predecessor]),
			'Winner #18 - 18.4.2026 11:30'
		);
		assert.strictEqual(
			cmatch._format_participant_dependency(target, 1, [placeholder, predecessor]),
			'???'
		);
	});

	_it('falls back to incoming loser edges when a source planning has no local match node', () => {
		const tr = createFakeElement('tr');
		tr.setAttribute('data-court_id', 'court-1');
		const cmatch = loadCmatchForUpdateCourtTest(tr, {
			matches: [],
		});

		const target = {
			_id: 'target',
			btp_match_ids: [{ planning: 3005 }],
			setup: {
				links: {
					from1: 4009,
					from2: 4010,
				}
			}
		};
		const feederA = {
			_id: 'r16-7',
			btp_match_ids: [{ planning: 4007 }],
			setup: {
				is_match: true,
				match_num: 7,
				scheduled_date: '2026-04-18',
				scheduled_time_str: '09:00',
				links: {
					loser_to: 4010,
				}
			}
		};
		const feederB = {
			_id: 'r16-8',
			btp_match_ids: [{ planning: 4008 }],
			setup: {
				is_match: true,
				match_num: 8,
				scheduled_date: '2026-04-18',
				scheduled_time_str: '09:30',
				links: {
					loser_to: 4010,
				}
			}
		};

		assert.strictEqual(
			cmatch._format_participant_dependency(target, 1, [feederB, feederA]),
			'Loser #7 / #8'
		);
	});

	_it('prefers the visible consolidation match number for hidden loser slots', () => {
		const tr = createFakeElement('tr');
		tr.setAttribute('data-court_id', 'court-1');
		const cmatch = loadCmatchForUpdateCourtTest(tr, {
			matches: [],
		});

		const target = {
			_id: 'target',
			btp_match_ids: [{ planning: 3005 }],
			setup: {
				links: {
					from1: 4009,
					from2: 4010,
				}
			}
		};
		const feederA = {
			_id: 'r16-7',
			btp_match_ids: [{ planning: 4007 }],
			setup: {
				is_match: true,
				match_num: 7,
				scheduled_date: '2026-04-18',
				scheduled_time_str: '09:00',
				links: {
					loser_to: 4010,
				}
			}
		};
		const feederB = {
			_id: 'r16-8',
			btp_match_ids: [{ planning: 4008 }],
			setup: {
				is_match: true,
				match_num: 8,
				scheduled_date: '2026-04-18',
				scheduled_time_str: '09:30',
				links: {
					loser_to: 4010,
				}
			}
		};
		const visibleConsolidation = {
			_id: 'vf-17',
			btp_match_ids: [{ planning: 3004 }],
			setup: {
				is_match: true,
				match_num: 17,
				scheduled_date: '2026-04-18',
				scheduled_time_str: '11:00',
				links: {
					from1: 4007,
					from2: 4008,
					winner_to: 2002,
					loser_to: 2004,
				}
			}
		};

		assert.strictEqual(
			cmatch._format_participant_dependency(target, 1, [feederA, feederB, visibleConsolidation]),
			'Loser #17 - 18.4.2026 11:00'
		);
	});
});
