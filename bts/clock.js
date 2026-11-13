'use strict';

const CLOCK_SETTING_ID = 'global_clock';

const DEFAULT_STATE = Object.freeze({
	mode: 'real',
	fixed_ts: null,
	offset_ms: 0,
	updated_ts: null,
});

function normalize_number(value, fallback = null) {
	const normalized = Number(value);
	return Number.isFinite(normalized) ? normalized : fallback;
}

function normalize_state(state) {
	const raw = state || {};
	const mode = ['real', 'fixed', 'offset'].includes(raw.mode) ? raw.mode : DEFAULT_STATE.mode;
	const fixed_ts = normalize_number(raw.fixed_ts, null);
	const offset_ms = normalize_number(raw.offset_ms, 0);
	const updated_ts = normalize_number(raw.updated_ts, null);
	return {
		mode,
		fixed_ts: mode === 'fixed' ? fixed_ts : null,
		offset_ms: mode === 'offset' ? offset_ms : 0,
		updated_ts,
	};
}

function create_service(db, persisted_state) {
	let state = normalize_state(persisted_state);
	const listeners = new Set();

	function real_now_ms() {
		return Date.now();
	}

	function effective_now_ms() {
		if (state.mode === 'fixed' && Number.isFinite(state.fixed_ts)) {
			return state.fixed_ts;
		}
		if (state.mode === 'offset') {
			return real_now_ms() + state.offset_ms;
		}
		return real_now_ms();
	}

	function normalize_ts(value) {
		const normalized = Number(value);
		return Number.isFinite(normalized) ? normalized : null;
	}

	function effective_delta_ms() {
		return effective_now_ms() - real_now_ms();
	}

	function to_real_ts(value) {
		const normalized = normalize_ts(value);
		if (normalized == null) {
			return value;
		}
		return normalized - effective_delta_ms();
	}

	function to_effective_ts(value) {
		const normalized = normalize_ts(value);
		if (normalized == null) {
			return value;
		}
		return normalized + effective_delta_ms();
	}

	async function persist(next_state) {
		const normalized = normalize_state({
			...next_state,
			updated_ts: real_now_ms(),
		});
		await db.app_settings.update_async(
			{ _id: CLOCK_SETTING_ID },
			{ $set: { ...normalized, _id: CLOCK_SETTING_ID } },
			{ upsert: true }
		);
		state = normalized;
		for (const listener of listeners) {
			try { listener(); } catch (error) { console.error('[bts] clock observer failed:', error.message); } // eslint-disable-line no-console
		}
		return get_state();
	}

	function get_state() {
		return {
			mode: state.mode,
			fixed_ts: state.fixed_ts,
			offset_ms: state.offset_ms,
			updated_ts: state.updated_ts,
			effective_now_ms: effective_now_ms(),
			real_now_ms: real_now_ms(),
		};
	}

	return {
		subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
		now_ms: effective_now_ms,
		now_date: () => new Date(effective_now_ms()),
		real_now_ms,
		to_real_ts,
		to_effective_ts,
		get_state,
		describe: () => JSON.stringify(get_state()),
		set_real: () => persist({ mode: 'real', fixed_ts: null, offset_ms: 0 }),
		set_fixed: (fixed_ts) => persist({ mode: 'fixed', fixed_ts, offset_ms: 0 }),
		set_offset: (offset_ms) => persist({ mode: 'offset', fixed_ts: null, offset_ms }),
		set_offset_target: (target_ts) => {
			const normalized_target_ts = normalize_ts(target_ts);
			if (normalized_target_ts == null) {
				throw new Error('Invalid target_ts');
			}
			return persist({
				mode: 'offset',
				fixed_ts: null,
				offset_ms: normalized_target_ts - real_now_ms(),
			});
		},
	};
}

async function init(app) {
	const existing = await app.db.app_settings.findOne_async({ _id: CLOCK_SETTING_ID });
	app.clock = create_service(app.db, existing || DEFAULT_STATE);
	return app.clock;
}

module.exports = {
	init,
	CLOCK_SETTING_ID,
	DEFAULT_STATE,
};
