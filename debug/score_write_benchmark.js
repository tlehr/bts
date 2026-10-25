'use strict';

// Controlled scheduler-contention probe, not a tournament latency forecast.
// Uses only synthetic fixtures and file-backed NeDB stores under os.tmpdir().
const assert = require('assert');
const fs = require('fs/promises'), path = require('path'), os = require('os');
const { promisify } = require('util');
const { performance } = require('perf_hooks');
const Datastore = require('nedb');
const database = require('../bts/database');
const write = require('../bts/score_write');

const statistics = values => {
	const sorted = [...values].sort((a, b) => a - b);
	return { count: sorted.length, median_ms: sorted[Math.ceil(sorted.length / 2) - 1],
		p95_ms: sorted[Math.ceil(sorted.length * .95) - 1], max_ms: sorted.at(-1) };
};
function documents() {
	return Array.from({ length: 128 }, (_, index) => ({
		_id: String(index + 1), tournament_key: 'fixture', match_order: index + 1,
		network_score: [[0, 0]],
		presses: Array.from({ length: 180 }, (_, i) => ({ type: 'score', side: i % 2 ? 'left' : 'right', timestamp: i })),
		setup: { match_num: index + 1, state: index < 13 ? 'oncourt' : 'scheduled',
			teams: [0, 1].map(team => ({ players: [0, 1].map(player => ({
				btp_id: index * 4 + team * 2 + player, name: 'Synthetic player ' + (index * 4 + team * 2 + player),
			})) })),
		},
	}));
}
const sorted = store => store.getAllData().sort((a, b) => Number(a._id) - Number(b._id));

async function sample(directory, direct, interference_ms) {
	const store = new Datastore({ filename: path.join(directory, 'matches') });
	await promisify(store.loadDatabase.bind(store))(); database.setup_helpers({ matches: store });
	await promisify(store.insert.bind(store))(documents());
	const expected = sorted(store), durations = [];
	process.env.BTS_SCORE_DIRECT_WRITES = direct ? '1' : '0';
	let stopped = false, scheduled;
	const interfere = () => {
		if (stopped) return;
		const end = performance.now() + interference_ms;
		while (performance.now() < end) { /* Explicit, synthetic synchronous contention. */ }
		scheduled = setImmediate(interfere);
	};
	if (interference_ms) scheduled = setImmediate(interfere);
	try {
		for (let i = 0; i < 76; i++) {
			const id = String(i % 13 + 1), score = [[i + 1, 0]];
			const began = performance.now();
			const [count, updated] = await new Promise((resolve, reject) => write(store, { _id: id, tournament_key: 'fixture' },
				{ network_score: score }, (error, ...result) => error ? reject(error) : resolve(result)));
			if (i >= 12) durations.push(performance.now() - began);
			assert.strictEqual(count, 1); assert.deepStrictEqual(updated.network_score, score);
			expected[Number(id) - 1].network_score = score;
			assert.deepStrictEqual(updated, expected[Number(id) - 1]);
		}
	} finally { stopped = true; clearImmediate(scheduled); }
	await promisify(store.findOne.bind(store))({ _id: '1' }); // Drain the final executor release.
	assert.deepStrictEqual(sorted(store), expected);
	const reloaded = new Datastore({ filename: store.filename }); await promisify(reloaded.loadDatabase.bind(reloaded))();
	assert.deepStrictEqual(sorted(reloaded), expected);
	return { direct, interference_ms, ...statistics(durations), durations_ms: durations };
}

async function run() {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-score-write-'));
	const previous = process.env.BTS_SCORE_DIRECT_WRITES, pairs = [];
	try {
		for (let repetition = 0; repetition < 6; repetition++) for (const interference_ms of [0, 2]) {
			const samples = [];
			for (const direct of repetition % 2 ? [true, false] : [false, true]) {
				const destination = path.join(directory, `${repetition}-${interference_ms}-${direct}`); await fs.mkdir(destination);
				samples.push(await sample(destination, direct, interference_ms));
			}
			pairs.push({ repetition, interference_ms, samples });
		}
		const summary = [0, 2].map(interference_ms => ({ interference_ms,
			variants: [false, true].map(direct => ({ direct, ...statistics(pairs.filter(pair => pair.interference_ms === interference_ms)
				.flatMap(pair => pair.samples.filter(sample => sample.direct === direct).flatMap(sample => sample.durations_ms))) })),
		}));
		return { created_at: new Date().toISOString(), node: process.version, matches: 128, histories_per_match: 180,
			points_per_sample: 64, warmup_points: 12, pairs, summary,
			validation: 'All callback documents, full final states including match order, and file reloads equal the expected updates.',
			limitations: ['Synthetic 2-ms callbacks deliberately occupy every event-loop turn in the contention case.',
				'No BTP, network reception, speech synthesis, browser painting or real tournament mutation.',
				'This isolates the update path; it does not prove the source or size of the live outliers.'],
		};
	} finally {
		if (previous === undefined) delete process.env.BTS_SCORE_DIRECT_WRITES; else process.env.BTS_SCORE_DIRECT_WRITES = previous;
		await fs.rm(directory, { recursive: true, force: true });
	}
}

if (require.main === module) run().then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
	.catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
