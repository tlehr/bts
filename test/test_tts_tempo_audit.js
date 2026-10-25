'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { wave } = require('./fixtures/speech_pcm');

describe('Offline speech tempo preflight', function() {
    this.timeout(10000);
    it('compares spelled numbers, detects a slow phrase and its pauses without modifying the cache', function() {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-tempo-test-'));
        try {
            const cache = path.join(root, 'cache'), audio = path.join(cache, 'audio'), output = path.join(root, 'report');
            fs.mkdirSync(audio, { recursive: true });
            const records = [], originals = new Map();
            const add = (id, text, sections, contextual = true) => {
                const file = id + '.wav', wav = wave(sections);
                originals.set(file, Buffer.from(wav)); fs.writeFileSync(path.join(audio, file), wav);
                records.push({ identity: 'current', audio_id: id, file, processed: true,
                    sha256: crypto.createHash('sha256').update(wav).digest('hex'),
                    part: '~bts-context-v2~' + JSON.stringify({ before: '', text,
                        after: contextual ? ' ist als nächstes an der Reihe.' : '', kind: 'generic' }),
                    usage: [{ voice: 'hallensprecher', tournament: 'test' }],
                });
            };
            for (const number of [17, 18, 19]) add('number-' + number, 'Spielnummer ' + number, [[50, 0], [1000, 800], [50, 0]]);
            add('slow', 'Spiel um Platz 5 und 6!', [[50, 0], [1500, 800], [500, 0], [1500, 800], [50, 0]], false);
            add('silent', 'Viertelfinale!', [[1000, 0]]);
            const index = JSON.stringify({ state: { identity: 'current' }, records });
            fs.writeFileSync(path.join(cache, 'index-test.json'), index);
            const run = () => spawnSync('python3', [path.resolve(__dirname, '../scripts/tts-tempo-audit.py'),
                '--cache', cache, '--output', output], { encoding: 'utf8' });
            const generated = run();
            assert.strictEqual(generated.status, 0, generated.stderr);
            const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json')));
            assert.strictEqual(report.rows.length, 4);
            assert.strictEqual(report.skipped.length, 1);
            assert.strictEqual(report.synthesis_requests, 0);
            assert.strictEqual(report.cache_modified, false);
            const slow = report.rows.find(row => row.audio_id === 'slow');
            assert.strictEqual(slow.spoken, 'Spiel um Platz fünf und sechs!');
            assert.strictEqual(slow.contextual, false);
            assert.strictEqual(slow.review, true);
            assert.deepStrictEqual(slow.internal_pauses_ms, [500]);
            assert(slow.relative_tempo < .5);
            assert.strictEqual(fs.readFileSync(path.join(cache, 'index-test.json'), 'utf8'), index);
            for (const [name, bytes] of originals) assert.deepStrictEqual(fs.readFileSync(path.join(audio, name)), bytes);
            assert.deepStrictEqual(fs.readFileSync(path.join(output, slow.audio)), originals.get('slow.wav'));
            const page = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
            assert(page.includes('preservesPitch=true') && page.includes('playbackRate=Number(select.value)'));
            const before = fs.readFileSync(path.join(output, 'report.json'));
            assert.notStrictEqual(run().status, 0, 'an existing listening report must not be overwritten');
            assert.deepStrictEqual(fs.readFileSync(path.join(output, 'report.json')), before);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
