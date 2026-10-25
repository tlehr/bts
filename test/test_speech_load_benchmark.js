'use strict';

const assert = require('assert'), fs = require('fs/promises'), path = require('path'), os = require('os');
const { parse, inferenceOverlap, VARIANTS } = require('../debug/speech_load_benchmark');
const { fixture, score, digest } = require('../debug/speech_load/fixture');
const { validate } = require('../debug/speech_load/server');
const { parse_stat, parse_io, delta } = require('../debug/speech_load/resources');
const { statistics } = require('../debug/speech_load/stats');

describe('Controlled speech load comparison', function() {
	it('keeps fixtures and BUP score sequences deterministic and valid', function() {
		assert.strictEqual(digest(fixture()), digest(fixture()));
		const data = fixture();
		assert.strictEqual(data.matches.length, 373);
		assert.strictEqual(data.courts.length, 13);
		assert.strictEqual(data.matches.filter(m => m.setup.now_on_court).length, 13);
		const calc = require('../static/bup/dev/js/calc');
		for (const index of [0, 19, 260, 749, 1300, 1377]) {
			const input = score(index), match = data.matches.find(m => m._id === input.match_id);
			assert.deepStrictEqual(calc.remote_state({}, match.setup, input.presses).game.score, input.network_score[0]);
			assert.strictEqual(input.presses.length, 180);
		}
	});
	it('changes thread budget and niceness independently', function() {
		const [idle, normal, threads, nice] = VARIANTS;
		assert.deepStrictEqual({ ...normal, id: idle.id, generate: false }, idle);
		assert.deepStrictEqual({ ...normal, id: threads.id, threads: 2 }, threads);
		assert.deepStrictEqual({ ...normal, id: nice.id, nice: 10 }, nice);
		assert.strictEqual(parse([]).seconds, 60);
		for (const argv of [['--seconds', '0'], ['--variants', 'idle,idle'], ['--variants', 'other'], ['--output'], ['--rounds', 'nan']]) {
			assert.throws(() => parse(argv));
		}
	});
	it('rejects nonempty case directories and the real checkout before opening datastores', async function() {
		await assert.rejects(validate(path.resolve(__dirname, '..')), /own temporary root/);
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-speech-load-'));
		try {
			const directory = path.join(root, 'case-0'); await fs.mkdir(directory);
			await validate(directory);
			await fs.writeFile(path.join(directory, 'matches'), 'existing');
			await assert.rejects(validate(directory), /must be empty/);
			const link = path.join(root, 'case-1'); await fs.symlink(directory, link);
			await assert.rejects(validate(link), /own temporary root/);
		} finally { await fs.rm(root, { recursive: true, force: true }); }
	});
	it('parses process names with spaces and parentheses and reports one-core CPU percentages', function() {
		const fields = Array(22).fill('0'); fields[0] = 'S'; fields[11] = '120'; fields[12] = '20'; fields[16] = '10'; fields[19] = '200'; fields[21] = '1000';
		const first = { ...parse_stat('123 (model (worker)) ' + fields.join(' ')), ts: 1000, io: parse_io('read_bytes: 10\nwrite_bytes: 20\n') };
		const last = { ...first, ts: 2000, user_ticks: 320, io: { read_bytes: 10, write_bytes: 120 } };
		const result = delta(first, last, 100);
		assert.strictEqual(result.cpu_ms, 2000); assert.strictEqual(result.cpu_percent_one_core, 200);
		assert.strictEqual(result.nice, 10); assert.strictEqual(result.io.write_bytes, 100);
		assert.strictEqual(delta(first, { ...last, start_ticks: 201 }, 100).available, false);
		assert.strictEqual(delta({ unavailable: 'EPERM' }, last, 100).available, false);
	});
	it('counts only inference overlap with the measured window, including an unfinished last job', function() {
		assert.strictEqual(inferenceOverlap([
			{ event: 'inference_start', ts: 0, warmup: true }, { event: 'inference_end', ts: 1000, warmup: true },
			{ event: 'inference_start', ts: 50 }, { event: 'inference_end', ts: 150 },
			{ event: 'inference_start', ts: 180 },
		], 100, 200), 70);
		assert.strictEqual(statistics([]).p99, null);
		assert.strictEqual(statistics([1, 2, 3, NaN]).count, 3);
	});
});
