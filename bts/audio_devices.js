'use strict';

const instances = new WeakMap();
const valid_id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);

function create(app) {
	const clients = new Map(), states = new Map();
	let pending = Promise.resolve();
	function serial(work) {
		const result = pending.then(work);pending = result.catch(() => {});return result;
	}
	async function load(key) {
		if (!valid_id(key)) throw new Error('Invalid tournament key');
		if (!await app.db.tournaments.findOne_async({key})) throw new Error('Tournament not found');
		if (!states.has(key)) {
			const records = await app.db.app_settings.find_async({kind: 'announcement_audio_device', tournament_key: key});
			states.set(key, {revision: 0, records: new Map(records.map(record => [record.device_id, record]))});
		}
		return states.get(key);
	}
	function snapshot(key) {
		const state = states.get(key);
		return {tournament_key: key, revision: state.revision, devices: [...state.records.values()].map(record => {
			const pages = [...clients.values()].filter(client => client.key === key && client.id === record.device_id);
			return {id: record.device_id, label: record.label, address: pages[0]?.address || record.address,
				online: pages.length > 0, pages: pages.length, settings: structuredClone(record.settings)};
		})};
	}
	function broadcast(key) {
		if (!states.has(key)) return;
		states.get(key).revision++;
		const message = {type: 'audio_devices', ...snapshot(key)};
		for (const [ws, client] of clients) if (client.key === key) {
			try { if (ws.readyState === undefined || ws.readyState === 1) ws.sendmsg(message); } catch (_) { /* Close handling removes the page. */ }
		}
	}
	async function persist(record) {
		await app.db.app_settings.update_async({_id: record._id}, {$set: record}, {upsert: true});
	}
	return {
		register(ws, message) { return serial(async () => {
			const key = message.tournament_key, id = message.device_id;
			if (!valid_id(id)) throw new Error('Invalid audio device');
			const state = await load(key), previous = state.records.get(id);
			const locations = await app.db.locations.find_async({tournament_key: key});
			const initial = message.settings || {};
			const settings = previous?.settings || {
				free: initial.free === true,
				locations: locations.map(location => {
					const value = Array.isArray(initial.locations) && initial.locations.find(row => row?.id === location._id);
					return {id: location._id, calls: value?.calls === true, preparations: value?.preparations === true};
				}),
			};
			const address = String(ws._socket?.remoteAddress || '').replace(/^::ffff:/i, '').slice(0, 150);
			const record = {...previous, _id: 'announcement-audio:' + key + ':' + id,
				kind: 'announcement_audio_device', tournament_key: key, device_id: id,
				label: previous?.label || String(message.label || 'BTS-Browser').slice(0, 100), address, settings};
			await persist(record);
			if (ws.readyState !== undefined && ws.readyState !== 1) throw new Error('Audio device disconnected');
			const old_key = clients.get(ws)?.key;
			state.records.set(id, record);clients.set(ws, {key, id, address});
			if (old_key && old_key !== key) broadcast(old_key);
			broadcast(key);
			return snapshot(key);
		}); },
		edit(message) { return serial(async () => {
			const key = message.tournament_key, id = message.device_id, change = message.change;
			if (!valid_id(id) || !change || !['calls', 'preparations', 'free'].includes(change.kind) || typeof change.value !== 'boolean') throw new Error('Invalid audio setting');
			const state = await load(key), previous = state.records.get(id);
			if (!previous) throw new Error('Audio device not found');
			const record = structuredClone(previous);
			if (change.kind === 'free') record.settings.free = change.value;
			else {
				const location = await app.db.locations.findOne_async({_id: change.location_id, tournament_key: key});
				if (!location) throw new Error('Location not found');
				let row = record.settings.locations.find(value => value.id === location._id);
				if (!row) { row = {id: location._id, calls: false, preparations: false};record.settings.locations.push(row); }
				row[change.kind] = change.value;
			}
			await persist(record);state.records.set(id, record);broadcast(key);return snapshot(key);
		}); },
		release(ws) {
			const key = clients.get(ws)?.key;clients.delete(ws);if (key) broadcast(key);
		},
	};
}

module.exports = app => {
	if (!instances.has(app)) instances.set(app, create(app));
	return instances.get(app);
};
module.exports.release = (app, ws) => instances.get(app)?.release(ws);
