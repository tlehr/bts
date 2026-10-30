'use strict';

// Disposable replica for the real server/browser benchmark. Never opens the
// source NeDB files and never starts BTP, ticker or external speech connections.
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const snapshot = require('./isolated_sync/snapshot');

function documents(contents) {
	const records = new Map();
	for (const line of contents.split('\n').filter(Boolean)) {
		const record = JSON.parse(line);
		if (record.$$deleted) records.delete(record._id);
		else if (record._id) records.set(record._id, record);
	}
	return [...records.values()];
}

async function prepare(source = path.resolve(__dirname, '..'), source_key = 'default') {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-admin-latency-lab-'));
	const captured = await snapshot.capture(path.join(source, 'data'), directory);
	const key = 'under500lab', root = path.join(directory, 'baseline');
	await fs.mkdir(root);
	for (const name of ['bts', 'static']) await fs.cp(path.join(source, name), path.join(root, name), { recursive: true });
	await fs.symlink(path.join(source, 'node_modules'), path.join(root, 'node_modules'), 'dir');
	await fs.mkdir(path.join(directory, 'seed'));
	const counts = {};
	for (const name of snapshot.tables) {
		let rows = documents(await fs.readFile(path.join(captured.directory, name), 'utf8'));
		rows = rows.filter(row => name === 'tournaments' ? row.key === source_key :
			name === 'app_settings' ? row._id === 'global_clock' : row.tournament_key === source_key);
		for (const row of rows) {
			if (name === 'tournaments') {
				row.key = key;row.btp_enabled = false;row.ticker_enabled = false;
				delete row.btp_password;delete row.ticker_password;
				row.announcement_speech_mode = 'browser';row.bts_client_performance_debug_enabled = false;
			} else if (name === 'app_settings') Object.assign(row, { mode: 'real', fixed_ts: null, offset_ms: 0 });
			else row.tournament_key = key;
		}
		counts[name] = rows.length;
		await fs.writeFile(path.join(directory, 'seed', name), rows.length ? rows.map(row => JSON.stringify(row)).join('\n') + '\n' : '');
	}
	await fs.cp(path.join(directory, 'seed'), path.join(root, 'data'), { recursive: true });
	const config = { host: '127.0.0.1', port: 45433, enable_https: false, report_errors: false,
		bup_location: path.join(root, 'static/bup/dev'), bup_index: 'index.html', speech: { enabled: false, worker: false } };
	await fs.writeFile(path.join(root, 'config.json'), JSON.stringify(config, null, 2));
	await snapshot.unchanged(captured);
	const code_sha256 = {};
	for (const name of ['static/js/cleitstand.js', 'static/js/cmatch.js', 'static/js/ctournament.js', 'static/js/conn.js', 'static/js/admin_update_observer.js', 'static/css/leitstand.css']) {
		code_sha256[name] = crypto.createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex');
	}
	assert(path.resolve(root).startsWith(os.tmpdir() + path.sep));
	const manifest = { directory, root, source, source_key, key, base_url: 'http://127.0.0.1:45433', captured, counts, code_sha256,
		isolation: { separate_data_directory: true, source_opened_by_nedb: false, btp_enabled: false, ticker_enabled: false, speech_enabled: false } };
	await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
	await fs.writeFile('/tmp/bts-under500-lab-path.txt', directory + '\n');
	return manifest;
}

async function variant(name) {
	assert(/^[a-z0-9-]+$/.test(name), 'Use a simple variant name');
	const previous = JSON.parse(await fs.readFile('/tmp/bts-under500-lab-prepare.json', 'utf8'));
	const directory = previous.directory, root = path.join(directory, name);
	assert(directory.startsWith(path.join(os.tmpdir(), 'bts-admin-latency-lab-')));
	await fs.mkdir(root);
	for (const folder of ['bts', 'static']) await fs.cp(path.join(previous.source, folder), path.join(root, folder), { recursive: true });
	await fs.symlink(path.join(previous.source, 'node_modules'), path.join(root, 'node_modules'), 'dir');
	await fs.cp(path.join(directory, 'seed'), path.join(root, 'data'), { recursive: true });
	await fs.copyFile(path.join(directory, 'baseline/config.json'), path.join(root, 'config.json'));
	const code_sha256 = {};
	for (const file of new Set([...Object.keys(previous.code_sha256), 'static/css/leitstand.css'])) code_sha256[file] = crypto.createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
	const manifest = { ...previous, root, variant: name, code_sha256 };
	await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
	await fs.writeFile('/tmp/bts-under500-lab-prepare.json', JSON.stringify(manifest, null, 2));
	return manifest;
}

if (require.main === module) (process.argv[2] === '--variant' ? variant(process.argv[3]) : prepare())
	.then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error);process.exitCode = 1; });
module.exports = { prepare, documents, variant };
