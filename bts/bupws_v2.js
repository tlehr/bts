'use strict';

const dns = require('dns');
const net = require('net');
const os = require('os');
const async = require('async');
const crypto = require('crypto');

const calc = require('../static/bup/dev/js/calc');
const admin = require('./admin');
const btp_manager = require('./btp_manager');
const debug_flags = require('./debug_flags');
const match_automation = require('./match_automation');
const ticker_manager = require('./ticker_manager');
const update_queue = require('./update_queue');
const displaysettings_defaults = require('./displaysettings_defaults');

const all_panels = [];
const active_umpire_match_owners = new Map();
const default_tournament_key = 'default';
const default_displaysettings_key = default_tournament_key;
const SCORE_UPDATE_FULL_STATE_FALLBACK = false;
const FINISHED_MATCH_DISPLAY_MS = 60000;
const V2_RENDER_ACK_TIMEOUT_MS = 10000;
const V2_RENDER_STATS_WINDOW_MS = 5 * 60 * 1000;
const V2_RENDER_STATS_NOTIFY_INTERVAL_MS = 2000;
const V2_ACK_ONLINE_STATUS_INTERVAL_MS = 5000;
const MULTI_COURT_ASSIGNMENT_ID = '__multi__';
const MULTI_COURT_DISPLAY_STYLES = new Set([
	'2court',
	'castall',
	'greyish',
	'stream',
	'streamteam',
	'teamscore',
	'tim',
	'top+list',
	'tournament_overview',
	'tournament_overview_dm',
]);
const FIELDLESS_MULTI_COURT_DISPLAY_STYLES = new Set([
	'greyish',
	'streamteam',
	'teamscore',
	'tim',
	'top+list',
	'tournament_overview',
	'tournament_overview_dm',
]);

function score_status_from_score_update(score_data) {
	const explicit_status = score_data?.score_status;
	if (explicit_status === 'retired' || explicit_status === 'disqualified') {
		return explicit_status;
	}
	if (Number(explicit_status) === 2) {
		return 'retired';
	}
	if (Number(explicit_status) === 3) {
		return 'disqualified';
	}
	const presses = Array.isArray(score_data?.presses) ? score_data.presses : [];
	for (let i = presses.length - 1; i >= 0 && i >= presses.length - 4; i--) {
		const press_type = presses[i]?.type;
		if (press_type === 'retired' || press_type === 'disqualified') {
			return press_type;
		}
	}
	return 'normal';
}

function reached_score_from_score_update(match, score_data) {
	const presses = Array.isArray(score_data?.presses) ? score_data.presses : [];
	if (!match?.setup || presses.length < 1) {
		return null;
	}
	try {
		const state = calc.remote_state({}, match.setup, presses);
		const scores = [];
		if (Array.isArray(state?.match?.finished_games)) {
			state.match.finished_games.forEach((finished_game) => {
				if (Array.isArray(finished_game?.score) && finished_game.score.length >= 2) {
					scores.push([
						Number(finished_game.score[0]) || 0,
						Number(finished_game.score[1]) || 0,
					]);
				}
			});
		}
		if (Array.isArray(state?.game?.score) && state.game.score.length >= 2) {
			const current_score = [
				Number(state.game.score[0]) || 0,
				Number(state.game.score[1]) || 0,
			];
			const last_score = scores[scores.length - 1];
			if (!last_score || last_score[0] !== current_score[0] || last_score[1] !== current_score[1]) {
				scores.push(current_score);
			}
		}
		return scores.length > 0 ? scores : null;
	} catch (err) {
		console.error('[bts] failed to derive reached score for special score status', err);
		return null;
	}
}

function log_v2_sends_enabled(ws) {
	if (process.env.BUP_V2_LOG_SENDS === '1') {
		return true;
	}
	if (process.env.BUP_V2_LOG_SENDS === '0') {
		return false;
	}
	return ws?.app?.config?.bup_v2_log_sends === true || debug_flags.enabled(ws?.app, ws?.last_tournament_key);
}

function debug_tablet_loop_enabled(app) {
	if (process.env.BUP_V2_DEBUG_TABLET_LOOP === '1') {
		return true;
	}
	if (process.env.BUP_V2_DEBUG_TABLET_LOOP === '0') {
		return false;
	}
	return app?.config?.bup_v2_debug_tablet_loop === true || debug_flags.any_enabled(app);
}

function short_hash(value) {
	return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 10);
}

function debug_tablet_loop(app, stage, data = {}) {
	if (!debug_tablet_loop_enabled(app)) {
		return;
	}
	console.log('[bup v2 tablet-loop]', {
		ts: Date.now(),
		stage,
		...data,
	});
}

function init_message_signature(tournament_key, devicemode, msg) {
	const settings = msg?.panel_settings || {};
	return stable_json({
		tournament_key,
		devicemode,
		court_id: settings.court_id || '',
		displaymode_court_id: settings.displaymode_court_id || '',
		tablet_mode: settings.tablet_mode || '',
		dm_style: settings.dm_style || settings.displaymode_style || '',
	});
}

function should_skip_duplicate_umpire_init(app, ws, tournament_key, msg) {
	const signature = init_message_signature(tournament_key, 'umpire', msg);
	const now = Date.now();
	const previous_ts = ws.last_umpire_init_ts || 0;
	const duplicate = ws.last_umpire_init_signature === signature;
	const within_window = previous_ts > 0 && (now - previous_ts) < 5000;
	if (duplicate && within_window) {
		debug_tablet_loop(app, 'handle_init:skip-duplicate-umpire-init', {
			client_id: determine_client_id(ws),
			court_id: ws.court_id || msg?.panel_settings?.court_id || null,
			age_ms: now - previous_ts,
			hash: short_hash(signature),
		});
		return true;
	}
	ws.last_umpire_init_signature = signature;
	ws.last_umpire_init_ts = now;
	debug_tablet_loop(app, 'handle_init:accept-umpire-init', {
		client_id: determine_client_id(ws),
		court_id: ws.court_id || msg?.panel_settings?.court_id || null,
		duplicate,
		hash: short_hash(signature),
	});
	return false;
}

function on_connect(app, ws) {
	all_panels.push(ws);
	ws.app = app;
	ws.panel_devicemode = 'display';
	reset_v2_payload_caches(ws);
	ws.v2_finished_match_refresh_timeout = null;
	ws.v2_next_message_id = 1;
	ws.v2_pending_render_acks = new Map();
	ws.v2_render_responsive = true;
	ws.v2_render_ack_samples = [];
	ws.v2_render_stats_last_notify_ts = 0;
}

function reset_v2_payload_caches(ws) {
	if (!ws) {
		return;
	}
	ws.last_v2_full_payload_json = null;
	ws.last_v2_score_payload_json = null;
	ws.last_v2_points_payload_json = null;
	ws.last_v2_timer_payload_json = null;
	ws.v2_incremental_payload_cache = new Map();
	ws.last_v2_tournament_assets_key = null;
	ws.last_v2_match_id = null;
	ws.last_v2_match_ids_by_court = new Map();
}

function on_close(app, ws) {
	clear_finished_match_refresh(ws);
	clear_pending_render_acks(ws);
	clear_umpire_match_owners_for_ws(ws);
	const idx = all_panels.indexOf(ws);
	if (idx >= 0) {
		all_panels.splice(idx, 1);
	}
	if (ws && ws.last_tournament_key) {
		notify_v2_display_status_changed(app, ws, false);
	}
}

function payload_size_bytes(payload) {
	try {
		return Buffer.byteLength(JSON.stringify(payload), 'utf8');
	} catch (_err) {
		return null;
	}
}

function primitive_key_part(value) {
	return value == null ? '' : String(value);
}

function primitive_join_key(parts) {
	return parts.map(primitive_key_part).join('\x1f');
}

function side_score_key(score) {
	return primitive_join_key([score?.left || 0, score?.right || 0]);
}

function display_score_update_cache_key(payload) {
	const score = payload?.score || {};
	const timer = payload?.timers?.active_timer || null;
	const server = payload?.service?.server || null;
	const receiver = payload?.service?.receiver || null;
	const finished_sets = Array.isArray(score.finished_sets) ? score.finished_sets : [];
	return primitive_join_key([
		payload?.type,
		payload?.version,
		payload?.court_id,
		payload?.match_id,
		payload?.status,
		payload?.winner_side,
		payload?.end_timestamp,
		side_score_key(score.current_set),
		score.current_set_finished ? 1 : 0,
		score.current_set_winner_side,
		side_score_key(score.sets_won),
		finished_sets.map(side_score_key).join('\x1e'),
		server?.side,
		server?.team_index,
		server?.player_index,
		receiver?.side,
		receiver?.team_index,
		receiver?.player_index,
		timer?.start,
		timer?.duration,
		timer?.exigent,
		timer?.upwards ? 1 : 0,
		timer?.restart ? 1 : 0,
	]);
}

function display_points_update_cache_key(payload) {
	const score = payload?.score || {};
	const server = payload?.service?.server || null;
	const receiver = payload?.service?.receiver || null;
	const finished_sets = Array.isArray(score.finished_sets) ? score.finished_sets : [];
	return primitive_join_key([
		payload?.type,
		payload?.version,
		payload?.court_id,
		payload?.match_id,
		payload?.status,
		payload?.winner_side,
		payload?.end_timestamp,
		side_score_key(score.current_set),
		score.current_set_finished ? 1 : 0,
		score.current_set_winner_side,
		side_score_key(score.sets_won),
		finished_sets.map(side_score_key).join('\x1e'),
		server?.side,
		server?.team_index,
		server?.player_index,
		receiver?.side,
		receiver?.team_index,
		receiver?.player_index,
	]);
}

function display_timer_update_cache_key(payload) {
	const timer = payload?.timers?.active_timer || null;
	return primitive_join_key([
		payload?.type,
		payload?.version,
		payload?.court_id,
		payload?.match_id,
		timer?.start,
		timer?.duration,
		timer?.exigent,
		timer?.upwards ? 1 : 0,
		timer?.restart ? 1 : 0,
	]);
}

function display_state_winner_side(state) {
	const winner = safe_array(state?.teams).find((team) => team && team.is_winner);
	return winner?.side || null;
}

function display_state_as_points_update_cache_payload(state) {
	if (!state || !state.match) {
		return null;
	}
	return {
		type: 'display_points_update',
		version: 1,
		court_id: state.court?.id || '',
		match_id: state.match?.id || null,
		status: state.match?.status || null,
		score: state.score || {},
		service: state.service || {},
		winner_side: display_state_winner_side(state),
		end_timestamp: state.match?.end_timestamp || null,
	};
}

function display_state_as_timer_update_cache_payload(state) {
	if (!state || !state.match) {
		return null;
	}
	return {
		type: 'display_timer_update',
		version: 1,
		court_id: state.court?.id || '',
		match_id: state.match?.id || null,
		timers: {
			active_timer: state.timers?.active_timer || null,
		},
	};
}

function prime_incremental_cache_from_display_state(ws, state) {
	if (!ws || !state || !state.match) {
		return;
	}
	if (!ws.v2_incremental_payload_cache) {
		ws.v2_incremental_payload_cache = new Map();
	}
	const points_payload = display_state_as_points_update_cache_payload(state);
	const timer_payload = display_state_as_timer_update_cache_payload(state);
	if (points_payload) {
		ws.v2_incremental_payload_cache.set(
			primitive_join_key([points_payload.type, points_payload.court_id, points_payload.match_id]),
			display_points_update_cache_key(points_payload),
		);
	}
	if (timer_payload) {
		ws.v2_incremental_payload_cache.set(
			primitive_join_key([timer_payload.type, timer_payload.court_id, timer_payload.match_id]),
			display_timer_update_cache_key(timer_payload),
		);
	}
}

function prime_incremental_cache_from_full_payload(ws, payload) {
	if (!ws || !payload) {
		return;
	}
	if (payload.type === 'display_state') {
		prime_incremental_cache_from_display_state(ws, payload);
		return;
	}
	if (payload.type === 'display_multi_state') {
		safe_array(payload.court_states).forEach((court_state) => {
			prime_incremental_cache_from_display_state(ws, court_state);
		});
	}
}

function clear_finished_match_refresh(ws) {
	if (ws && ws.v2_finished_match_refresh_timeout) {
		clearTimeout(ws.v2_finished_match_refresh_timeout);
		ws.v2_finished_match_refresh_timeout = null;
	}
}

function clear_pending_render_acks(ws) {
	if (!ws || !ws.v2_pending_render_acks) {
		return;
	}
	for (const pending of ws.v2_pending_render_acks.values()) {
		if (pending.timeout) {
			clearTimeout(pending.timeout);
		}
	}
	ws.v2_pending_render_acks.clear();
}

async function notify_v2_display_status_changed(app, ws, online) {
	try {
		const client_id = determine_client_id(ws);
		const display_court_displaysetting =
			(await get_display_court_displaysettings(app, client_id)) || {
				client_id,
				court_id: ws && ws.court_id ? ws.court_id : null,
				displaysetting_id: null,
				panel_devicemode: ws && ws.panel_devicemode ? ws.panel_devicemode : 'display',
		};
		display_court_displaysetting.online = online;
		display_court_displaysetting.display_render_stats = get_v2_render_stats(ws);
		admin.notify_change(app, ws.last_tournament_key || default_tournament_key, 'display_status_changed', {
			display_court_displaysetting,
		});
		if (ws) {
			ws.v2_admin_online = online;
			ws.v2_admin_status_notify_ts = Date.now();
		}
	} catch (err) {
		console.error('[bup v2] failed to notify display status', {
			client_id: ws && ws.client_id ? ws.client_id : null,
			online,
			err: err && err.message ? err.message : String(err),
		});
	}
}

function prune_v2_render_ack_samples(ws, now_ts) {
	if (!ws || !ws.v2_render_ack_samples) {
		return [];
	}
	const cutoff_ts = now_ts - V2_RENDER_STATS_WINDOW_MS;
	ws.v2_render_ack_samples = ws.v2_render_ack_samples.filter((sample) => sample.ts >= cutoff_ts);
	return ws.v2_render_ack_samples;
}

function record_v2_render_ack_sample(ws, pending, ack) {
	if (!ws || !pending || !ack || ack.ok === false || typeof pending.sent_ts !== 'number') {
		return;
	}
	if (!ws.v2_render_ack_samples) {
		ws.v2_render_ack_samples = [];
	}
	const now_ts = Date.now();
	const roundtrip_ms = Math.max(0, now_ts - pending.sent_ts);
	ws.v2_render_ack_samples.push({
		ts: now_ts,
		roundtrip_ms,
		render_ms: typeof ack.render_ms === 'number' && Number.isFinite(ack.render_ms)
			? Math.max(0, ack.render_ms)
			: null,
		payload_type: pending?.payload_meta?.type || ack.payload_type || null,
	});
	prune_v2_render_ack_samples(ws, now_ts);
}

function get_v2_render_stats(ws, now_ts) {
	now_ts = now_ts || Date.now();
	const samples = prune_v2_render_ack_samples(ws, now_ts);
	if (!samples.length) {
		return {
			window_ms: V2_RENDER_STATS_WINDOW_MS,
			ack_count: 0,
			avg_roundtrip_ms: null,
			last_roundtrip_ms: null,
			last_ack_ts: null,
		};
	}
	const sum = samples.reduce((acc, sample) => acc + sample.roundtrip_ms, 0);
	const last = samples[samples.length - 1];
	return {
		window_ms: V2_RENDER_STATS_WINDOW_MS,
		ack_count: samples.length,
		avg_roundtrip_ms: Math.round(sum / samples.length),
		last_roundtrip_ms: Math.round(last.roundtrip_ms),
		last_ack_ts: last.ts,
	};
}

function notify_v2_display_render_stats(app, ws, force) {
	if (!ws) {
		return;
	}
	const now_ts = Date.now();
	if (!force && ws.v2_render_stats_last_notify_ts && now_ts - ws.v2_render_stats_last_notify_ts < V2_RENDER_STATS_NOTIFY_INTERVAL_MS) {
		return;
	}
	ws.v2_render_stats_last_notify_ts = now_ts;
	admin.notify_change(app, ws.last_tournament_key || default_tournament_key, 'display_render_stats', {
		client_id: determine_client_id(ws),
		display_render_stats: get_v2_render_stats(ws, now_ts),
	});
}

function mark_v2_render_responsive(app, ws, responsive) {
	if (!ws || ws.v2_render_responsive === responsive) {
		return;
	}
	ws.v2_render_responsive = responsive;
	notify_v2_display_status_changed(app, ws, responsive);
}

function remember_v2_tournament_settings(ws, tournament) {
	if (!ws || !tournament) {
		return;
	}
	debug_flags.set_from_tournament(tournament);
	if (typeof tournament.bup_v2_admin_wait_for_score_updates === 'boolean') {
		ws.v2_admin_wait_for_score_updates = tournament.bup_v2_admin_wait_for_score_updates;
	} else {
		delete ws.v2_admin_wait_for_score_updates;
	}
}

function admin_wait_for_score_updates_enabled(app, ws) {
	if (process.env.BUP_V2_ADMIN_WAIT_FOR_SCORE_UPDATES === '1') {
		return true;
	}
	if (process.env.BUP_V2_ADMIN_WAIT_FOR_SCORE_UPDATES === '0') {
		return false;
	}
	if (typeof ws?.v2_admin_wait_for_score_updates === 'boolean') {
		return ws.v2_admin_wait_for_score_updates;
	}
	return app?.config?.bup_v2_admin_wait_for_score_updates === true;
}

function payload_waits_for_admin_done(app, ws, payload) {
	if (!payload) {
		return false;
	}
	if (payload.type === 'display_state' || payload.type === 'display_multi_state' || payload.type === 'court_picker_state') {
		return true;
	}
	return (
		payload.type === 'display_score_update'
		|| payload.type === 'display_points_update'
		|| payload.type === 'display_timer_update'
	) && admin_wait_for_score_updates_enabled(app, ws);
}

function notify_v2_display_wait_for_done(app, ws, payload, message_id) {
	if (!payload_waits_for_admin_done(app, ws, payload)) {
		return;
	}
	admin.notify_change(app, ws.last_tournament_key || default_tournament_key, 'display_wait_for_done', {
		ctype: payload.type,
		val: {
			message_id,
			payload_type: payload.type,
		},
		client_id: determine_client_id(ws),
		message_id,
	});
}

function notify_v2_display_is_done(app, ws, pending, ack) {
	if (!pending || !payload_waits_for_admin_done(app, ws, pending.payload_meta)) {
		return;
	}
	admin.notify_change(app, ws.last_tournament_key || default_tournament_key, 'display_is_done', {
		ctype: pending.payload_meta.type,
		val: {
			message_id: pending.message_id,
			payload_type: pending.payload_meta.type,
			ok: ack.ok !== false,
			render_ms: ack.render_ms ?? null,
		},
		client_id: determine_client_id(ws),
		message_id: pending.message_id,
	});
}

function register_v2_render_ack(app, ws, payload, message_id) {
	if (!ws || !message_id) {
		return;
	}
	if (!ws.v2_pending_render_acks) {
		ws.v2_pending_render_acks = new Map();
	}
	notify_v2_display_wait_for_done(app, ws, payload, message_id);
	const pending = {
		message_id,
		payload_meta: v2_payload_meta(payload),
		sent_ts: Date.now(),
		timeout: null,
	};
	pending.timeout = setTimeout(() => {
		if (!ws.v2_pending_render_acks || !ws.v2_pending_render_acks.has(message_id)) {
			return;
		}
		ws.v2_pending_render_acks.delete(message_id);
		console.warn('[bup v2] render ack timeout', {
			message_id,
			type: pending.payload_meta.type,
			client_id: ws && ws.client_id ? ws.client_id : null,
			court_id: ws && ws.court_id ? ws.court_id : null,
		});
		mark_v2_render_responsive(app, ws, false);
	}, V2_RENDER_ACK_TIMEOUT_MS);
	ws.v2_pending_render_acks.set(message_id, pending);
}

function handle_display_rendered(app, ws, msg) {
	const message_id = msg && msg.message_id;
	if (!message_id || !ws || !ws.v2_pending_render_acks) {
		return;
	}
	const pending = ws.v2_pending_render_acks.get(message_id);
	if (!pending) {
		return;
	}
	if (pending.timeout) {
		clearTimeout(pending.timeout);
	}
	ws.v2_pending_render_acks.delete(message_id);
	mark_v2_render_responsive(app, ws, true);
	if (!ws.v2_admin_online || !ws.v2_admin_status_notify_ts || Date.now() - ws.v2_admin_status_notify_ts > V2_ACK_ONLINE_STATUS_INTERVAL_MS) {
		notify_v2_display_status_changed(app, ws, true);
	}
	record_v2_render_ack_sample(ws, pending, msg);
	notify_v2_display_render_stats(app, ws, false);
	notify_v2_display_is_done(app, ws, pending, msg);
	if (msg.ok === false) {
		console.warn('[bup v2] render ack reported failure', {
			message_id,
			type: pending.payload_meta.type,
			client_id: ws && ws.client_id ? ws.client_id : null,
			court_id: ws && ws.court_id ? ws.court_id : null,
			error: msg.error || null,
		});
	}
}

function payload_end_timestamp(payload) {
	if (!payload) {
		return null;
	}
	if (payload.end_timestamp) {
		return payload.end_timestamp;
	}
	if (payload.type === 'display_multi_state' && Array.isArray(payload.court_states)) {
		const end_timestamps = payload.court_states
			.map((court_state) => payload_end_timestamp(court_state))
			.filter((ts) => ts != null);
		if (end_timestamps.length > 0) {
			return Math.min(...end_timestamps);
		}
	}
	return payload.match && payload.match.end_timestamp ? payload.match.end_timestamp : null;
}

function v2_payload_meta(payload) {
	if (!payload) {
		return { type: null, court_id: null, match_id: null, end_timestamp: null };
	}
	return {
		type: payload.type || null,
		court_id: payload.court_id || payload.court?.id || payload.selected_court_id || null,
		match_id: payload.match_id || payload.match?.id || null,
		end_timestamp: payload_end_timestamp(payload),
	};
}

function schedule_finished_match_refresh(app, ws, tournament_key, payload) {
	clear_finished_match_refresh(ws);
	const end_timestamp = payload_end_timestamp(payload);
	if (!end_timestamp) {
		return;
	}
	const refresh_in_ms = Math.max(0, Number(end_timestamp) + FINISHED_MATCH_DISPLAY_MS - Date.now() + 250);
	ws.v2_finished_match_refresh_timeout = setTimeout(() => {
		ws.v2_finished_match_refresh_timeout = null;
		send_current_state(app, ws, tournament_key, null, { reason: 'finished_match_refresh' }).catch((err) => {
			console.error('[bup v2] finished match refresh failed', {
				tournament_key,
				client_id: ws && ws.client_id ? ws.client_id : null,
				err: err && err.message ? err.message : String(err),
			});
		});
	}, refresh_in_ms);
}

function send_v2_incremental_updates(ws, updates, app, tournament_key) {
	if (!updates) {
		return false;
	}
	const sent_points = send_v2_payload(ws, updates.points);
	const sent_timer = send_v2_payload(ws, updates.timer);
	if (updates.points) {
		schedule_finished_match_refresh(app, ws, tournament_key, updates.points);
	}
	return sent_points || sent_timer;
}

function log_v2_send(ws, payload, bytes) {
	if (!log_v2_sends_enabled(ws)) {
		return;
	}
	if (bytes == null) {
		bytes = payload_size_bytes(payload);
	}
	console.log('[bup v2] send', {
		ts: Date.now(),
		type: payload && payload.type ? payload.type : 'unknown',
		bytes,
		client_id: ws && ws.client_id ? ws.client_id : null,
		court_id: (
			payload && payload.court_id
				? payload.court_id
				: (payload && payload.court && payload.court.id ? payload.court.id : (payload && payload.selected_court_id ? payload.selected_court_id : null))
		),
		match_id: (
			payload && payload.match_id
				? payload.match_id
				: (payload && payload.match && payload.match.id ? payload.match.id : null)
		),
	});
}

function tournament_assets_v2(tournament) {
	const assets = {
		logo_url: logo_url_for_tournament(tournament),
		logo_background_color: tournament?.logo_background_color || '#000000',
		logo_foreground_color: tournament?.logo_foreground_color || '#aaaaaa',
	};
	return {
		...assets,
		logo_assets_version: JSON.stringify(assets),
	};
}

function send_v2_payload(ws, payload, options = {}) {
	if (!ws || ws.readyState !== 1 || !payload) {
		return false;
	}
	let payload_cache_json;
	try {
		if (payload.type === 'display_score_update') {
			payload_cache_json = display_score_update_cache_key(payload);
		} else if (payload.type === 'display_points_update') {
			payload_cache_json = display_points_update_cache_key(payload);
		} else if (payload.type === 'display_timer_update') {
			payload_cache_json = display_timer_update_cache_key(payload);
		} else {
			payload_cache_json = JSON.stringify(payload);
		}
	} catch (_err) {
		return false;
	}
	const is_incremental_payload = (
		payload.type === 'display_score_update'
		|| payload.type === 'display_points_update'
		|| payload.type === 'display_timer_update'
	);
	if (is_incremental_payload) {
		if (!ws.v2_incremental_payload_cache) {
			ws.v2_incremental_payload_cache = new Map();
		}
		const cache_key = primitive_join_key([
			payload.type,
			payload.court_id,
			payload.match_id,
		]);
		if (!options.force && ws.v2_incremental_payload_cache.get(cache_key) === payload_cache_json) {
			return false;
		}
		ws.v2_incremental_payload_cache.set(cache_key, payload_cache_json);
		if (payload.type === 'display_score_update') {
			ws.last_v2_score_payload_json = payload_cache_json;
		} else if (payload.type === 'display_points_update') {
			ws.last_v2_points_payload_json = payload_cache_json;
		} else if (payload.type === 'display_timer_update') {
			ws.last_v2_timer_payload_json = payload_cache_json;
		}
	} else {
		if (!options.force && ws.last_v2_full_payload_json === payload_cache_json) {
			return false;
		}
		ws.last_v2_full_payload_json = payload_cache_json;
		prime_incremental_cache_from_full_payload(ws, payload);
	}
	const message_id = `${Date.now()}-${ws.v2_next_message_id || 1}`;
	ws.v2_next_message_id = (ws.v2_next_message_id || 1) + 1;
	const payload_to_send = {
		...payload,
		message_id,
		sent_ts: Date.now(),
	};
	let payload_json;
	try {
		payload_json = JSON.stringify(payload_to_send);
	} catch (_err) {
		return false;
	}
	log_v2_send(ws, payload_to_send, Buffer.byteLength(payload_json, 'utf8'));
	ws.send(payload_json);
	register_v2_render_ack(ws.app, ws, payload_to_send, message_id);
	return true;
}

function outgoing_ts(app, ts) {
	if (ts == null) {
		return ts;
	}
	return app?.clock?.to_real_ts ? app.clock.to_real_ts(ts) : ts;
}

function normalize_panel_devicemode(devicemode) {
	return devicemode === 'umpire' ? 'umpire' : 'display';
}

async function is_bupws_v2_enabled(app, tournament_key) {
	const tournament = await app.db.tournaments.findOne_async({ key: tournament_key || default_tournament_key });
	debug_flags.set_from_tournament(tournament);
	return !!(tournament && tournament.bupws_v2_enabled);
}

async function send_use_bup_v1_if_disabled(app, ws, tournament_key) {
	if (await is_bupws_v2_enabled(app, tournament_key)) {
		return false;
	}
	if (ws && ws.readyState === 1) {
		ws.sendmsg({
			type: 'use-bup-v1',
			tournament_key,
		});
	}
	return true;
}

function get_default_displaysettings_id(tournament, devicemode = 'display') {
	const normalized_devicemode = normalize_panel_devicemode(devicemode);
	if (normalized_devicemode === 'umpire') {
		return (tournament && tournament.displaysettings_general_tablet)
			|| (tournament && tournament.displaysettings_general)
			|| default_displaysettings_key;
	}
	return (tournament && tournament.displaysettings_general)
		|| (tournament && tournament.displaysettings_general_tablet)
		|| default_displaysettings_key;
}

function is_default_displaysetting_id(tournament, displaysetting_id) {
	return !!displaysetting_id && !!tournament
		&& (displaysetting_id === tournament.displaysettings_general
			|| displaysetting_id === tournament.displaysettings_general_tablet);
}

function determine_client_id_from_ip(ip_address) {
	if (!ip_address) {
		return 'UNDEFINED';
	}
	const parts = String(ip_address).split('.');
	return parts[parts.length - 1];
}

function determine_client_id(ws) {
	if (!ws.client_id) {
		ws.client_id = determine_client_id_from_ip(ws?._socket?.remoteAddress);
	}
	return ws.client_id;
}

function extractIPv4FromMappedIPv6(address) {
	if (typeof address !== 'string') {
		return null;
	}
	const match = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	return match ? match[1] : null;
}

function dnsReverseWithTimeout(ip, timeoutMs) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('DNS reverse lookup timeout')), timeoutMs);
		dns.reverse(ip, (err, hostnames) => {
			clearTimeout(timer);
			if (err) {
				reject(err);
				return;
			}
			resolve(hostnames);
		});
	});
}

function getComputerName() {
	return os.hostname();
}

async function determine_client_hostname(ws) {
	if (ws.hostname) {
		return ws.hostname;
	}

	let remoteAddress = ws?._socket?.remoteAddress;
	let ipv4 = extractIPv4FromMappedIPv6(remoteAddress);
	let ip = ipv4 || remoteAddress;

	if (ip === '127.0.0.1' || ip === '::1') {
		ws.hostname = getComputerName();
		return ws.hostname;
	}
	if (!net.isIP(ip)) {
		ws.hostname = 'N/N';
		return ws.hostname;
	}
	try {
		const hostnames = await dnsReverseWithTimeout(ip, 3000);
		ws.hostname = hostnames?.[0]?.split('.')[0] || ip;
		return ws.hostname;
	} catch (_err) {
		ws.hostname = ipv4 || ip;
		return ws.hostname;
	}
}

function safe_array(value) {
	return Array.isArray(value) ? value : [];
}

function now_ms(app) {
	return app?.clock?.now_ms ? app.clock.now_ms() : Date.now();
}

function real_now_ms(app) {
	return app?.clock?.real_now_ms ? app.clock.real_now_ms() : Date.now();
}

function incoming_ts(app, ts) {
	if (ts == null) {
		return ts;
	}
	return app?.clock?.to_effective_ts ? app.clock.to_effective_ts(ts) : ts;
}

function is_match_visible_on_display(app, match) {
	if (!match) {
		return false;
	}
	if (!match.end_ts) {
		return true;
	}
	return match.end_ts > now_ms(app) - FINISHED_MATCH_DISPLAY_MS;
}

async function find_one_async(collection, query) {
	return collection.findOne_async ? collection.findOne_async(query) : new Promise((resolve, reject) => {
		collection.findOne(query, (err, doc) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(doc);
		});
	});
}

async function find_many_async(collection, query) {
	return collection.find_async ? collection.find_async(query) : new Promise((resolve, reject) => {
		collection.find(query).exec((err, docs) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(docs || []);
		});
	});
}

function logo_url_for_tournament(tournament) {
	if (!tournament || !tournament.logo_id || !tournament.key) {
		return null;
	}
	return `/h/${encodeURIComponent(tournament.key)}/logo/${tournament.logo_id}`;
}

function get_team0_left(match) {
	if (typeof match?.network_team1_left === 'boolean') {
		return match.network_team1_left;
	}
	return true;
}

function team_index_to_side(match, team_index) {
	const team0_left = get_team0_left(match);
	if (team_index === 0) {
		return team0_left ? 'left' : 'right';
	}
	return team0_left ? 'right' : 'left';
}

function side_to_team_index(match, side) {
	const team0_left = get_team0_left(match);
	if (side === 'left') {
		return team0_left ? 0 : 1;
	}
	return team0_left ? 1 : 0;
}

function team_score_to_side_score(match, score) {
	const left_team_index = side_to_team_index(match, 'left');
	const right_team_index = side_to_team_index(match, 'right');
	const team_score = Array.isArray(score) ? score : [0, 0];
	return {
		left: Number(team_score[left_team_index] || 0),
		right: Number(team_score[right_team_index] || 0),
	};
}

function current_game_score(match) {
	const network_score = safe_array(match?.network_score);
	if (network_score.length === 0) {
		return [0, 0];
	}
	return Array.isArray(network_score[network_score.length - 1]) ? network_score[network_score.length - 1] : [0, 0];
}

function is_game_finished(match, game_idx, score) {
	if (!match?.setup || !Array.isArray(score)) {
		return false;
	}
	return calc.game_winner(match.setup, game_idx, Number(score[0] || 0), Number(score[1] || 0)) !== 'inprogress';
}

function determine_server(match, current_score) {
	let team_id;
	if (typeof match?.network_team1_serving === 'boolean') {
		team_id = match.network_team1_serving ? 0 : 1;
	}
	if (team_id === undefined) {
		return {};
	}
	if (!match?.network_teams_player1_even) {
		return { team_id };
	}

	let player_id = 0;
	if (match?.setup?.is_doubles) {
		const p0even = match.network_teams_player1_even[team_id];
		if (p0even == null) {
			return { team_id };
		}
		player_id = (p0even === (Number(current_score[team_id] || 0) % 2 === 0)) ? 0 : 1;
	}

	if (safe_array(match?.network_score).length > 0) {
		const game_idx = match.network_score.length - 1;
		if (is_game_finished(match, game_idx, current_score)) {
			return { team_id };
		}
	}

	return { team_id, player_id };
}

function determine_receiver(match, current_score) {
	let team_id;
	if (typeof match?.network_team1_serving === 'boolean') {
		team_id = match.network_team1_serving ? 1 : 0;
	}
	if (team_id === undefined) {
		return {};
	}
	if (!match?.network_teams_player1_even) {
		return { team_id };
	}

	let player_id = 0;
	if (match?.setup?.is_doubles) {
		const p0even = match.network_teams_player1_even[team_id];
		if (p0even == null) {
			return { team_id };
		}
		player_id = (p0even === (Number(current_score[(team_id + 1) % 2] || 0) % 2 === 0)) ? 0 : 1;
	}

	return { team_id, player_id };
}

function player_display_name(player) {
	if (!player) {
		return 'N.N.';
	}
	if (player.name) {
		return player.name;
	}
	return [player.firstname, player.lastname].filter(Boolean).join(' ') || 'N.N.';
}

function player_display_payload(player) {
	return {
		name: player_display_name(player),
		firstname: player?.firstname || '',
		lastname: player?.lastname || player?.surname || '',
		nationality: player?.nationality || '',
	};
}

function team_players(team) {
	return safe_array(team?.players).map(player_display_name);
}

function team_player_details(team) {
	return safe_array(team?.players).map(player_display_payload);
}

function team_label(team) {
	const players = team_players(team);
	if (players.length === 0) {
		return 'N.N.';
	}
	return players.join(' / ');
}

function winner_team_index(match) {
	if (typeof match?.team1_won !== 'boolean') {
		return null;
	}
	return match.team1_won ? 0 : 1;
}

function display_score_payload_for_match(match) {
	const network_score = safe_array(match?.network_score);
	if (network_score.length === 0) {
		return {
			finished_sets: [],
			current_set: null,
			sets_won: { left: 0, right: 0 },
		};
	}
	const last_idx = network_score.length - 1;
	const last_score = network_score[last_idx];
	const last_game_finished = is_game_finished(match, last_idx, last_score);
	const last_game_winner = last_game_finished
		? calc.game_winner(match.setup, last_idx, Number(last_score[0] || 0), Number(last_score[1] || 0))
		: null;
	const displayed_finished_scores = network_score
		.slice(0, -1)
		.filter((score, game_idx) => is_game_finished(match, game_idx, score));
	const result = {
		finished_sets: displayed_finished_scores.map((score) => team_score_to_side_score(match, score)),
		current_set: team_score_to_side_score(match, last_score),
		current_set_finished: !!last_game_finished,
		current_set_winner_side: last_game_winner === 'left'
			? team_index_to_side(match, 0)
			: (last_game_winner === 'right' ? team_index_to_side(match, 1) : null),
		sets_won: { left: 0, right: 0 },
	};
	displayed_finished_scores.forEach((score, game_idx) => {
		const winner = calc.game_winner(match.setup, game_idx, Number(score[0] || 0), Number(score[1] || 0));
		if (winner === 'left') {
			result.sets_won[team_index_to_side(match, 0)] += 1;
		} else if (winner === 'right') {
			result.sets_won[team_index_to_side(match, 1)] += 1;
		}
	});
	return result;
}

function score_text(match) {
	return safe_array(match?.network_score).map((score) => {
		const side_score = team_score_to_side_score(match, score);
		return `${side_score.left}-${side_score.right}`;
	}).join(' ');
}

function build_display_settings_v2(display_settings) {
	const settings = display_settings || {};
	const style = settings.displaymode_style || settings.style || 'teamcourt';
	const result = {
		style,
		displaymode_reverse_order: !!settings.displaymode_reverse_order,
		show_second_given_name: !!settings.show_second_given_name,
		show_club_name: !!settings.show_club_name,
		fullscreen_ask: settings.fullscreen_ask || 'never',
	};
	[
		'd_c0',
		'd_cb0',
		'd_c1',
		'd_cb1',
		'd_cbg',
		'd_cfg',
		'd_cfgdark',
		'd_cbg2',
		'd_cbg3',
		'd_cbg4',
		'd_cfg2',
		'd_cfg3',
		'd_cexp',
		'd_cborder',
		'd_ct',
		'd_ctim_blue',
		'd_ctim_active',
		'd_cserv',
		'd_cserv2',
		'd_crecv',
		'd_scale',
		'd_team_colors',
		'd_show_pause',
		'd_show_court_number',
		'd_show_competition',
		'd_show_round',
		'd_show_players',
		'd_show_team_name',
		'd_show_middle_name',
		'd_abbreviate_first_name',
		'd_show_doubles_receiving',
		'd_tournament_overview_courts',
	].forEach((key) => {
		if (settings[key] !== undefined) {
			result[key] = settings[key];
		}
	});
	if (
		result.d_tournament_overview_courts === undefined &&
		style === 'tournament_overview_dm'
	) {
		result.d_tournament_overview_courts = '6,5,4,3,2';
	}
	return result;
}

function build_timer_v2(match) {
	if (!match?.setup) {
		return null;
	}
	const presses = safe_array(match.presses);
	try {
		const remote_state = calc.remote_state({}, match.setup, presses);
		if (!remote_state || !remote_state.timer || !remote_state.timer.start) {
			return null;
		}
		return {
			start: remote_state.timer.start,
			duration: remote_state.timer.duration,
			exigent: remote_state.timer.exigent,
			upwards: !!remote_state.timer.upwards,
			restart: !!remote_state.timer.restart,
		};
	} catch (err) {
		console.error('[bup v2] timer build failed', {
			match_id: match?.setup?.match_id || match?._id || null,
			err: err && err.message ? err.message : String(err),
		});
		return null;
	}
}

function match_duration_min_v2(app, match) {
	if (!match) {
		return null;
	}
	const presses = safe_array(match.presses);
	const love_all = presses.find((press) => press?.type === 'love-all' && Number.isFinite(press.timestamp));
	const start_ts = love_all?.timestamp
		|| match?.metadata?.start
		|| match?.setup?.called_timestamp
		|| null;
	if (!Number.isFinite(start_ts)) {
		return null;
	}
	return Math.max(0, Math.floor((now_ms(app) - start_ts) / 60000));
}

function build_display_state_v2(app, options) {
	const tournament = options?.tournament || null;
	const court = options?.court || null;
	const match = options?.match || null;
	const display = options?.display || {};
	const display_settings = options?.display_settings || {};
	const setup = match?.setup || {};
	const teams = safe_array(setup.teams);
	const current_score = current_game_score(match);
	const server = determine_server(match, current_score);
	const receiver = determine_receiver(match, current_score);
	const winning_team_index = winner_team_index(match);
	const tournament_assets = tournament_assets_v2(tournament);
	const tournament_payload = {
		key: tournament?.key || null,
		name: tournament?.name || '',
		logo_assets_version: tournament_assets.logo_assets_version,
	};
	if (options?.include_tournament_assets !== false) {
		tournament_payload.logo_url = tournament_assets.logo_url;
		tournament_payload.logo_background_color = tournament_assets.logo_background_color;
		tournament_payload.logo_foreground_color = tournament_assets.logo_foreground_color;
	}

	return {
		type: 'display_state',
		version: 1,
		client_mode: 'display',
		debug_output_enabled: tournament?.bts_debug_output_enabled === true,
		tournament: tournament_payload,
		display: {
			client_id: display.client_id || null,
			hostname: display.hostname || null,
			monitor_label: String(display.monitor_label || display.client_id || ''),
		},
			court: {
				id: court?._id || display.court_id || '',
				num: court?.num ?? null,
				label: court?.num != null ? String(court.num) : '',
				is_active: court?.is_active !== false,
			},
		view: {
			screen: match ? 'live_match' : 'idle',
		},
		match: match ? {
			id: setup.match_id || match._id || null,
			status: setup.state || null,
			event_name: setup.event_name || '',
			round_name: setup.match_name || '',
			counting: setup.counting || null,
			scoring_format: setup.scoring_format || null,
			scheduled_date: setup.scheduled_date || null,
			scheduled_time: setup.scheduled_time_str || null,
			called_timestamp: outgoing_ts(app, setup.called_timestamp),
			start_timestamp: outgoing_ts(app, match?.metadata?.start || setup.called_timestamp || null),
			end_timestamp: outgoing_ts(app, match?.end_ts || null),
			best_of: Number(setup.best_of || 0) || null,
			is_doubles: !!setup.is_doubles,
			team_competition: !!setup.team_competition,
			nation_competition: !!setup.nation_competition,
		} : null,
		teams: teams.map((team, team_index) => ({
			side: team_index_to_side(match, team_index),
			name: team?.name || team_label(team),
			players: team_players(team),
			player_details: team_player_details(team),
			is_winner: winning_team_index === team_index,
		})),
		score: display_score_payload_for_match(match),
		service: {
			server: (server.team_id === undefined) ? null : {
				side: team_index_to_side(match, server.team_id),
				team_index: server.team_id,
				player_index: server.player_id ?? null,
				label: server.player_id != null
					? player_display_name(teams[server.team_id]?.players?.[server.player_id])
					: team_label(teams[server.team_id]),
			},
			receiver: (receiver.team_id === undefined) ? null : {
				side: team_index_to_side(match, receiver.team_id),
				team_index: receiver.team_id,
				player_index: receiver.player_id ?? null,
				label: receiver.player_id != null
					? player_display_name(teams[receiver.team_id]?.players?.[receiver.player_id])
					: team_label(teams[receiver.team_id]),
			},
		},
		timers: {
			match_duration_sec: Number.isFinite(match?.duration_ms) ? Math.round(match.duration_ms / 1000) : null,
			pause_remaining_sec: null,
			active_timer: build_timer_v2(match),
		},
		match_duration_min: match_duration_min_v2(app, match),
		display_settings: build_display_settings_v2(display_settings),
	};
}

function build_display_score_update_v2(app, options) {
	const court = options?.court || null;
	const match = options?.match || null;
	const setup = match?.setup || {};
	const teams = safe_array(setup.teams);
	const current_score = current_game_score(match);
	const server = determine_server(match, current_score);
	const receiver = determine_receiver(match, current_score);
	const winning_team_index = winner_team_index(match);
	const winner_side = winning_team_index == null ? null : team_index_to_side(match, winning_team_index);
	const payload = {
		type: 'display_score_update',
		version: 1,
		court_id: court?._id || '',
		match_id: setup.match_id || match?._id || null,
		status: setup.state || null,
		score: display_score_payload_for_match(match),
		service: {
			server: (server.team_id === undefined) ? null : {
				side: team_index_to_side(match, server.team_id),
				team_index: server.team_id,
				player_index: server.player_id ?? null,
			},
			receiver: (receiver.team_id === undefined) ? null : {
				side: team_index_to_side(match, receiver.team_id),
				team_index: receiver.team_id,
				player_index: receiver.player_id ?? null,
			},
		},
		timers: {
			active_timer: build_timer_v2(match),
		},
	};
	if (winner_side) {
		payload.winner_side = winner_side;
	}
	if (match?.end_ts) {
		payload.end_timestamp = outgoing_ts(app, match.end_ts);
	}
	return payload;
}

function build_display_points_update_v2(app, options) {
	const court = options?.court || null;
	const match = options?.match || null;
	const setup = match?.setup || {};
	const teams = safe_array(setup.teams);
	const current_score = current_game_score(match);
	const server = determine_server(match, current_score);
	const receiver = determine_receiver(match, current_score);
	const winning_team_index = winner_team_index(match);
	const winner_side = winning_team_index == null ? null : team_index_to_side(match, winning_team_index);
	return {
		type: 'display_points_update',
		version: 1,
		court_id: court?._id || '',
		match_id: setup.match_id || match?._id || null,
		status: setup.state || null,
		winner_side,
		end_timestamp: match?.end_ts ? outgoing_ts(app, match.end_ts) : null,
		score: display_score_payload_for_match(match),
		service: {
			server: (server.team_id === undefined) ? null : {
				side: team_index_to_side(match, server.team_id),
				team_index: server.team_id,
				player_index: server.player_id ?? null,
			},
			receiver: (receiver.team_id === undefined) ? null : {
				side: team_index_to_side(match, receiver.team_id),
				team_index: receiver.team_id,
				player_index: receiver.player_id ?? null,
			},
		},
	};
}

function build_display_timer_update_v2(_app, options) {
	const court = options?.court || null;
	const match = options?.match || null;
	const setup = match?.setup || {};
	return {
		type: 'display_timer_update',
		version: 1,
		court_id: court?._id || '',
		match_id: setup.match_id || match?._id || null,
		timers: {
			active_timer: build_timer_v2(match),
		},
	};
}

function build_display_incremental_updates_v2(app, options) {
	return {
		points: build_display_points_update_v2(app, options),
		timer: build_display_timer_update_v2(app, options),
	};
}

function is_multi_court_display_style(display_settings) {
	const style = display_settings?.displaymode_style || display_settings?.style || 'teamcourt';
	return MULTI_COURT_DISPLAY_STYLES.has(style);
}

function is_fieldless_multi_court_display_style(display_settings) {
	const style = display_settings?.displaymode_style || display_settings?.style || 'teamcourt';
	return FIELDLESS_MULTI_COURT_DISPLAY_STYLES.has(style);
}

function is_multi_court_assignment(court_id) {
	return court_id === MULTI_COURT_ASSIGNMENT_ID;
}

function should_send_multi_state(inputs) {
	return is_multi_court_display_style(inputs?.display_settings)
		&& (
			(
				is_fieldless_multi_court_display_style(inputs?.display_settings)
				&& is_multi_court_assignment(inputs?.display_court_displaysetting?.court_id)
			)
			|| !!inputs?.court
		);
}

function compare_courts_for_display(a, b) {
	const num_a = Number(a?.num);
	const num_b = Number(b?.num);
	if (Number.isFinite(num_a) && Number.isFinite(num_b) && num_a !== num_b) {
		return num_a - num_b;
	}
	return String(a?._id || '').localeCompare(String(b?._id || ''));
}

function select_courts_for_display_style(courts, display_settings, selected_court_id) {
	const sorted_courts = safe_array(courts).slice().sort(compare_courts_for_display);
	const style = display_settings?.displaymode_style || display_settings?.style || '';
	if (!['2court', 'castall', 'stream'].includes(style) || !selected_court_id) {
		return sorted_courts;
	}
	const selected_idx = sorted_courts.findIndex((court) => court?._id === selected_court_id);
	if (selected_idx < 0) {
		return sorted_courts.slice(0, 2);
	}
	return sorted_courts.slice(selected_idx, Math.min(sorted_courts.length, selected_idx + 2));
}

function remember_v2_display_payload_shape(ws, payload) {
	if (!ws || !payload) {
		return;
	}
	ws.v2_multi_court_display = payload.type === 'display_multi_state';
	if (payload.type === 'display_multi_state') {
		ws.last_v2_match_ids_by_court = new Map();
		safe_array(payload.court_states).forEach((court_state) => {
			if (court_state?.court?.id) {
				ws.last_v2_match_ids_by_court.set(
					court_state.court.id,
					court_state?.match?.id || null,
				);
			}
		});
		return;
	}
	delete ws.last_v2_match_ids_by_court;
}

function build_display_multi_state_v2(app, options) {
	const tournament = options?.tournament || null;
	const courts = safe_array(options?.courts);
	const matches = safe_array(options?.matches);
	const display = options?.display || {};
	const display_settings = options?.display_settings || {};
	const tournament_assets = tournament_assets_v2(tournament);
	const tournament_payload = {
		key: tournament?.key || null,
		name: tournament?.name || '',
		logo_assets_version: tournament_assets.logo_assets_version,
	};
	if (options?.include_tournament_assets !== false) {
		tournament_payload.logo_url = tournament_assets.logo_url;
		tournament_payload.logo_background_color = tournament_assets.logo_background_color;
		tournament_payload.logo_foreground_color = tournament_assets.logo_foreground_color;
	}
	const match_by_id = new Map(matches.map((match) => [match?._id || match?.setup?.match_id, match]));
	const match_by_court_id = options?.matches_by_court_id instanceof Map
		? options.matches_by_court_id
		: new Map();
	const display_courts = select_courts_for_display_style(courts, display_settings, display.court_id);
	return {
		type: 'display_multi_state',
		version: 1,
		client_mode: 'display',
		debug_output_enabled: tournament?.bts_debug_output_enabled === true,
		tournament: tournament_payload,
		display: {
			client_id: display.client_id || null,
			hostname: display.hostname || null,
			monitor_label: String(display.monitor_label || display.client_id || ''),
		},
		selected_court_id: display.court_id || '',
		display_settings: build_display_settings_v2(display_settings),
		court_states: display_courts.map((court) => build_display_state_v2(app, {
			tournament,
			court,
			match: match_by_court_id.get(court?._id) || match_by_id.get(court?.match_id) || null,
			display,
			display_settings,
			include_tournament_assets: false,
		})),
	};
}

function build_court_picker_state_v2(options) {
	const tournament = options?.tournament || null;
	const display = options?.display || {};
	const display_settings = options?.display_settings || {};
	const courts = safe_array(options?.courts);
	const matches = safe_array(options?.matches);
	const match_by_id = new Map(matches.map((match) => [match?._id || match?.setup?.match_id, match]));

	return {
		type: 'court_picker_state',
		version: 1,
		client_mode: options?.client_mode || 'display',
		debug_output_enabled: tournament?.bts_debug_output_enabled === true,
		tournament: {
			key: tournament?.key || null,
			name: tournament?.name || '',
		},
		display: {
			client_id: display.client_id || null,
			hostname: display.hostname || null,
			monitor_label: String(display.monitor_label || display.client_id || ''),
		},
		display_settings: build_display_settings_v2(display_settings),
		courts: courts.map((court) => {
			const match = match_by_id.get(court?.match_id) || null;
			return {
				court_id: court?._id || '',
				court_num: court?.num ?? null,
				match: match ? {
					id: match?._id || match?.setup?.match_id || null,
					event_name: match?.setup?.event_name || '',
					round_name: match?.setup?.match_name || '',
					team1: team_label(match?.setup?.teams?.[0]),
					team2: team_label(match?.setup?.teams?.[1]),
					score_text: score_text(match),
					status: match?.setup?.state || null,
					network_score: match?.network_score || [],
					score_status: match?.score_status || 'normal',
					score_status_network_score: match?.score_status_network_score,
					setup: {
						match_id: 'bts_' + (match?._id || match?.setup?.match_id || ''),
						event_name: match?.setup?.event_name || '',
						match_name: match?.setup?.match_name || '',
						is_doubles: !!match?.setup?.is_doubles,
						teams: match?.setup?.teams || [],
					},
				} : null,
			};
		}),
	};
}

async function get_display_court_displaysettings(app, client_id) {
	return find_one_async(app.db.display_court_displaysettings, { client_id });
}

function create_display_court_displaysettings(client_id, hostname, court_id, displaysetting_id, panel_devicemode = 'display') {
	return {
		client_id,
		hostname,
		court_id,
		displaysetting_id,
		panel_devicemode: normalize_panel_devicemode(panel_devicemode),
	};
}

async function persist_display_court_displaysettings(app, display_court_displaysetting) {
	return new Promise((resolve, reject) => {
		app.db.display_court_displaysettings.insert(display_court_displaysetting, (err, inserted) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(inserted);
		});
	});
}

async function update_display_court_displaysettings(app, client_id, updatevalues) {
	const setvalues = {};
	const unsetvalues = {};
	Object.keys(updatevalues || {}).forEach((key) => {
		if (updatevalues[key] === undefined) {
			unsetvalues[key] = true;
		} else {
			setvalues[key] = updatevalues[key];
		}
	});
	const modifier = {};
	if (Object.keys(setvalues).length > 0) {
		modifier.$set = setvalues;
	}
	if (Object.keys(unsetvalues).length > 0) {
		modifier.$unset = unsetvalues;
	}
	if (Object.keys(modifier).length === 0) {
		return get_display_court_displaysettings(app, client_id);
	}
	return new Promise((resolve, reject) => {
		app.db.display_court_displaysettings.update({ client_id }, modifier, { returnUpdatedDocs: true }, (err, _numAffected, changed) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(changed);
		});
	});
}

async function resolve_panel_displaysetting_id(app, tournament, preferred_displaysetting_id, panel_devicemode = 'display') {
	const normalized_panel_devicemode = normalize_panel_devicemode(panel_devicemode);
	if (preferred_displaysetting_id) {
		const preferred_displaysetting = await find_one_async(app.db.displaysettings, { id: preferred_displaysetting_id });
		if (preferred_displaysetting && preferred_displaysetting.devicemode === normalized_panel_devicemode) {
			return preferred_displaysetting_id;
		}
	}
	return get_default_displaysettings_id(tournament, normalized_panel_devicemode);
}

async function ensure_panel_court_displaysettings(app, tournament, client_id, hostname, preferred_displaysetting_id, panel_devicemode = 'display') {
	const normalized_panel_devicemode = normalize_panel_devicemode(panel_devicemode);
	let display_court_displaysetting = await get_display_court_displaysettings(app, client_id);
	const displaysetting_id = await resolve_panel_displaysetting_id(app, tournament, preferred_displaysetting_id, normalized_panel_devicemode);
	if (display_court_displaysetting) {
		let current_displaysetting = null;
		if (display_court_displaysetting.displaysetting_id) {
			current_displaysetting = await find_one_async(app.db.displaysettings, { id: display_court_displaysetting.displaysetting_id });
		}
		const updatevalues = {};
		if (hostname && display_court_displaysetting.hostname !== hostname) {
			updatevalues.hostname = hostname;
		}
		if (display_court_displaysetting.panel_devicemode !== normalized_panel_devicemode) {
			updatevalues.panel_devicemode = normalized_panel_devicemode;
		}
		if (normalized_panel_devicemode === 'umpire' && is_multi_court_assignment(display_court_displaysetting.court_id)) {
			updatevalues.court_id = undefined;
		}
		const uses_default_setting = is_default_displaysetting_id(tournament, display_court_displaysetting.displaysetting_id);
		const has_wrong_mode = current_displaysetting && current_displaysetting.devicemode !== normalized_panel_devicemode;
		const is_missing_setting = !display_court_displaysetting.displaysetting_id || !current_displaysetting;
		if (uses_default_setting || has_wrong_mode || is_missing_setting) {
			updatevalues.displaysetting_id = displaysetting_id;
		}
		if (Object.keys(updatevalues).length > 0) {
			display_court_displaysetting = await update_display_court_displaysettings(app, client_id, updatevalues);
		}
		return display_court_displaysetting;
	}
	display_court_displaysetting = create_display_court_displaysettings(
		client_id,
		hostname,
		undefined,
		displaysetting_id,
		normalized_panel_devicemode,
	);
	return persist_display_court_displaysettings(app, display_court_displaysetting);
}

async function get_recent_finished_match_for_court(app, tournament_key, court_id) {
	if (!court_id) {
		return null;
	}
	const matches = await find_many_async(app.db.matches, {
		tournament_key,
		'setup.court_id': court_id,
		end_ts: { $gt: now_ms(app) - FINISHED_MATCH_DISPLAY_MS },
	});
	matches.sort((a, b) => (b.end_ts || 0) - (a.end_ts || 0));
	return matches.find((match) => is_match_visible_on_display(app, match)) || null;
}

async function get_effective_display_state_inputs(app, tournament_key, ws, msg) {
	const client_id = determine_client_id(ws);
	const hostname = await determine_client_hostname(ws);
	const panel_devicemode = normalize_panel_devicemode(
		msg?.panel_settings?.devicemode || ws?.panel_devicemode || 'display'
	);
	let tournament = await find_one_async(app.db.tournaments, { key: tournament_key });
	if (!tournament) {
		throw new Error('No tournament ' + tournament_key);
	}
	({ tournament } = await displaysettings_defaults.ensure_default_displaysettings(app, tournament));
	remember_v2_tournament_settings(ws, tournament);
	const display_court_displaysetting = await ensure_panel_court_displaysettings(
		app,
		tournament,
		client_id,
		hostname,
		msg?.panel_settings?.id,
		panel_devicemode,
	);
	const displaysetting_id = display_court_displaysetting?.displaysetting_id
		|| msg?.panel_settings?.id
		|| get_default_displaysettings_id(tournament, panel_devicemode);
	const display_settings = displaysetting_id
		? await find_one_async(app.db.displaysettings, { id: displaysetting_id })
		: null;
	const court_id = display_court_displaysetting?.court_id || '';
	const court_lookup_id = is_multi_court_assignment(court_id) ? '' : court_id;
	const court = court_lookup_id ? await find_one_async(app.db.courts, { tournament_key, _id: court_lookup_id }) : null;
	let raw_match = court?.match_id ? await find_one_async(app.db.matches, { tournament_key, _id: court.match_id }) : null;
	if (!raw_match && court_lookup_id) {
		raw_match = await get_recent_finished_match_for_court(app, tournament_key, court_lookup_id);
	}
	const match = is_match_visible_on_display(app, raw_match) ? raw_match : null;
	return {
		client_id,
		hostname,
		tournament,
		panel_devicemode,
		display_court_displaysetting,
		display_settings,
		court,
		match,
	};
}

async function get_court_picker_inputs(app, tournament_key, ws, msg) {
	const base = await get_effective_display_state_inputs(app, tournament_key, ws, msg);
	const courts = await find_many_async(app.db.courts, { tournament_key });
	const match_ids = courts.map((court) => court?.match_id).filter(Boolean);
	const raw_matches = match_ids.length > 0
		? await find_many_async(app.db.matches, { tournament_key, _id: { $in: match_ids } })
		: [];
	const matches = raw_matches.filter((match) => is_match_visible_on_display(app, match));
	return {
		...base,
		courts,
		matches,
	};
}

async function get_display_multi_state_inputs(app, tournament_key, ws, msg) {
	const base = await get_effective_display_state_inputs(app, tournament_key, ws, msg);
	const courts = await find_many_async(app.db.courts, { tournament_key });
	const match_ids = courts.map((court) => court?.match_id).filter(Boolean);
	const raw_matches = match_ids.length > 0
		? await find_many_async(app.db.matches, { tournament_key, _id: { $in: match_ids } })
		: [];
	const match_by_id = new Map(raw_matches.map((match) => [match?._id, match]));
	const matches_by_court_id = new Map();
	await Promise.all(courts.map(async (court) => {
		let match = court?.match_id ? match_by_id.get(court.match_id) : null;
		if (!is_match_visible_on_display(app, match)) {
			match = await get_recent_finished_match_for_court(app, tournament_key, court?._id);
		}
		if (match && is_match_visible_on_display(app, match)) {
			matches_by_court_id.set(court._id, match);
		}
	}));
	return {
		...base,
		courts,
		matches: Array.from(matches_by_court_id.values()),
		matches_by_court_id,
	};
}

function cmp_umpire_matches(a, b) {
	const priority = (match) => {
		if (!match || !match.setup) {
			return 99;
		}
		if (match.setup.now_on_court === true) {
			return 0;
		}
		if (match.setup.state === 'oncourt') {
			return 1;
		}
		if (match.setup.state === 'blocked') {
			return 2;
		}
		if (match.setup.state === 'finished') {
			return 3;
		}
		return 4;
	};
	const priority_diff = priority(a) - priority(b);
	if (priority_diff !== 0) {
		return priority_diff;
	}
	const a_called = (a && a.setup && a.setup.called_timestamp) || 0;
	const b_called = (b && b.setup && b.setup.called_timestamp) || 0;
	if (a_called !== b_called) {
		return b_called - a_called;
	}
	const a_end = a && a.end_ts ? a.end_ts : 0;
	const b_end = b && b.end_ts ? b.end_ts : 0;
	if (a_end !== b_end) {
		return b_end - a_end;
	}
	return String((a && a.setup && a.setup.match_id) || '').localeCompare(String((b && b.setup && b.setup.match_id) || ''));
}

function complete_player_name_parts(player) {
	if (!player || player.lastname) {
		return;
	}
	const asian_match = /^([A-Z]+)\s+(.*)$/.exec(player.name || '');
	if (asian_match) {
		player.lastname = asian_match[1];
		player.firstname = asian_match[2];
		player._guess_info = 'bts_asian';
		return;
	}
	const western_match = /^(.*)\s+(\S+)$/.exec(player.name || '');
	if (western_match) {
		player.firstname = western_match[1];
		player.lastname = western_match[2];
		player._guess_info = 'bts_western';
		return;
	}
	player.firstname = '';
	player.lastname = player.name || '';
	player._guess_info = 'bts_single';
}

function build_umpire_match_representation(app, _tournament, match) {
	const setup = JSON.parse(JSON.stringify(match.setup || {}));
	setup.match_id = 'bts_' + match._id;
	for (const team of safe_array(setup.teams)) {
		for (const player of safe_array(team.players)) {
			complete_player_name_parts(player);
		}
	}
	setup.called_timestamp = outgoing_ts(app, setup.called_timestamp);
	setup.preparation_call_timestamp = outgoing_ts(app, setup.preparation_call_timestamp);
	setup.needs_preparation_successor_ts = outgoing_ts(app, setup.needs_preparation_successor_ts);
	const result = {
		setup,
		network_score: match.network_score,
		score_status: match.score_status,
		score_status_network_score: match.score_status_network_score,
		network_team1_left: match.network_team1_left,
		network_team1_serving: match.network_team1_serving,
		network_teams_player1_even: match.network_teams_player1_even,
		end_ts: match.end_ts !== undefined ? outgoing_ts(app, match.end_ts) : null,
	};
	if (match.presses) {
		result.presses_json = JSON.stringify(match.presses);
	}
	return result;
}

function build_umpire_event_representation(tournament) {
	const result = {
		id: 'bts_' + tournament.key,
		tournament_name: tournament.name,
	};
	const assets = tournament_assets_v2(tournament);
	if (assets.logo_url) {
		result.tournament_logo_url = assets.logo_url;
	}
	result.tournament_logo_background_color = assets.logo_background_color;
	result.tournament_logo_foreground_color = assets.logo_foreground_color;
	return result;
}

async function build_umpire_score_event(app, tournament_key, court_id) {
	const now = now_ms(app);
	const show_still = now - FINISHED_MATCH_DISPLAY_MS;
	const query = {
		tournament_key,
		$or: [
			{
				$and: [
					{ team1_won: { $ne: true } },
					{ team1_won: { $ne: false } },
				],
			},
			{ end_ts: { $gt: show_still } },
		],
	};
	if (court_id) {
		query['setup.court_id'] = court_id;
	} else {
		query['setup.court_id'] = { $exists: true };
	}
	const [tournament, db_matches, db_courts] = await Promise.all([
		find_one_async(app.db.tournaments, { key: tournament_key }),
		find_many_async(app.db.matches, query),
		find_many_async(app.db.courts, { tournament_key }),
	]);
	if (!tournament) {
		throw new Error('No tournament ' + tournament_key);
	}
	let matches = safe_array(db_matches).map((match) => build_umpire_match_representation(app, tournament, match));
	if (!court_id) {
		matches = matches.filter((match) => match.setup && match.setup.now_on_court);
	}
	matches = matches.filter((match) => (
		match.setup && (match.setup.state === 'oncourt' || match.setup.state === 'finished' || match.setup.state === 'blocked')
	));
	matches.sort(cmp_umpire_matches);
	const courts = safe_array(db_courts)
		.slice()
		.sort(compare_courts_for_display)
		.map((court) => {
			const result = {
				court_id: court._id,
				label: court.num,
			};
			if (court.match_id) {
				result.match_id = 'bts_' + court.match_id;
			}
			if (court.called_timestamp) {
				result.called_timestamp = outgoing_ts(app, court.called_timestamp);
			}
			return result;
		});
	const event = build_umpire_event_representation(tournament);
	event.matches = matches;
	event.courts = courts;
	return event;
}

function umpire_score_event_signature(event) {
	return stable_json({
		matches: safe_array(event?.matches).map((match) => ({
			match_id: match?.setup?.match_id || '',
			court_id: match?.setup?.court_id || '',
			state: match?.setup?.state || '',
			now_on_court: match?.setup?.now_on_court ?? null,
			called_timestamp: match?.setup?.called_timestamp || null,
			preparation_call_timestamp: match?.setup?.preparation_call_timestamp || null,
			network_score: match?.network_score || [],
			network_team1_left: match?.network_team1_left ?? null,
			network_team1_serving: match?.network_team1_serving ?? null,
			network_teams_player1_even: match?.network_teams_player1_even ?? null,
			end_ts: match?.end_ts || null,
			presses_json: match?.presses_json || '',
		})),
		courts: safe_array(event?.courts).map((court) => ({
			court_id: court?.court_id || '',
			match_id: court?.match_id || '',
			called_timestamp: court?.called_timestamp || null,
		})),
	});
}

function umpire_score_event_summary(event) {
	const matches = safe_array(event?.matches);
	return {
		match_count: matches.length,
		matches: matches.map((match) => {
			const setup = match?.setup || {};
			let presses_len = null;
			if (match?.presses_json) {
				try {
					presses_len = safe_array(JSON.parse(match.presses_json)).length;
				} catch (_err) {
					presses_len = 'invalid';
				}
			}
			return {
				match_id: setup.match_id || null,
				court_id: setup.court_id || null,
				state: setup.state || null,
				now_on_court: setup.now_on_court ?? null,
				score: match?.network_score || [],
				serving: match?.network_team1_serving ?? null,
				receiver_even: match?.network_teams_player1_even ?? null,
				end_ts: match?.end_ts || null,
				presses_len,
			};
		}),
		courts: safe_array(event?.courts).map((court) => ({
			court_id: court?.court_id || null,
			match_id: court?.match_id || null,
			called_timestamp: court?.called_timestamp || null,
		})),
	};
}

function send_v2_change(app, ws, tournament_key, ctype, val) {
	if (!ws || ws.readyState !== 1) {
		return false;
	}
	if (ws.panel_devicemode === 'umpire') {
		debug_tablet_loop(app, 'send_v2_change', {
			client_id: determine_client_id(ws),
			court_id: ws.court_id || null,
			ctype,
			reason: ws.last_umpire_refresh_reason || null,
			match_count: safe_array(val?.event?.matches).length,
		});
	}
	admin.notify_change(app, tournament_key, 'display_wait_for_done', {
		ctype,
		val,
		client_id: determine_client_id(ws),
	});
	ws.sendmsg({
		type: 'change',
		tournament_key,
		ctype,
		val,
	});
	return true;
}

function score_update_opens_match(score_data) {
	const presses = safe_array(score_data?.presses);
	if (presses.length === 0) {
		return false;
	}
	const last_press = presses[presses.length - 1] || {};
	return last_press.type === '_start_match';
}

function umpire_match_owner_key(tournament_key, match_id) {
	return String(tournament_key || default_tournament_key) + ':' + String(match_id || '').replace(/^bts_/, '');
}

function clear_umpire_match_owners_for_ws(ws) {
	for (const [key, owner] of active_umpire_match_owners.entries()) {
		if (owner && owner.ws === ws) {
			active_umpire_match_owners.delete(key);
		}
	}
}

function claim_umpire_match_owner(app, tournament_key, owner_ws, score_data) {
	const match_id = String(score_data?.match_id || '').replace(/^bts_/, '');
	if (!match_id) {
		return;
	}
	const court_id = score_data?.court_id || owner_ws?.court_id || null;
	const key = umpire_match_owner_key(tournament_key, match_id);
	active_umpire_match_owners.set(key, {
		ws: owner_ws,
		client_id: determine_client_id(owner_ws),
		court_id,
		ts: Date.now(),
	});
	debug_tablet_loop(app, 'match_owner:claim', {
		client_id: determine_client_id(owner_ws),
		court_id,
		match_id,
	});
	release_match_on_other_umpires(app, tournament_key, owner_ws, {
		match_id,
		court_id,
	});
}

function score_update_rejected_by_owner(app, tournament_key, ws, score_data) {
	const match_id = String(score_data?.match_id || '').replace(/^bts_/, '');
	if (!match_id) {
		return false;
	}
	const key = umpire_match_owner_key(tournament_key, match_id);
	const owner = active_umpire_match_owners.get(key);
	if (!owner || !owner.ws || owner.ws.readyState !== 1) {
		claim_umpire_match_owner(app, tournament_key, ws, score_data);
		return false;
	}
	if (owner.ws === ws) {
		return false;
	}
	debug_tablet_loop(app, 'score_update:reject-non-owner', {
		client_id: determine_client_id(ws),
		owner_client_id: owner.client_id || null,
		court_id: score_data?.court_id || null,
		owner_court_id: owner.court_id || null,
		match_id,
	});
	send_v2_change(app, ws, tournament_key, 'release-match', {
		match_id,
		court_id: score_data?.court_id || owner.court_id || null,
		owner_client_id: owner.client_id || null,
		reason: 'match-owned-by-other-tablet',
	});
	return true;
}

function release_match_on_other_umpires(app, tournament_key, owner_ws, score_data) {
	const match_id = score_data?.match_id;
	const court_id = score_data?.court_id;
	if (!match_id) {
		return;
	}
	const owner_client_id = determine_client_id(owner_ws);
	all_panels.forEach((ws) => {
		if (
			!ws ||
			ws === owner_ws ||
			ws.readyState !== 1 ||
			ws.last_tournament_key !== tournament_key ||
			ws.panel_devicemode !== 'umpire'
		) {
			return;
		}
		send_v2_change(app, ws, tournament_key, 'release-match', {
			match_id,
			court_id,
			owner_client_id,
			reason: 'opened-on-other-tablet',
		});
	});
}

async function handle_match_opened(app, ws, msg) {
	const tournament_key = msg.tournament_key || ws.last_tournament_key || default_tournament_key;
	const match_id = String(msg.match_id || '').replace(/^bts_/, '');
	const court_id = msg.court_id || ws.court_id || null;
	ws.panel_devicemode = 'umpire';
	if (court_id) {
		ws.court_id = court_id;
	}
	debug_tablet_loop(app, 'match_opened', {
		client_id: determine_client_id(ws),
		court_id,
		match_id,
	});
	claim_umpire_match_owner(app, tournament_key, ws, {
		match_id,
		court_id,
	});
}

async function send_umpire_courts_update(app, ws, tournament_key) {
	const courts = await find_many_async(app.db.courts, { tournament_key });
	send_v2_change(app, ws, tournament_key, 'courts-update', courts);
}

async function build_umpire_settings_payload(app, inputs) {
	const advertisements = await find_many_async(app.db.advertisements, {});
	return {
		...(inputs.display_settings || {}),
		bts_debug_output_enabled: inputs.tournament?.bts_debug_output_enabled === true,
		court_id: inputs.display_court_displaysetting?.court_id || '',
		displaymode_court_id: inputs.display_court_displaysetting?.court_id || '',
		client_id: inputs.client_id,
		hostname: inputs.hostname,
		monitor_label: String(inputs.display_court_displaysetting?.client_id || inputs.client_id || ''),
		advertisements,
	};
}

async function send_umpire_current_state(app, ws, tournament_key, msg, options = {}) {
	const reason = options.reason || msg?.type || 'unknown';
	ws.last_umpire_refresh_reason = reason;
	debug_tablet_loop(app, 'send_umpire_current_state:start', {
		client_id: determine_client_id(ws),
		court_id: ws.court_id || null,
		reason,
		send_settings: options.send_settings !== false,
		send_courts: options.send_courts !== false,
	});
	const inputs = await get_effective_display_state_inputs(app, tournament_key, ws, msg);
	ws.panel_devicemode = 'umpire';
	ws.court_id = inputs.court?._id || undefined;
	debug_tablet_loop(app, 'send_umpire_current_state:inputs', {
		client_id: determine_client_id(ws),
		court_id: ws.court_id || null,
		reason,
		has_court: !!inputs.court,
		settings_court_id: inputs.display_court_displaysetting?.court_id || null,
	});
	const settings_payload = await build_umpire_settings_payload(app, inputs);
	if (options.send_settings !== false) {
		send_v2_change(app, ws, tournament_key, 'settings-update', settings_payload);
	}
	if (options.send_courts !== false) {
		await send_umpire_courts_update(app, ws, tournament_key);
	}
	if (!inputs.court) {
		const picker_inputs = await get_court_picker_inputs(app, tournament_key, ws, msg);
		const display = {
			client_id: inputs.client_id,
			hostname: inputs.hostname,
			monitor_label: inputs.display_court_displaysetting?.client_id || inputs.client_id,
			court_id: '',
		};
		send_v2_payload(ws, build_court_picker_state_v2({
			tournament: picker_inputs.tournament,
			display,
			display_settings: picker_inputs.display_settings,
			courts: picker_inputs.courts,
			matches: picker_inputs.matches,
			client_mode: 'umpire',
		}), { force: true });
		return;
	}
	const event = await build_umpire_score_event(app, tournament_key, inputs.court._id);
	const score_event_signature = umpire_score_event_signature(event);
	const score_event_hash = short_hash(score_event_signature);
	if (options.force !== true && ws.last_umpire_score_event_signature === score_event_signature) {
		debug_tablet_loop(app, 'send_umpire_current_state:skip-identical-score', {
			client_id: determine_client_id(ws),
			court_id: ws.court_id || null,
			reason,
			hash: score_event_hash,
			summary: umpire_score_event_summary(event),
		});
		return;
	}
	debug_tablet_loop(app, 'send_umpire_current_state:send-score', {
		client_id: determine_client_id(ws),
		court_id: ws.court_id || null,
		reason,
		hash: score_event_hash,
		previous_hash: ws.last_umpire_score_event_signature ? short_hash(ws.last_umpire_score_event_signature) : null,
		force: options.force === true,
		summary: umpire_score_event_summary(event),
	});
	ws.last_umpire_score_event_signature = score_event_signature;
	send_v2_change(app, ws, tournament_key, 'score-update', {
		status: 'ok',
		event,
	});
}

async function handle_init(app, ws, msg) {
	const tournament_key = msg.tournament_key || default_tournament_key;
	ws.last_tournament_key = tournament_key;
	if (await send_use_bup_v1_if_disabled(app, ws, tournament_key)) {
		return;
	}
	ws.panel_devicemode = normalize_panel_devicemode(msg?.panel_settings?.devicemode || ws.panel_devicemode);
	if (ws.panel_devicemode === 'umpire') {
		if (should_skip_duplicate_umpire_init(app, ws, tournament_key, msg)) {
			return;
		}
		notify_v2_display_status_changed(app, ws, true);
		await send_umpire_current_state(app, ws, tournament_key, msg, {
			send_settings: true,
			send_courts: true,
			reason: 'init',
		});
		return;
	}
	const inputs = await get_effective_display_state_inputs(app, tournament_key, ws, msg);
	notify_v2_display_status_changed(app, ws, true);
	const display = {
		client_id: inputs.client_id,
		hostname: inputs.hostname,
		monitor_label: inputs.display_court_displaysetting?.client_id || inputs.client_id,
		court_id: inputs.display_court_displaysetting?.court_id || '',
	};
	let payload;
	if (should_send_multi_state(inputs)) {
		ws.court_id = inputs.court?._id;
		ws.last_v2_match_id = null;
		ws.last_v2_tournament_assets_key = tournament_assets_v2(inputs.tournament).logo_assets_version;
		const multi_inputs = await get_display_multi_state_inputs(app, tournament_key, ws, msg);
		payload = build_display_multi_state_v2(app, {
			tournament: multi_inputs.tournament,
			courts: multi_inputs.courts,
			matches: multi_inputs.matches,
			matches_by_court_id: multi_inputs.matches_by_court_id,
			display,
			display_settings: multi_inputs.display_settings,
			include_tournament_assets: true,
		});
	} else if (inputs.court) {
		ws.court_id = inputs.court._id;
		ws.last_v2_tournament_assets_key = tournament_assets_v2(inputs.tournament).logo_assets_version;
		ws.last_v2_match_id = inputs.match?.setup?.match_id || inputs.match?._id || null;
		payload = build_display_state_v2(app, {
			tournament: inputs.tournament,
			court: inputs.court,
			match: inputs.match,
			display,
			display_settings: inputs.display_settings,
			include_tournament_assets: true,
		});
	} else {
		ws.court_id = undefined;
		ws.last_v2_match_id = null;
		const picker_inputs = await get_court_picker_inputs(app, tournament_key, ws, msg);
		payload = build_court_picker_state_v2({
			tournament: picker_inputs.tournament,
			display,
			display_settings: picker_inputs.display_settings,
			courts: picker_inputs.courts,
			matches: picker_inputs.matches,
			client_mode: inputs.panel_devicemode,
		});
	}
	remember_v2_display_payload_shape(ws, payload);
	send_v2_payload(ws, payload);
	schedule_finished_match_refresh(app, ws, tournament_key, payload);
}

async function send_current_state(app, ws, tournament_key, msg, options = {}) {
	if (!ws || ws.readyState !== 1) {
		return;
	}
	if (await send_use_bup_v1_if_disabled(app, ws, tournament_key)) {
		return;
	}
	if (normalize_panel_devicemode(msg?.panel_settings?.devicemode || ws.panel_devicemode) === 'umpire') {
		await send_umpire_current_state(app, ws, tournament_key, msg, {
			send_settings: true,
			send_courts: false,
			reason: options.reason || msg?.type || 'send_current_state',
		});
		return;
	}
	const inputs = await get_effective_display_state_inputs(app, tournament_key, ws, msg);
	const display = {
		client_id: inputs.client_id,
		hostname: inputs.hostname,
		monitor_label: inputs.display_court_displaysetting?.client_id || inputs.client_id,
		court_id: inputs.display_court_displaysetting?.court_id || '',
	};
	let payload;
	if (should_send_multi_state(inputs)) {
		ws.court_id = inputs.court?._id;
		ws.last_v2_match_id = null;
		const tournament_assets_key = tournament_assets_v2(inputs.tournament).logo_assets_version;
		const include_tournament_assets = ws.last_v2_tournament_assets_key !== tournament_assets_key;
		ws.last_v2_tournament_assets_key = tournament_assets_key;
		const multi_inputs = await get_display_multi_state_inputs(app, tournament_key, ws, msg);
		payload = build_display_multi_state_v2(app, {
			tournament: multi_inputs.tournament,
			courts: multi_inputs.courts,
			matches: multi_inputs.matches,
			matches_by_court_id: multi_inputs.matches_by_court_id,
			display,
			display_settings: multi_inputs.display_settings,
			include_tournament_assets,
		});
	} else if (inputs.court) {
		ws.court_id = inputs.court._id;
		const tournament_assets_key = tournament_assets_v2(inputs.tournament).logo_assets_version;
		const include_tournament_assets = ws.last_v2_tournament_assets_key !== tournament_assets_key;
		ws.last_v2_tournament_assets_key = tournament_assets_key;
		ws.last_v2_match_id = inputs.match?.setup?.match_id || inputs.match?._id || null;
		payload = build_display_state_v2(app, {
			tournament: inputs.tournament,
			court: inputs.court,
			match: inputs.match,
			display,
			display_settings: inputs.display_settings,
			include_tournament_assets,
		});
	} else {
		ws.court_id = undefined;
		ws.last_v2_match_id = null;
		const picker_inputs = await get_court_picker_inputs(app, tournament_key, ws, msg);
		payload = build_court_picker_state_v2({
			tournament: picker_inputs.tournament,
			display,
			display_settings: picker_inputs.display_settings,
			courts: picker_inputs.courts,
			matches: picker_inputs.matches,
			client_mode: inputs.panel_devicemode,
		});
	}
	remember_v2_display_payload_shape(ws, payload);
	send_v2_payload(ws, payload);
	schedule_finished_match_refresh(app, ws, tournament_key, payload);
}

async function refresh_client(app, tournament_key, client_id) {
	await reinitialize_client(app, tournament_key, client_id);
}

async function get_client_panel_devicemode(app, client_id, fallback_devicemode) {
	const display_court_displaysetting = await get_display_court_displaysettings(app, client_id);
	let displaysetting = null;
	if (display_court_displaysetting?.displaysetting_id) {
		displaysetting = await find_one_async(app.db.displaysettings, { id: display_court_displaysetting.displaysetting_id });
	}
	return normalize_panel_devicemode(
		displaysetting?.devicemode
		|| display_court_displaysetting?.panel_devicemode
		|| fallback_devicemode
		|| 'display'
	);
}

async function reinitialize_client(app, tournament_key, client_id) {
	const matching_panels = all_panels.filter((ws) => (
		ws
		&& ws.last_tournament_key === tournament_key
		&& determine_client_id(ws) === client_id
	));
	await Promise.all(matching_panels.map(async (ws) => {
		try {
			const panel_devicemode = await get_client_panel_devicemode(app, client_id, ws.panel_devicemode || 'display');
			clear_finished_match_refresh(ws);
			ws.court_id = undefined;
			reset_v2_payload_caches(ws);
			ws.panel_devicemode = panel_devicemode;
			ws.last_umpire_init_signature = null;
			ws.last_umpire_init_ts = 0;
			ws.v2_multi_court_display = false;
			await handle_init(app, ws, {
				tournament_key,
				panel_settings: {
					devicemode: panel_devicemode,
				},
			});
		} catch (err) {
			console.error('[bup v2] reinitialize_client failed', {
				tournament_key,
				client_id,
				err: err && err.message ? err.message : String(err),
			});
		}
	}));
}

async function refresh_tournament(app, tournament_key) {
	const matching_panels = all_panels.filter((ws) => ws && ws.last_tournament_key === tournament_key);
	await Promise.all(matching_panels.map(async (ws) => {
		try {
			await send_current_state(app, ws, tournament_key, null, { reason: 'refresh_tournament' });
		} catch (err) {
			console.error('[bup v2] refresh_tournament failed', {
				tournament_key,
				client_id: ws && ws.client_id ? ws.client_id : null,
				err: err && err.message ? err.message : String(err),
			});
		}
	}));
}

async function get_score_change_court_context(app, tournament_key, court_id) {
	const court = court_id ? await find_one_async(app.db.courts, { tournament_key, _id: court_id }) : null;
	let raw_match = court?.match_id ? await find_one_async(app.db.matches, { tournament_key, _id: court.match_id }) : null;
	if (!raw_match && court_id) {
		raw_match = await get_recent_finished_match_for_court(app, tournament_key, court_id);
	}
	const match = is_match_visible_on_display(app, raw_match) ? raw_match : null;
	return {
		court,
		match,
		current_match_id: match?.setup?.match_id || match?._id || null,
	};
}

async function send_finished_confirmed(_app, tournament_key, court_id, match_id) {
	all_panels.forEach((ws) => {
		if (!ws || ws.readyState !== 1 || ws.last_tournament_key !== tournament_key) {
			return;
		}
		if (ws.court_id !== court_id && ws.court_id !== undefined) {
			return;
		}
		ws.sendmsg({
			type: 'change',
			tournament_key,
			ctype: 'confirm-match-finished',
			val: {
				court_id,
				match_id: match_id ? 'bts_' + match_id : null,
				raw_match_id: match_id || null,
			},
		});
	});
}

function send_error(ws, tournament_key, msg) {
	if (!ws || ws.readyState !== 1) {
		return;
	}
	ws.sendmsg({
		type: 'error',
		tournament_key,
		msg,
	});
}

function handle_command_done(app, ws, msg) {
	debug_tablet_loop(app, 'command_done', {
		client_id: determine_client_id(ws),
		court_id: ws.court_id || null,
		ctype: msg.wait_for_command && msg.wait_for_command.ctype,
		reason: ws.last_umpire_refresh_reason || null,
	});
	admin.notify_change(app, msg.tournament_key, 'display_is_done', {
		ctype: msg.wait_for_command && msg.wait_for_command.ctype,
		val: msg.wait_for_command && msg.wait_for_command.val,
		client_id: determine_client_id(ws),
	});
}

async function async_handle_select_court_assignment(app, ws, msg) {
	const tournament_key = msg.tournament_key || ws.last_tournament_key || default_tournament_key;
	const court_id = msg.court_id;
	if (!court_id || court_id === 'referee') {
		return;
	}
	const court = await find_one_async(app.db.courts, { tournament_key, _id: court_id });
	if (!court) {
		send_error(ws, tournament_key, 'Unknown court ' + court_id);
		return;
	}
	const client_id = determine_client_id(ws);
	await update_display_court_displaysettings(app, client_id, { court_id });
	ws.court_id = court_id;
	await send_umpire_current_state(app, ws, tournament_key, {
		panel_settings: {
			devicemode: 'umpire',
		},
	}, {
		send_settings: true,
		send_courts: true,
		reason: 'select_court_assignment',
	});
	notify_v2_display_status_changed(app, ws, true);
}

async function handle_device_info(app, ws, msg) {
	const tournament_key = msg.tournament_key || ws.last_tournament_key || default_tournament_key;
	const device_info = msg.device;
	if (!device_info) {
		return;
	}
	device_info.client_ip = ws?._socket?.remoteAddress;
	const client_id = determine_client_id_from_ip(device_info.client_ip);
	const hostname = await determine_client_hostname(ws);
	let display_court_displaysetting = await get_display_court_displaysettings(app, client_id);
	if (!display_court_displaysetting) {
		const tournament = await find_one_async(app.db.tournaments, { key: tournament_key });
		display_court_displaysetting = await persist_display_court_displaysettings(app, create_display_court_displaysettings(
			client_id,
			hostname,
			ws.court_id,
			get_default_displaysettings_id(tournament, ws.panel_devicemode),
			ws.panel_devicemode,
		));
	} else if (hostname && display_court_displaysetting.hostname !== hostname) {
		display_court_displaysetting = await update_display_court_displaysettings(app, client_id, { hostname });
	}
	ws.battery = device_info.battery;
	display_court_displaysetting.battery = device_info.battery;
	display_court_displaysetting.online = true;
	admin.notify_change(app, tournament_key, 'display_status_changed', { display_court_displaysetting });
}

async function persist_displaysetting(app, tournament_key, setting) {
	setting._id = undefined;
	return new Promise((resolve, reject) => {
		app.db.displaysettings.insert(setting, (err, inserted) => {
			if (err) {
				reject(err);
				return;
			}
			admin.notify_change(app, tournament_key, 'update_display_setting', { setting: inserted });
			resolve(inserted);
		});
	});
}

async function handle_persist_display_settings(app, ws, msg) {
	const tournament_key = msg.tournament_key || ws.last_tournament_key || default_tournament_key;
	const client_id = determine_client_id(ws);
	const hostname = await determine_client_hostname(ws);
	const panel_devicemode = normalize_panel_devicemode(msg?.panel_settings?.devicemode || ws.panel_devicemode);
	const court_id = msg?.panel_settings?.court_id;
	const setting = {
		...(msg.panel_settings || {}),
		id: `${tournament_key}_${court_id || 'none'}_${real_now_ms(app)}`,
		devicemode: panel_devicemode,
	};
	const inserted_setting = await persist_displaysetting(app, tournament_key, setting);
	let display_court_displaysetting = await get_display_court_displaysettings(app, client_id);
	if (!display_court_displaysetting) {
		display_court_displaysetting = await persist_display_court_displaysettings(app, create_display_court_displaysettings(
			client_id,
			hostname,
			court_id,
			inserted_setting.id,
			panel_devicemode,
		));
	} else {
		display_court_displaysetting = await update_display_court_displaysettings(app, client_id, {
			court_id,
			displaysetting_id: inserted_setting.id,
			panel_devicemode,
			hostname,
		});
	}
	ws.panel_devicemode = panel_devicemode;
	ws.court_id = display_court_displaysetting?.court_id || undefined;
	await send_current_state(app, ws, tournament_key, {
		panel_settings: {
			devicemode: panel_devicemode,
		},
	}, { reason: 'persist_display_settings' });
}

async function handle_reset_display_settings(app, ws, msg) {
	const tournament_key = msg.tournament_key || ws.last_tournament_key || default_tournament_key;
	const client_id = determine_client_id(ws);
	await update_display_court_displaysettings(app, client_id, { client_id: 'deleted' });
	await send_current_state(app, ws, tournament_key, {
		panel_settings: {
			devicemode: ws.panel_devicemode || 'display',
		},
	}, { reason: 'reset_display_settings' });
}

function clear_court_match_reference_after_finish(app, tournament_key, court_q, court, match_id, finish_confirmed, callback) {
	if (!finish_confirmed || !court || court.match_id !== match_id) {
		return callback(null, false);
	}
	app.db.courts.update(
		court_q,
		{ $set: { match_id: null } },
		{ returnUpdatedDocs: true },
		(err, _numAffected, updated_court) => {
			if (err) {
				return callback(err);
			}
			if (updated_court) {
				admin.notify_change(app, tournament_key, 'court_changed', {
					court_id: updated_court._id,
					is_active: updated_court.is_active,
					has_umpire: updated_court.has_umpire,
					has_service_judge: updated_court.has_service_judge,
					match_id: null,
				});
			}
			callback(null, !!updated_court);
		}
	);
}

function stable_json(value) {
	if (value === undefined) {
		return 'null';
	}
	return JSON.stringify(value === undefined ? null : value);
}

function score_update_state_signature(match, score_data, app) {
	const from_match = score_data === undefined;
	const source = from_match ? (match || {}) : (score_data || {});
	const setup = from_match ? (source.setup || {}) : {};
	return stable_json({
		network_score: source.network_score || [],
		network_team1_left: source.network_team1_left ?? null,
		network_team1_serving: source.network_team1_serving ?? null,
		network_teams_player1_even: source.network_teams_player1_even ?? null,
		presses: source.presses || [],
		marks: source.marks || null,
		shuttle_count: source.shuttle_count || null,
		team1_won: source.team1_won ?? null,
		finish_confirmed: from_match
			? (setup.state === 'finished' || setup.now_on_court === false)
			: !!source.finish_confirmed,
		end_ts: from_match
			? (source.end_ts !== undefined ? outgoing_ts(app, source.end_ts) : null)
			: (source.end_ts || null),
	});
}

function score_update_changes_match(match, score_data, app) {
	return score_update_state_signature(match, undefined, app) !== score_update_state_signature(null, score_data, app);
}

function incoming_score_update_signature(score_data) {
	const presses = safe_array(score_data?.presses);
	return stable_json({
		court_id: score_data?.court_id || '',
		match_id: score_data?.match_id || '',
		network_score: score_data?.network_score || [],
		network_team1_left: score_data?.network_team1_left ?? null,
		network_team1_serving: score_data?.network_team1_serving ?? null,
		network_teams_player1_even: score_data?.network_teams_player1_even ?? null,
		team1_won: score_data?.team1_won ?? null,
		finish_confirmed: !!score_data?.finish_confirmed,
		end_ts: score_data?.end_ts || null,
		marks: score_data?.marks || null,
		shuttle_count: score_data?.shuttle_count || null,
		presses,
	});
}

async function handle_score_update(app, ws, msg) {
	return update_queue.instance().execute(update_queue.named('handle_score_update_v2', () => new Promise((resolve) => {
		const match_utils = require('./match_utils');
		const tournament_key = msg.tournament_key || ws.last_tournament_key || default_tournament_key;
		const score_data = msg.score || {};
		const match_id = score_data.match_id;
		let finished = false;
		let timeout = null;
		const finish = (err) => {
			if (finished) {
				return;
			}
			finished = true;
			if (timeout) {
				clearTimeout(timeout);
			}
			if (err) {
				send_error(ws, tournament_key, err.message || String(err));
			}
			resolve();
		};
		timeout = setTimeout(() => {
			finish(new Error('handle_score_update timeout'));
		}, 5000);

		if (score_update_rejected_by_owner(app, tournament_key, ws, score_data)) {
			return finish();
		}

		const incoming_signature = incoming_score_update_signature(score_data);
		if (ws.last_umpire_score_update_signature === incoming_signature) {
			const device_info = score_data.device;
			const now = Date.now();
			if (!device_info || (ws.last_umpire_device_info_ts && now - ws.last_umpire_device_info_ts < 30000)) {
				return finish();
			}
			ws.last_umpire_device_info_ts = now;
			handle_device_info(app, ws, { tournament_key, device: device_info })
				.then(() => finish())
				.catch(finish);
			return;
		}
		ws.last_umpire_score_update_signature = incoming_signature;

		(async () => {
			const [match, tournament, court] = await Promise.all([
				match_utils.fetch_match(app, tournament_key, match_id),
				find_one_async(app.db.tournaments, { key: tournament_key }),
				find_one_async(app.db.courts, { tournament_key, _id: score_data.court_id }),
			]);
			if (score_update_opens_match(score_data)) {
				claim_umpire_match_owner(app, tournament_key, ws, score_data);
			}
			const finish_confirmed = !!score_data.finish_confirmed;
			const allow_finished_confirmation = finish_confirmed && score_data.team1_won !== undefined && score_data.team1_won !== null;
			if (match == null || (match.setup.now_on_court === false && !allow_finished_confirmation)) {
				send_error(ws, tournament_key, 'Match not found or not on court actualy.');
				return finish();
			}
			if (!court) {
				send_error(ws, tournament_key, 'Court for score update not found.');
				return finish();
			}
			if (ws.court_id && score_data.court_id && ws.court_id !== score_data.court_id) {
				send_error(ws, tournament_key, 'Score update rejected: panel is assigned to a different court.');
				return finish();
			}
			if (match.setup && match.setup.court_id && score_data.court_id && match.setup.court_id !== score_data.court_id) {
				send_error(ws, tournament_key, 'Score update rejected: match is assigned to a different court.');
				return finish();
			}
			const expected_match_for_court =
				court.match_id === match_id ||
				(!court.match_id && match.setup && match.setup.court_id === score_data.court_id && match.setup.now_on_court === true);
			if (!expected_match_for_court) {
				send_error(ws, tournament_key, 'Score update rejected: stale panel state for this court.');
				return finish();
			}
			if (!score_update_changes_match(match, score_data, app)) {
				const device_info = score_data.device;
				if (!device_info) {
					return finish();
				}
				handle_device_info(app, ws, { tournament_key, device: device_info })
					.then(() => finish())
					.catch(finish);
				return;
			}

			const update = {
				network_score: score_data.network_score,
				network_team1_left: score_data.network_team1_left,
				network_team1_serving: score_data.network_team1_serving,
				network_teams_player1_even: score_data.network_teams_player1_even,
				presses: score_data.presses,
				duration_ms: score_data.duration_ms,
				end_ts: incoming_ts(app, score_data.end_ts),
				'setup.now_on_court': true,
				'setup.state': 'oncourt',
			};
			const device_info = score_data.device;
			if (device_info) {
				device_info.client_ip = ws?._socket?.remoteAddress;
			}
			if (finish_confirmed) {
				const score_status = score_status_from_score_update(score_data);
				update['setup.now_on_court'] = false;
				update['setup.state'] = 'finished';
				update.team1_won = score_data.team1_won;
				update.btp_winner = update.team1_won === true ? 1 : 2;
				update.btp_needsync = true;
				update.score_status = score_status;
				update.forward_loser = score_status === 'retired' || score_status === 'disqualified';
				if (update.forward_loser) {
					update.score_status_network_score = reached_score_from_score_update(match, score_data) || score_data.score_status_network_score || score_data.network_score;
				}
			}
			if (score_data.shuttle_count) {
				update.shuttle_count = score_data.shuttle_count;
			}
			const score_indicates_finished = !!score_data.end_ts || typeof score_data.team1_won === 'boolean';

			const simulated_match = {
				...match,
				network_score: update.network_score,
				team1_won: update.team1_won,
				setup: {
					...match.setup,
					now_on_court: update['setup.now_on_court'],
					state: update['setup.state'],
				},
			};
			const preparation_successor_state = match_automation.calculate_preparation_successor_state(simulated_match, tournament, {
				now_ts: now_ms(app),
			});
			update['setup.needs_preparation_successor'] = preparation_successor_state.needs_preparation_successor;
			update['setup.needs_preparation_successor_ts'] = preparation_successor_state.needs_preparation_successor_ts;

			const match_query = { _id: match_id, tournament_key };
			const court_q = { tournament_key, _id: score_data.court_id };
			const db = app.db;
			async.waterfall([
				(cb) => {
					db.matches.update(match_query, { $set: update }, { returnUpdatedDocs: true }, (err, _numAffected, updated_match) => cb(err, updated_match));
				},
				(updated_match, cb) => {
					if (updated_match) {
						handle_score_change(app, tournament_key, updated_match.setup.court_id, {
							skip_umpire_ws: score_indicates_finished ? null : ws,
						});
						admin.notify_change(app, tournament_key, 'score', {
							match_id,
							network_score: update.network_score,
							team1_won: update.team1_won,
							shuttle_count: update.shuttle_count,
							score_status: update.score_status,
							forward_loser: update.forward_loser,
							score_status_network_score: update.score_status_network_score,
							presses: updated_match.presses,
							end_ts: updated_match.end_ts,
							court_id: updated_match.setup && updated_match.setup.court_id,
							now_on_court: updated_match.setup && updated_match.setup.now_on_court,
						});
					}
					cb(null, updated_match);
				},
				(updated_match, cb) => {
					if (updated_match && finish_confirmed) {
						btp_manager.update_score(app, updated_match);
						match_utils.reset_player_tabletoperator(app, tournament_key, match_id, update.end_ts)
							.then(() => cb(null, updated_match))
							.catch(cb);
						return;
					}
					cb(null, updated_match);
				},
				(updated_match, cb) => cb(null, updated_match, court),
				(updated_match, current_court, cb) => {
					if (!current_court) {
						return cb(new Error('Cannot find court ' + JSON.stringify(score_data.court_id)));
					}
					cb(null, updated_match, current_court, true);
				},
				(updated_match, current_court, changed_court, cb) => {
					if (updated_match && changed_court) {
						admin.notify_change(app, tournament_key, 'court_current_match', {
							match__id: match_id,
							match: updated_match,
						});
					}
					cb(null, updated_match, changed_court);
				},
				(updated_match, changed_court, cb) => {
					if (updated_match && updated_match.setup.highlight === 6 && updated_match.network_score && updated_match.network_score.length > 0) {
						updated_match.setup.highlight = 0;
						if (match_utils.normalize_preparation_state) {
							match_utils.normalize_preparation_state(updated_match.setup);
						}
						btp_manager.update_highlight(app, updated_match);
					}
					cb(null, updated_match, changed_court);
				},
				(updated_match, changed_court, cb) => {
					if (changed_court) {
						ticker_manager.pushall(app, tournament_key);
					} else if (updated_match) {
						ticker_manager.update_score(app, updated_match);
					}
					cb(null, updated_match, changed_court);
				},
				(updated_match, changed_court, cb) => {
					clear_court_match_reference_after_finish(app, tournament_key, court_q, court, match_id, finish_confirmed, (err) => {
						cb(err, updated_match, changed_court);
					});
				},
				(updated_match, changed_court, cb) => {
					if (!updated_match) {
						return cb(new Error('Cannot find match ' + JSON.stringify(updated_match)));
					}
					match_utils.auto_execute_preparation_selection_for_setup(app, tournament, updated_match.setup, (err) => {
						cb(err, updated_match, changed_court);
					});
				},
				(updated_match, changed_court, cb) => {
					if (!finish_confirmed || !score_data.court_id) {
						return cb(null, updated_match, changed_court);
					}
					match_utils.call_preparation_match_on_court(app, tournament_key, score_data.court_id)
						.then(() => cb(null, updated_match, changed_court))
						.catch((err) => {
							const message = err && (err.message || String(err));
							if (/No match found to call on court/.test(message)) {
								return cb(null, updated_match, changed_court);
							}
							return cb(err);
						});
				},
				(updated_match, changed_court, cb) => {
					if (!device_info) {
						return cb(null, updated_match, changed_court);
					}
					handle_device_info(app, ws, { tournament_key, device: device_info })
						.then(() => cb(null, updated_match, changed_court))
						.catch(cb);
				},
			], finish);
		})().catch(finish);
	})));
}

async function handle_score_change(app, tournament_key, court_id, options = {}) {
	const matching_panels = all_panels.filter((ws) => ws && ws.last_tournament_key === tournament_key);
	const tournament = await find_one_async(app.db.tournaments, { key: tournament_key });
	const panels_by_court = new Map();
	const multi_panels = [];
	const direct_refreshes = [];
	debug_tablet_loop(app, 'handle_score_change:start', {
		tournament_key,
		court_id: court_id || null,
		panel_count: matching_panels.length,
		skip_umpire_client_id: options.skip_umpire_ws ? determine_client_id(options.skip_umpire_ws) : null,
	});

	for (const ws of matching_panels) {
		try {
			if (ws.panel_devicemode === 'umpire') {
				if (options.skip_umpire_ws && options.skip_umpire_ws === ws) {
					debug_tablet_loop(app, 'handle_score_change:skip-origin-umpire', {
						client_id: determine_client_id(ws),
						court_id: ws.court_id || null,
						change_court_id: court_id || null,
					});
					continue;
				}
				if (!court_id) {
					// V1 emits global all-match score updates in addition to court-scoped
					// updates. Umpire tablets need full presses, but not duplicate refreshes
					// for global fan-out events unrelated to their court.
					debug_tablet_loop(app, 'handle_score_change:skip-global-umpire', {
						client_id: determine_client_id(ws),
						court_id: ws.court_id || null,
					});
					continue;
				}
				if (ws.court_id && ws.court_id !== court_id) {
					debug_tablet_loop(app, 'handle_score_change:skip-other-court-umpire', {
						client_id: determine_client_id(ws),
						court_id: ws.court_id || null,
						change_court_id: court_id,
					});
					continue;
				}
				debug_tablet_loop(app, 'handle_score_change:queue-umpire-refresh', {
					client_id: determine_client_id(ws),
					court_id: ws.court_id || null,
					change_court_id: court_id,
				});
				direct_refreshes.push(send_umpire_current_state(app, ws, tournament_key, {
					panel_settings: {
						devicemode: 'umpire',
					},
				}, {
					send_settings: false,
					send_courts: false,
					reason: 'handle_score_change:' + (court_id || 'global'),
				}).catch((err) => {
					console.error('[bup v2] handle_score_change umpire refresh failed', {
						tournament_key,
						client_id: ws && ws.client_id ? ws.client_id : null,
						err: err && err.message ? err.message : String(err),
					});
				}));
				continue;
			}
			if (ws.v2_multi_court_display) {
				if (court_id) {
					multi_panels.push(ws);
				} else {
					direct_refreshes.push(send_current_state(app, ws, tournament_key).catch((err) => {
						console.error('[bup v2] handle_score_change multi refresh failed', {
							tournament_key,
							client_id: ws && ws.client_id ? ws.client_id : null,
							err: err && err.message ? err.message : String(err),
						});
					}));
				}
				continue;
			}
			if (ws.court_id && court_id && ws.court_id !== court_id) {
				continue;
			}
			remember_v2_tournament_settings(ws, tournament);
			if (!ws.court_id) {
				direct_refreshes.push(send_current_state(app, ws, tournament_key).catch((err) => {
					console.error('[bup v2] handle_score_change direct refresh failed', {
						tournament_key,
						client_id: ws && ws.client_id ? ws.client_id : null,
						err: err && err.message ? err.message : String(err),
					});
				}));
				continue;
			}
			if (!panels_by_court.has(ws.court_id)) {
				panels_by_court.set(ws.court_id, []);
			}
			panels_by_court.get(ws.court_id).push(ws);
		} catch (err) {
			console.error('[bup v2] handle_score_change grouping failed', {
				tournament_key,
				court_id: court_id || null,
				client_id: ws && ws.client_id ? ws.client_id : null,
				err: err && err.message ? err.message : String(err),
			});
		}
	}

	await Promise.all(direct_refreshes);

	if (court_id && multi_panels.length > 0) {
		try {
			const context = await get_score_change_court_context(app, tournament_key, court_id);
			if (!context.court || !context.match || !context.current_match_id) {
				await Promise.all(multi_panels.map((ws) => send_current_state(app, ws, tournament_key)));
			} else {
				const updates = build_display_incremental_updates_v2(app, {
					court: context.court,
					match: context.match,
				});
				await Promise.all(multi_panels.map(async (ws) => {
					const last_match_id = ws.last_v2_match_ids_by_court instanceof Map
						? ws.last_v2_match_ids_by_court.get(court_id)
						: undefined;
					if (SCORE_UPDATE_FULL_STATE_FALLBACK || last_match_id !== context.current_match_id) {
						if (log_v2_sends_enabled(ws)) {
							console.log('[bup v2] multi score_update full_state_fallback', {
								ts: Date.now(),
								client_id: ws && ws.client_id ? ws.client_id : null,
								court_id: court_id || null,
								last_match_id,
								current_match_id: context.current_match_id,
							});
						}
						await send_current_state(app, ws, tournament_key);
						return;
					}
					if (ws.last_v2_match_ids_by_court instanceof Map) {
						ws.last_v2_match_ids_by_court.set(court_id, context.current_match_id);
					}
					send_v2_incremental_updates(ws, updates, app, tournament_key);
				}));
			}
		} catch (err) {
			console.error('[bup v2] handle_score_change multi failed', {
				tournament_key,
				court_id: court_id || null,
				err: err && err.message ? err.message : String(err),
			});
		}
	}

	await Promise.all(Array.from(panels_by_court.entries()).map(async ([group_court_id, panels]) => {
		try {
			const context = await get_score_change_court_context(app, tournament_key, group_court_id);
			if (!context.court || !context.match || !context.current_match_id) {
				await Promise.all(panels.map((ws) => send_current_state(app, ws, tournament_key)));
				return;
			}
			const updates = build_display_incremental_updates_v2(app, {
				court: context.court,
				match: context.match,
			});
			await Promise.all(panels.map(async (ws) => {
				if (SCORE_UPDATE_FULL_STATE_FALLBACK || ws.last_v2_match_id !== context.current_match_id) {
					if (log_v2_sends_enabled(ws)) {
						console.log('[bup v2] score_update full_state_fallback', {
							ts: Date.now(),
							client_id: ws && ws.client_id ? ws.client_id : null,
							court_id: group_court_id || null,
							last_match_id: ws ? ws.last_v2_match_id : null,
							current_match_id: context.current_match_id,
						});
					}
					await send_current_state(app, ws, tournament_key);
					return;
				}
				ws.last_v2_match_id = context.current_match_id;
				send_v2_incremental_updates(ws, updates, app, tournament_key);
			}));
		} catch (err) {
			console.error('[bup v2] handle_score_change failed', {
				tournament_key,
				court_id: group_court_id || null,
				err: err && err.message ? err.message : String(err),
			});
		}
	}));
}

async function add_display_status(app, tournament, displays) {
	const tournament_key = tournament?.key || default_tournament_key;
	for (const panel_ws of all_panels) {
		if (panel_ws.last_tournament_key && panel_ws.last_tournament_key !== tournament_key) {
			continue;
		}
		const ws_client_id = determine_client_id(panel_ws);
		let display = displays.find((d) => d.client_id == ws_client_id);
		if (!display) {
			display = {
				client_id: ws_client_id,
				hostname: await determine_client_hostname(panel_ws),
				court_id: panel_ws.court_id || '',
				displaysetting_id: get_default_displaysettings_id(tournament, panel_ws.panel_devicemode),
				panel_devicemode: panel_ws.panel_devicemode || 'display',
			};
			displays.push(display);
		}
		display.online = true;
		display.hostname = await determine_client_hostname(panel_ws);
		display.display_render_stats = get_v2_render_stats(panel_ws);
	}
}

module.exports = {
	on_connect,
	on_close,
	handle_command_done,
	handle_display_rendered,
	handle_device_info,
	handle_init,
	handle_match_opened,
	handle_persist_display_settings,
	handle_reset_display_settings,
	handle_score_update,
	async_handle_select_court_assignment,
	send_current_state,
	refresh_client,
	reinitialize_client,
	refresh_tournament,
	send_finished_confirmed,
	handle_score_change,
	add_display_status,
	build_display_state_v2,
	build_display_score_update_v2,
	build_display_points_update_v2,
	build_display_timer_update_v2,
	build_display_multi_state_v2,
	build_court_picker_state_v2,
	is_multi_court_display_style,
	is_fieldless_multi_court_display_style,
	MULTI_COURT_ASSIGNMENT_ID,
};
