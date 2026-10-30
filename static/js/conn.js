'use strict';
/* global btsSpeechHealth, btsAdminUpdates */
var conn = (function(on_status, on_change) {
var ws;
var reconnect_duration = 500;
var WS_PATH = '/ws/admin';
var request_id = 1;
var CHANGE_BATCH_MAX_MESSAGES = 25;
var CHANGE_BATCH_MAX_MS = 8;
var CHANGE_HANDLER_WARN_MS = 16;

var callback_handlers = {};
var change_queue = [];
var change_queue_head = 0;
var change_scheduler = change_queue_scheduler(process_change_queue);

var immediate_change_types = new Set([
	'free_announce',
	'emergency_announce',
	'match_preparation_call',
	'match_called_on_court',
	'match_no_match_announcement',
	'begin_to_play_call',
	'second_call_tabletoperator',
	'second_call_umpire',
	'second_call_servicejudge',
	'second_call_team_one',
	'second_call_team_two',
	'second_preparation_call_tabletoperator',
	'second_preparation_call_umpire',
	'second_preparation_call_servicejudge',
	'second_preparation_call_team_one',
	'second_preparation_call_team_two',
	'btp_status',
	'ticker_status',
	'bts_status',
	'queue_hang_warning',
]);

var coalescable_change_types = new Set([
	'score',
	'update_player_status',
]);

function _construct_url(abspath) {
	var l = window.location;
	return (
		((l.protocol === 'https:') ? 'wss://' : 'ws://') +
		l.hostname +
		(((l.port !== 80) && (l.port !== 443)) ? ':' + l.port : '') +
		abspath
	);
}

function _now_ms() {
	if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
		return performance.now();
	}
	return Date.now();
}

function _debug_enabled() {
	return typeof window !== 'undefined' && window.curt && window.curt.bts_client_performance_debug_enabled === true;
}

function change_coalesce_key(msg) {
	if (!msg || !coalescable_change_types.has(msg.ctype) || !msg.val) {
		return null;
	}
	const match_id = msg.ctype === 'score'
		? msg.val.match_id
		: msg.val.match__id;
	if (match_id == null) {
		return null;
	}
	return [
		msg.tournament_key || '',
		msg.ctype,
		String(match_id),
	].join(':');
}

function dispatch_change(msg) {
	const start_ms = _now_ms();
	try {
		if (typeof btsAdminUpdates !== 'undefined') btsAdminUpdates.dispatch(msg, on_change);else on_change(msg);
	} catch (err) {
		console.error('[bts admin] change handler failed', {
			ctype: msg.ctype,
			tournament_key: msg.tournament_key,
			val: msg.val,
			err,
		});
	} finally {
		const duration_ms = _now_ms() - start_ms;
		if (_debug_enabled() && duration_ms >= CHANGE_HANDLER_WARN_MS) {
			console.log('[bts admin] slow change handler', {
				ctype: msg && msg.ctype,
				tournament_key: msg && msg.tournament_key,
				duration_ms: Math.round(duration_ms * 10) / 10,
				match_id: msg && msg.val && (msg.val.match_id || msg.val.match__id),
			});
		}
	}
}

function schedule_change_queue() {
	change_scheduler.schedule();
}

function queued_change_count() {
	return change_queue.length - change_queue_head;
}

function compact_change_queue_if_needed(force) {
	if (change_queue_head === 0) {
		return;
	}
	if (change_queue_head >= change_queue.length) {
		change_queue = [];
		change_queue_head = 0;
		return;
	}
	if (force || change_queue_head > 100) {
		change_queue = change_queue.slice(change_queue_head);
		change_queue_head = 0;
	}
}

function process_change_queue() {
	change_scheduler.cancel();
	const start_ms = _now_ms();
	let processed = 0;
	while (queued_change_count() > 0) {
		const message = change_queue[change_queue_head++];
		dispatch_change(message);
		processed++;
		if (processed >= CHANGE_BATCH_MAX_MESSAGES || (_now_ms() - start_ms) >= CHANGE_BATCH_MAX_MS) {
			break;
		}
	}
	compact_change_queue_if_needed(false);
	const duration_ms = _now_ms() - start_ms;
	if (_debug_enabled() && processed > 0 && duration_ms >= CHANGE_BATCH_MAX_MS) {
		console.log('[bts admin] change queue batch', {
			processed,
			remaining: queued_change_count(),
			duration_ms: Math.round(duration_ms * 10) / 10,
		});
	}
	if (queued_change_count() > 0) {
		schedule_change_queue();
	}
}

function enqueue_change(msg) {
	if (immediate_change_types.has(msg.ctype)) {
		dispatch_change(msg);
		return;
	}
	const key = change_coalesce_key(msg);
	if (key) {
		for (let i = change_queue.length - 1; i >= change_queue_head; i--) {
			if (change_coalesce_key(change_queue[i]) === key) {
				// Keep the newest event at its arrival position: an intervening full
				// match snapshot must be applied before this newer score or status.
				change_queue.splice(i, 1);
				break;
			}
		}
	}
	change_queue.push(msg);
	schedule_change_queue();
}

function handle_message(ws_msg) {
	const received_at = { monotonic: _now_ms(), wall: Date.now() };
	var msg_json = ws_msg.data;
	debug.log('>', msg_json.substring(0, 100));
	var msg = JSON.parse(msg_json);
	if (!msg) {
		send({
			type: 'error',
			message: 'Could not parse message',
		});
	}

	switch (msg.type) {
	case 'speech_health':
		if (typeof btsSpeechHealth !== 'undefined') btsSpeechHealth.update(msg.health);
		break;
	case 'answer': {
			const cb = callback_handlers[msg.rid];
			if (! cb) {
				return;
			}
			if (cb(null, msg) !== 'keep') {
				delete callback_handlers[msg.rid];
			}
		}
		break;
	case 'error':
		if (msg.rid) {
			const cb = callback_handlers[msg.rid];
			if (cb) {
				if (cb(msg) !== 'keep') {
					delete callback_handlers[msg.rid];
				}
			}
		}
		on_status({
			code: 'error',
			message: 'Received error message from BTS: ' + msg.message,
		});
		break;
	case 'change':
		if (typeof btsAdminUpdates !== 'undefined') btsAdminUpdates.received(msg, received_at);
		if (msg.ctype === 'score' && _debug_enabled()) {
			console.log('[bts admin] score change received', {
				tournament_key: msg.tournament_key,
				current_tournament_key: window.curt && window.curt.key,
				match_id: msg.val && msg.val.match_id,
				score: msg.val && msg.val.network_score,
			});
		}
		enqueue_change(msg);
		break;
	default:
		send({
			type: 'error',
			rid: msg.rid,
			message: 'Unsupported message ' + msg.type,
		});
	}
}

function connect() {
	on_status({
		code: 'connecting',
	});

	ws = new WebSocket(_construct_url(WS_PATH), 'bts-admin');
	ws.onopen = function() {
		if (typeof btsSpeechHealth !== 'undefined') send({ type: 'speech_health_subscribe' }, () => {});
		on_status({
			code: 'connected',
		});
	};
	ws.onmessage = handle_message;
	ws.onclose = function() {
		if (typeof btsAdminUpdates !== 'undefined') btsAdminUpdates.reset();
		if (typeof btsSpeechHealth !== 'undefined') btsSpeechHealth.disconnected();
		// Clear callback handlers
		utils.values(callback_handlers).forEach(function(cb) {
			cb({
				type: 'disconnected',
				message: 'Verbindung verloren',
			});
		});
		callback_handlers = {};

		on_status({
			code: 'waiting',
		});
		setTimeout(connect, reconnect_duration);
	};
}

function send(msg, cb) {
	if (! msg.rid) {
		msg.rid = request_id;
		request_id++;
	}
	if (cb) {
		callback_handlers[msg.rid] = typeof btsAdminUpdates !== 'undefined' ? btsAdminUpdates.wrapCallback(cb) : cb;
	}
	const msg_json = JSON.stringify(msg);
	debug.log('<', msg.type?.startsWith('speech_') ? msg.type : msg_json);
	try { ws.send(msg_json); }
	catch (error) { delete callback_handlers[msg.rid]; throw error; }
	return msg.rid;
}

return {
	connect,
	send,
	cancel_request: rid => { delete callback_handlers[rid]; },
	_test_handle_message: handle_message,
	_test_process_change_queue: process_change_queue,
	_test_change_queue_length: queued_change_count,
};

});

/*@DEV*/
if ((typeof module !== 'undefined') && (typeof require !== 'undefined')) {
	var WebSocket = require('ws');

	var debug = require('./debug');
	var change_queue_scheduler = require('./change_queue_scheduler');
	var utils = {
		values: Object.values,
	};

	module.exports = conn;
}
/*/@DEV*/
