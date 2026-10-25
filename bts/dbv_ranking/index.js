'use strict';

const https = require('https');
const path = require('path');
const WorkerClient = require('../offload/client');
const client = new WorkerClient('dbv_ranking', path.join(__dirname, 'worker.js'), { timeout_ms: 60000, max_pending: 4 });
const ORIGIN = 'https://turniere.badminton.de';

function validate_family(family) {
	if (family !== 'u19' && family !== 'o19') throw new Error('Bitte DBV U19 oder O19 auswählen.');
}

function base_path(family) {
	validate_family(family);
	return family === 'o19' ? '/ranking/o19' : '/ranking';
}

function download_path(family, version) {
	if (version === 'current') return base_path(family) + '/download';
	validate_family(family);
	const match = /^([2][0-9]{3})-([0-9]{2})$/.exec(version);
	if (!match || Number(match[2]) < 1 || Number(match[2]) > 53) throw new Error('Ungültige Ranglistenwoche.');
	return '/uploads/ranking/Ranking_' + match[1] + '_KW' + match[2] + (family === 'o19' ? '_O19' : '') + '.xlsx';
}

// Only fixed DBV endpoints and validated archive filenames are requested.
function fetch_file(url_path, limit = 30 * 1024 * 1024, redirects = 0) {
	return new Promise((resolve, reject) => {
		const req = https.get(ORIGIN + url_path, { headers: { 'User-Agent': 'BTS-DBV-Ranglistenimport' } }, res => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				res.resume();
				const target = new URL(res.headers.location, ORIGIN + url_path);
				if (redirects >= 3 || target.origin !== ORIGIN) return reject(new Error('Unerwartete Weiterleitung der DBV-Rangliste.'));
				return resolve(fetch_file(target.pathname + target.search, limit, redirects + 1));
			}
			if (res.statusCode !== 200) {
				res.resume();
				return reject(new Error('DBV-Rangliste konnte nicht geladen werden (HTTP ' + res.statusCode + ').'));
			}
			const chunks = [];
			let size = 0;
			res.on('data', chunk => {
				size += chunk.length;
				if (size > limit) { req.destroy(new Error('DBV-Datei ist zu groß.')); return; }
				chunks.push(chunk);
			});
			res.on('error', reject);
			res.on('aborted', () => reject(new Error('Download der DBV-Rangliste wurde unterbrochen.')));
			res.on('end', () => resolve({ buffer: Buffer.concat(chunks), headers: res.headers }));
		});
		const timer = setTimeout(() => req.destroy(new Error('Zeitüberschreitung beim Laden der DBV-Rangliste.')), 45000);
		req.on('close', () => clearTimeout(timer));
		req.on('error', reject);
	});
}

function parse_catalog(html, family) {
	validate_family(family);
	const versions = new Map();
	const pattern = /href=["'][^"']*\/uploads\/ranking\/Ranking_(\d{4})_KW(\d{2})(_O19)?\.xlsx["']/gi;
	for (const match of html.matchAll(pattern)) {
		if (Boolean(match[3]) !== (family === 'o19')) continue;
		const id = match[1] + '-' + match[2];
		download_path(family, id);
		versions.set(id, { id, label: match[1] + ' / KW ' + match[2] });
	}
	if (!versions.size) throw new Error('Das DBV-Ranglistenarchiv konnte nicht gelesen werden.');
	return [{ id: 'current', label: 'Aktuelle Rangliste' }, ...[...versions.values()].sort((a, b) => b.id.localeCompare(a.id))];
}

async function catalog(family) {
	const result = await fetch_file(base_path(family) + '/history', 2 * 1024 * 1024);
	return parse_catalog(result.buffer.toString('utf8'), family);
}

async function load(family, version, candidates) {
	const url_path = download_path(family, version);
	const result = await fetch_file(url_path);
	const bytes = Uint8Array.from(result.buffer);
	const matched = await client.run({ bytes: bytes.buffer, candidates }, { family, version }, [bytes.buffer]);
	return {
		...matched,
		family, version,
		label: 'DBV ' + family.toUpperCase() + ' – ' + (version === 'current' ? 'Aktuelle Rangliste' : version.slice(0, 4) + ' / KW ' + version.slice(5)),
		source_url: ORIGIN + url_path,
		file_name: /filename="?([^";\r\n]+)/i.exec(result.headers['content-disposition'] || '')?.[1] || path.basename(url_path),
	};
}

module.exports = { catalog, load, parse_catalog, download_path, client };
