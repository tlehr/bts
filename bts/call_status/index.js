'use strict';

const { randomUUID } = require('crypto');
const inputs = require('./inputs'), deadline = require('./deadlines'), project = require('./project');
const foreground = require('../foreground_work');
const calculator = require('./calculator');
const collections = ['tournaments', 'locations', 'courts', 'matches', 'umpires', 'tabletoperators'];
const services = new WeakMap();
function clock_key(clock) { return JSON.stringify(clock && !clock.get_state ? {mode:'custom'} : require('../btp_planner/clock').snapshot(clock)); }
function freeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child);Object.freeze(value); }
	return value;
}
class CallStatus {
	constructor(app, options = {}) {
		this.app = app;this.entries = new Map();this.generations = new Map();this.watchers = new Map();this.timers = new Map();this.scheduled = new Set();
		this.epoch = randomUUID();this.sequence = 0;this.closed = false;
		this.publish = options.publish || ((key, value) => require('../admin').notify_change(app, key, 'call_status_changed', value));
		this.unsubscribe = require('../tournament_model').attach(app.db).subscribe((name, before, after) => {
			if (!inputs.changed(name, before, after)) return;
			const field = name === 'tournaments' ? 'key' : 'tournament_key';
			for (const key of new Set([before?.[field], after?.[field]])) if (key != null) this.invalidate(key);
		});
		this.sync_clock();
	}
	now() { return this.app.clock?.now_ms() ?? Date.now(); }
	sync_clock() {
		if (this.clock === this.app.clock) return;
		this.unclock?.();this.clock = this.app.clock;
		this.unclock = this.clock?.subscribe?.(() => { for (const key of this.entries.keys()) this.invalidate(key); });
	}
	invalidate(key) {
		this.generations.set(key, (this.generations.get(key) || 0) + 1);
		this.schedule(key);
	}
	schedule(key) {
		if (this.closed || !this.watchers.get(key)?.size || this.scheduled.has(key)) return;
		this.scheduled.add(key);
		foreground.run(null, () => setImmediate(() => {
			this.scheduled.delete(key);if (this.closed || !this.watchers.get(key)?.size) return;
			this.snapshot(key).catch(error => {
				console.error('[bts] call status refresh failed:', error.message); // eslint-disable-line no-console
				if (this.closed || !this.watchers.get(key)?.size) return;
				// A transient read failure must not permanently lose a time-triggered
				// update. A successful read or the last disconnect cancels this.
				clearTimeout(this.timers.get(key));
				const retry = setTimeout(() => { this.timers.delete(key);this.schedule(key); }, 1000);
				retry.unref?.();this.timers.set(key, retry);
			});
		}));
	}
	watch(key, owner) {
		let watchers = this.watchers.get(key);if (!watchers) this.watchers.set(key, watchers = new Set());
		watchers.add(owner);this.arm(key);
		const value = this.entries.get(key)?.value, now = this.now();
		if (!value || !value.detailed || value.generation !== (this.generations.get(key) || 0) || now < value.now || now >= value.until) this.schedule(key);
	}
	unwatch(owner) {
		for (const [key, watchers] of this.watchers) if (watchers.delete(owner) && !watchers.size) {
			this.watchers.delete(key);clearTimeout(this.timers.get(key));this.timers.delete(key);
		}
	}
	arm(key) {
		clearTimeout(this.timers.get(key));this.timers.delete(key);
		const entry = this.entries.get(key)?.value;
		if (this.closed || !this.watchers.get(key)?.size || !entry || !Number.isFinite(entry.until) || this.app.clock?.get_state?.().mode === 'fixed') return;
		const delay = Math.max(1, Math.min(2147483647, entry.until - this.now()));
		const timer = foreground.run(null, () => setTimeout(() => { this.timers.delete(key);this.schedule(key); }, delay));
		timer.unref?.();this.timers.set(key, timer);
	}
	async entry(key, options = {}) {
		this.sync_clock();
		for (;;) {
			if (this.closed) throw new Error('Aufrufstatus wurde beendet.');
			await foreground.background_idle();
			const generation = this.generations.get(key) || 0;
			const values = await require('../preparation_selection/selection_reads')(this.app, key, null, options.preparation_timing, true);
			await foreground.background_idle();
			if (generation !== (this.generations.get(key) || 0)) continue;
			const state = Object.fromEntries(collections.map(name => [name, name === 'tournaments' ? (values[name] ? [values[name]] : []) : values[name] || []]));
			const now = options.now_ts ?? this.now(), clock = clock_key(this.app.clock);
			let holder = this.entries.get(key);
			if (!holder) {
				if (this.entries.size >= 32) for (const [unused, entry] of this.entries) {
					if (!this.watchers.get(unused)?.size && !entry.pending.size) { this.entries.delete(unused);break; }
				}
				this.entries.set(key, holder = {pending:new Map()});
			}
			const detailed = options.detailed !== false || !!this.watchers.get(key)?.size;
			const old = holder.value;
			const same = old && old.clock === clock && now >= old.now && now < old.until && inputs.unchanged(state, old.inputs);
			if (options.cache !== false && same && (!detailed || old.detailed)) { old.generation = generation;this.arm(key);return old; }
			// An owning foreground operation must not await background work which
			// is itself waiting for that operation to release priority.
			const owner = foreground.busy() && !foreground.background_busy() ? foreground.capture() : null;
			if (holder.pending.has(owner)) { await holder.pending.get(owner);continue; }
			const input = { ...(values.tournaments || {}), ...Object.fromEntries(collections.filter(name => name !== 'tournaments').map(name => [name, state[name]])) };
			const calculate = async () => {
				const done = options.preparation_timing?.step('candidate_calculation', {synchronous:false, shared:true, matches:input.matches.length});
				let selections, failure;
				try {
					selections = await calculator.calculate(input, {
						now_ts:now, app:this.app, cooperative:true, automatic_only:!detailed,
						base_selections:same && !old.detailed ? new Map(old.raw.map(row => [row.location_id,row])) : undefined,
					},old?.raw);
				} catch (error) { failure = error; throw error; } finally { done?.(failure); }
				if (this.closed) throw new Error('Aufrufstatus wurde beendet.');
				if (generation !== (this.generations.get(key) || 0) || clock !== clock_key(this.app.clock)) return null;
				const until = deadline(input, now);
				const completed = options.now_ts ?? this.now();
				if (completed < now || completed >= until) return null;
				// A foreground owner can finish while an older background calculation
				// waits for its priority. Never publish that older answer over it.
				if (holder.value !== old && holder.value?.detailed >= detailed && holder.value.now >= now &&
					holder.value.clock === clock && inputs.unchanged(state, holder.value.inputs)) return holder.value;
				const projected = await project(selections, old?.rows);
				if (generation !== (this.generations.get(key) || 0) || clock !== clock_key(this.app.clock) ||
					(options.now_ts ?? this.now()) >= until) return null;
				if (holder.value !== old && holder.value?.detailed >= detailed && holder.value.now >= now &&
					holder.value.clock === clock && inputs.unchanged(state, holder.value.inputs)) return holder.value;
				const rows = freeze(require('../admin_response/selection_cache').certify(projected));
				const value = {raw:selections, rows, now, until, clock, detailed, generation, inputs:inputs.capture(state),
					view:freeze({selections:rows, call_status:{epoch:this.epoch, revision:++this.sequence, evaluated_at:now, valid_until:Number.isFinite(until) ? until : null}})};
				if (options.cache !== false) {
					holder.value = value;this.arm(key);
					if (this.watchers.get(key)?.size) this.publish(key, value.view);
				}
				return value;
			};
			const pending = calculate();holder.pending.set(owner,pending);
			let value;
			try { value = await pending; } finally { if (holder.pending.get(owner) === pending) holder.pending.delete(owner); }
			if (value) return value;
		}
	}
	async snapshot(key, options) { return (await this.entry(key,options)).view; }
	async selection(key, location_id, options = {}) {
		const entry = await this.entry(key,{...options,detailed:options.automatic_only !== true});
		const selection = entry.raw.find(row => row.location_id === location_id);
		// Public callers historically own detached, mutable query results.
		return selection && options.automatic_only === true ? selection : selection ? require('nedb/lib/model').deepCopy(selection) : null;
	}
	close() {
		this.closed = true;this.unsubscribe();this.unclock?.();for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();this.watchers.clear();this.entries.clear();
	}
}
function get(app) { let service = services.get(app);if (!service || service.closed) { service = new CallStatus(app);services.set(app,service); }return service; }
get.CallStatus = CallStatus;
get.close = app => services.get(app)?.close();
get.release = (app,owner) => services.get(app)?.unwatch(owner);
module.exports = get;
