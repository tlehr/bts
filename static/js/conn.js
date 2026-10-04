'use strict';
var conn = (function(on_status, on_change) {
var ws;
var reconnect_duration = 500;
var WS_PATH = '/ws/admin';
var request_id = 1;
var CHANGE_BATCH_MAX_MESSAGES = 25;
var CHANGE_BATCH_MAX_MS = 8;

var callback_handlers = {};
var change_queue = [];
var change_queue_scheduled = false;

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

function dispatch_change(msg) {
	try {
		on_change(msg);
	} catch (err) {
		console.error('[bts admin] change handler failed', {
			ctype: msg.ctype,
			tournament_key: msg.tournament_key,
			val: msg.val,
			err,
		});
	}
}

function schedule_change_queue() {
	if (change_queue_scheduled) {
		return;
	}
	change_queue_scheduled = true;
	setTimeout(process_change_queue, 0);
}

function process_change_queue() {
	change_queue_scheduled = false;
	const start_ms = _now_ms();
	let processed = 0;
	while (change_queue.length > 0) {
		dispatch_change(change_queue.shift());
		processed++;
		if (processed >= CHANGE_BATCH_MAX_MESSAGES || (_now_ms() - start_ms) >= CHANGE_BATCH_MAX_MS) {
			break;
		}
	}
	if (change_queue.length > 0) {
		schedule_change_queue();
	}
}

function enqueue_change(msg) {
	if (immediate_change_types.has(msg.ctype)) {
		dispatch_change(msg);
		return;
	}
	change_queue.push(msg);
	schedule_change_queue();
}

function handle_message(ws_msg) {
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
		if (msg.ctype === 'score' && window.curt && window.curt.bts_debug_output_enabled === true) {
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
		on_status({
			code: 'connected',
		});
	};
	ws.onmessage = handle_message;
	ws.onclose = function() {
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
		callback_handlers[msg.rid] = cb;
	}
	const msg_json = JSON.stringify(msg);
	debug.log('<', msg_json);
	ws.send(msg_json);
}

return {
	connect,
	send,
	_test_handle_message: handle_message,
	_test_process_change_queue: process_change_queue,
	_test_change_queue_length: () => change_queue.length,
};

});

/*@DEV*/
if ((typeof module !== 'undefined') && (typeof require !== 'undefined')) {
	var WebSocket = require('ws');

	var debug = require('./debug');
	var utils = {
		values: Object.values,
	};

	module.exports = conn;
}
/*/@DEV*/
