'use strict';

const assert = require('assert');
const compact = require('../bts/speech/playback');
const { wave, pcm } = require('./fixtures/speech_pcm');
const voiced = wav => {
    const data = pcm(wav), values = [];
    for (let offset = 0; offset < data.length; offset += 2) {
        const sample = data.readInt16LE(offset);
        if (Math.abs(sample) > 4) values.push(sample);
    }
    return values;
};

describe('Local speech playback silence', function() {
    it('shortens long word gaps and quiet edges while preserving all audible samples and the original WAV', function() {
        const original = wave([[300, 0], [120, 800], [700, 0], [120, -1000], [400, 0]]);
        const copy = Buffer.from(original);
        const result = compact(original, true);
        assert.strictEqual(pcm(result).length / 48000, 0.4);
        assert.deepStrictEqual(voiced(result), voiced(original));
        assert.deepStrictEqual(original, copy);
        assert.strictEqual(result.readUInt32LE(4) + 8, result.length);
    });

    it('preserves intentional internal sentence pauses in edge-only mode', function() {
        const original = wave([[300, 0], [120, 800], [700, 0], [120, -1000], [400, 0]]);
        const result = compact(original, false);
        assert.strictEqual(pcm(result).length / 48000, 1);
        assert.deepStrictEqual(voiced(result), voiced(original));
    });

    it('keeps quiet speech, short gaps and short syllables intact', function() {
        const original = wave([[10, 0], [20, 5], [200, 0], [20, -5], [10, 0]]);
        assert.strictEqual(compact(original, true), original);
        assert.deepStrictEqual(voiced(compact(original, true)), voiced(original));
    });

    it('detects speech on either stereo channel and respects a different sample rate', function() {
        const original = wave([[300, 0], [120, [0, 800]], [700, 0], [120, [-800, 0]], [400, 0]], 48000, 2);
        const result = compact(original, true);
        assert.strictEqual(pcm(result).length / (48000 * 4), 0.4);
        assert.deepStrictEqual(voiced(result), voiced(original));
    });

    it('preserves additional RIFF chunks and their padding', function() {
        const original = wave([[300, 0], [120, 800], [400, 0]]);
        const junk = Buffer.alloc(12);
        junk.write('JUNK'); junk.writeUInt32LE(3, 4); junk.write('abc', 8);
        const input = Buffer.concat([original.subarray(0, 36), junk, original.subarray(36)]);
        input.writeUInt32LE(input.length - 8, 4);
        const result = compact(input, true);
        assert.deepStrictEqual(result.subarray(36, 48), junk);
        assert.deepStrictEqual(voiced(result), voiced(original));
        assert.strictEqual(pcm(result).length / 48000, 0.18);
    });

    it('keeps silence and unsupported or malformed WAVs unchanged', function() {
        const silence = wave([[500, 0]]);
        const float = wave([[100, 800]]); float.writeUInt16LE(3, 20);
        const malformed = wave([[100, 800]]); malformed.writeUInt32LE(0xffffffff, 40);
        const invalidAlignment = wave([[100, 800]]); invalidAlignment.writeUInt16LE(1, 32);
        for (const original of [silence, float, malformed, invalidAlignment, Buffer.from('RIFF-incomplete'), Buffer.alloc(0)]) {
            assert.strictEqual(compact(original, true), original);
        }
    });
});
