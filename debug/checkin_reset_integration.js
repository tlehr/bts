'use strict';

// Actual BTS HTTP/WebSocket routes and two browser pages, using a disposable
// disk-backed replica. Never open the source database with NeDB or connect BTP.
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {spawn} = require('child_process');
const {once} = require('events');
const WebSocket = require('ws');
const snapshot = require('./isolated_sync/snapshot');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, description, timeout = 30000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {const value = await read(); if (value) return value; await pause(50);}
	throw new Error('Timed out: ' + description);
}
class CDP {
	constructor(socket) {
		this.socket = socket; this.sequence = 0; this.pending = new Map(); this.events = [];
		socket.on('message', bytes => {
			const value = JSON.parse(bytes);
			if (!value.id) return this.events.push(value);
			const pending = this.pending.get(value.id); this.pending.delete(value.id);
			if (value.error) pending?.reject(new Error(value.error.message)); else pending?.resolve(value.result);
		});
	}
	call(method, params = {}) {
		return new Promise((resolve, reject) => {
			const id = ++this.sequence; this.pending.set(id, {resolve, reject}); this.socket.send(JSON.stringify({id, method, params}));
		});
	}
	async evaluate(expression) {
		const value = await this.call('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
		if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
		return value.result.value;
	}
}
function without_attendance(match) {
	const copy = JSON.parse(JSON.stringify(match));
	for (const team of copy.setup?.teams || []) for (const player of team?.players || []) if (player) delete player.checked_in;
	return copy;
}
function participants(matches) {return matches.flatMap(match => (match.setup?.teams || []).flatMap(team => team?.players || [])).filter(Boolean);}

async function run({source = path.join(root, 'data'), key = 'default', output} = {}) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-checkin-integration-'));
	const report = {date:new Date().toISOString(), scope:'Echter BTS-Server, echte Browser und WebSocket-Anfragen auf einer wegwerfbaren Festplattenkopie. BTP/Ticker/Sprache und Automatik der Kopie ausgeschaltet.', checks:[]};
	let captured, app, server, chrome, observer;
	const clients = [];
	function check(name, condition) {assert(condition, name); report.checks.push(name); console.log('OK ' + name);}
	try {
		captured = await snapshot.capture(path.resolve(source), directory);
		const replica = path.join(directory, 'replica'), db = await snapshot.replica(captured, replica);
		await db.tournaments.update_async({}, {$set:{btp_enabled:false, btp_readonly:true, btp_autofetch_enabled:false,
			automation_enabled:false, ticker_enabled:false, announcement_speech_mode:'browser', bts_server_diagnostics_enabled:false}}, {multi:true});
		const tournament = await db.tournaments.findOne_async({key}); assert(tournament, 'Tournament not found');
		const matches = await db.matches.find_async({tournament_key:key});
		report.fixture = {matches:matches.length, player_occurrences:participants(matches).length,
			prepared:matches.filter(match => match.setup?.state === 'preparation').length};
		// Seed only the disposable copy so already cleared attendance still tests
		// a genuine transition for each player occurrence in every match state.
		for (const match of matches) {
			const patch = {};
			for (const [ti, team] of (match.setup?.teams || []).entries()) for (const [pi, player] of (team?.players || []).entries()) {
				if (player) patch['setup.teams.' + ti + '.players.' + pi + '.checked_in'] = true;
			}
			if (Object.keys(patch).length) await db.matches.update_async({_id:match._id}, {$set:patch}, {});
		}
		app = require('../bts/bts').create_app({port:0, host:'127.0.0.1', bup_location:path.join(root, 'static/bup/dev'),
			report_errors:false, diagnostics:{enabled:false}, speech:{enabled:false}}, db);
		await require('../bts/clock').init(app);
		server = app.wss.options.server;
		if (!server.listening) await once(server, 'listening');
		const base = 'http://127.0.0.1:' + server.address().port;
		observer = new WebSocket(base.replace('http:', 'ws:') + '/ws/admin'); await once(observer, 'open');
		let rid = 0; const pending = new Map(), changes = [];
		observer.on('message', bytes => {
			const message = JSON.parse(bytes);
			if (pending.has(message.rid)) {const resolve = pending.get(message.rid); pending.delete(message.rid); resolve(message);}
			else changes.push(message);
		});
		const request = message => new Promise((resolve, reject) => {
			const id = ++rid, timeout = setTimeout(() => {pending.delete(id); reject(new Error('Request timeout: ' + message.type));}, 30000);
			pending.set(id, value => {clearTimeout(timeout); resolve(value);}); observer.send(JSON.stringify({...message, rid:id}));
		});
		await request({type:'tournament_get', key});
		const initial = await request({type:'preparation_selection_get', tournament_key:key}); assert(initial.call_status);
		chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio',
			'--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + path.join(directory, 'chrome'), 'about:blank'], {stdio:['ignore', 'ignore', 'pipe']});
		let stderr = ''; chrome.stderr.on('data', bytes => {stderr += bytes;});
		const endpoint = await until(() => /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)?.[1], 'Chrome endpoint');
		const browser = async url => {
			const target = await (await fetch('http://' + new URL(endpoint).host + '/json/new?about:blank', {method:'PUT'})).json();
			const socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, 'open');
			const c = new CDP(socket); clients.push(c);
			await c.call('Runtime.enable'); await c.call('Page.enable');
			await c.call('Emulation.setFocusEmulationEnabled', {enabled:true});
			await c.call('Emulation.setDeviceMetricsOverride', {width:1920, height:1080, deviceScaleFactor:1, mobile:false});
			await c.call('Page.navigate', {url});
			await until(() => c.evaluate('typeof curt!=="undefined" && curt.key===' + JSON.stringify(key) + ' && curt.matches?.length>0'), 'real tournament loaded');
			return c;
		};
		const admin = await browser(base + '/admin/t/' + key + '/edit/maintenance');
		const self = await browser(base + '/admin/t/' + key + '/self_check_in');
		await until(() => admin.evaluate('!!document.querySelector(".tournament_reset_button")'), 'maintenance controls');
		const before = await db.matches.find_async({}), courts = await db.courts.find_async({}), officials = await db.umpires.find_async({}), operators = await db.tabletoperators.find_async({});
		check('Real browser loaded the complete tournament from the BTS WebSocket', await admin.evaluate('curt.matches.length') === matches.length);
		check('Self-check-in browser initially shows present players', await self.evaluate('document.querySelectorAll(".self_check_in_chip_ready[data-role=player]").length>0'));
		const review = async () => {
			await admin.evaluate('document.querySelector(".tournament_reset_button").click();document.querySelector("[name=reset_action][value=player_checkins]").click();document.querySelector("[name=reset_review]").click()');
			await until(() => admin.evaluate('!!document.querySelector(".bts-confirm-dialog")'), 'review confirmation');
		};
		await review(); await admin.evaluate('document.querySelector(".bts-confirm-cancel").click()');
		check('Cancelling the real maintenance dialog leaves every match unchanged', require('util').isDeepStrictEqual(await db.matches.find_async({}), before));
		changes.length = 0;
		await review(); const start = performance.now();
		await admin.evaluate('document.querySelector(".bts-confirm-accept").click()');
		await until(() => admin.evaluate('document.querySelector(".tournament_reset_button").closest(".settings-row").querySelector(".settings-maintenance-result").dataset.state === "success"'), 'server reset success');
		report.ui_completion_ms = +(performance.now() - start).toFixed(1);
		await until(() => self.evaluate('document.querySelectorAll(".self_check_in_chip_ready[data-role=player]").length===0 && document.querySelectorAll(".self_check_in_chip_waiting[data-role=player]").length>0'), 'live self-check-in reset');
		await until(() => changes.some(message => message.ctype === 'player_checkin_reset'), 'bulk WebSocket notification');
		const after = await db.matches.find_async({});
		check('Every player occurrence in every game is explicitly false on the server', participants(after.filter(match => match.tournament_key === key)).every(player => player.checked_in === false));
		const by_id = new Map(before.map(match => [match._id, match]));
		check('Scores, winners, state, fields, pause flags and embedded officials are unchanged', after.every(match =>
			require('util').isDeepStrictEqual(match.tournament_key === key ? without_attendance(match) : match,
				match.tournament_key === key ? without_attendance(by_id.get(match._id)) : by_id.get(match._id))));
		check('Courts and official/operator records are unchanged', require('util').isDeepStrictEqual(await db.courts.find_async({}), courts) &&
			require('util').isDeepStrictEqual(await db.umpires.find_async({}), officials) && require('util').isDeepStrictEqual(await db.tabletoperators.find_async({}), operators));
		check('The maintenance browser receives all reset flags without reloading', await admin.evaluate('curt.matches.every(match=>(match.setup?.teams||[]).every(team=>(team.players||[]).every(player=>player.checked_in===false)))'));
		check('The second real browser receives waiting player cards live', await self.evaluate('document.querySelectorAll(".self_check_in_chip_ready[data-role=player]").length===0'));
		const final = await request({type:'preparation_selection_get', tournament_key:key});
		check('The shared call status advances after the bulk reset', final.call_status.revision > initial.call_status.revision);
		const diagnostics = status => Object.fromEntries(status.selections.flatMap(selection => Object.entries(selection.call_on_court_diagnostics_by_match_id)
			.flatMap(([id, value]) => value.court_diagnostics.map(court => [id + ':' + court.court_id, court]))));
		const initial_diagnostics = diagnostics(initial), final_diagnostics = diagnostics(final);
		const ready = Object.entries(initial_diagnostics).filter(([, value]) =>
			value.rules.some(rule => rule.key === 'participants_complete' && rule.passed) &&
			value.rules.some(rule => rule.key === 'players_checked_in' && rule.enabled && rule.passed));
		if (tournament.call_on_court_participant_readiness_mode === 'checked_in') {
			check('Previously satisfied player check-in rules now block the on-court call', ready.length > 0 && ready.every(([id]) =>
				final_diagnostics[id]?.rules.some(rule => rule.key === 'players_checked_in' && rule.enabled && !rule.passed)));
		}
		check('The shared call status is pushed to the subscribed WebSocket client', changes.some(message =>
			message.ctype === 'call_status_changed' && message.val?.call_status?.revision > initial.call_status.revision));
		check('Another WebSocket client receives exactly one completion and the per-game status patches',
			changes.filter(message => message.ctype === 'player_checkin_reset').length === 1 &&
			changes.filter(message => message.ctype === 'update_player_status').length === matches.filter(match => participants([match]).length > 0).length);
		report.reset = changes.find(message => message.ctype === 'player_checkin_reset').val;
		report.notification_counts = Object.fromEntries([...new Set(changes.map(message => message.ctype).filter(Boolean))]
			.map(type => [type, changes.filter(message => message.ctype === type).length]));
		const repeat = await request({type:'maintenance_reset', tournament_key:key, target:'bts', actions:['player_checkins']});
		check('Repeating through the real WebSocket reports zero changed games', repeat.results?.player_checkins?.changed_matches === 0);
		const blocked = await request({type:'maintenance_reset', tournament_key:key, target:'both', actions:['player_checkins']});
		check('A combined reset is rejected while BTP is disabled', blocked.type === 'error');
		const errors = clients.flatMap(c => c.events.filter(event => event.method === 'Runtime.exceptionThrown'));
		report.browser_errors = errors.map(event => event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
		check('Both real browser pages complete without JavaScript exceptions', errors.length === 0);
		observer.terminate(); observer = null;
		for (const c of clients) c.socket.terminate();
		for (const socket of app.wss.clients) socket.terminate();
		await new Promise(resolve => app.wss.close(resolve)); await new Promise(resolve => server.close(resolve)); server = null;
		const reloaded = await snapshot.reload(replica);
		const persisted = await new Promise((resolve, reject) => reloaded.matches.find({tournament_key:key}, (error, values) => error ? reject(error) : resolve(values)));
		check('Check-ins remain false after reopening the on-disk database', participants(persisted).every(player => player.checked_in === false));
		await snapshot.unchanged(captured); check('Every source database file retains its original hash and metadata', true);
		report.source = {directory:captured.source, files:captured.files};
		report.product_sha256 = Object.fromEntries(await Promise.all(['bts/player_checkin_reset.js', 'bts/admin.js', 'static/js/change.js', 'static/js/maintenance_settings.js', 'static/js/reset_selection.js']
			.map(async name => [name, crypto.createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex')])));
		report.limitations = ['BTP-Übertragung bleibt deaktiviert; deren zwei Check-in-Modi sind durch die separaten Backendtests geprüft.',
			'Die UI-Zeit ist eine einzelne Diagnosemessung auf der Kopie, kein Nachweis für Punktelatenz oder allgemeine Performancegrenzen.'];
		if (output) await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
		return report;
	} finally {
		observer?.terminate(); for (const c of clients) c.socket.terminate();
		if (chrome && chrome.exitCode == null) {const stopped = once(chrome, 'exit'); chrome.kill('SIGTERM'); await stopped;}
		if (server) {for (const socket of app.wss.clients) socket.terminate(); app.wss.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
		await fs.rm(directory, {recursive:true, force:true, maxRetries:5, retryDelay:200});
	}
}

if (require.main === module) {
	process.chdir(root);
	run({output:process.argv[2]}).then(report => console.log(JSON.stringify({checks:report.checks.length, fixture:report.fixture, ui_completion_ms:report.ui_completion_ms})))
		.catch(error => {console.error(error.stack); process.exitCode = 1;});
}
module.exports = {run};
