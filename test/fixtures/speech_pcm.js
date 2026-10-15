'use strict';

function wave(sections, rate = 24000, channels = 1) {
    const data = Buffer.concat(sections.map(([ms, value]) => {
        const frames = Math.round(ms * rate / 1000);
        const block = Buffer.alloc(frames * channels * 2);
        for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
            block.writeInt16LE(Array.isArray(value) ? value[channel] : value, (frame * channels + channel) * 2);
        }
        return block;
    }));
    const header = Buffer.alloc(44);
    header.write('RIFF'); header.writeUInt32LE(data.length + 36, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * channels * 2, 28);
    header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

function pcm(wav) {
    for (let offset = 12; offset + 8 <= wav.length;) {
        const size = wav.readUInt32LE(offset + 4);
        if (wav.toString('ascii', offset, offset + 4) === 'data') return wav.subarray(offset + 8, offset + 8 + size);
        offset += 8 + size + (size & 1);
    }
    throw new Error('No PCM data');
}

module.exports = { wave, pcm };
