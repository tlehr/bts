'use strict';

// Playback copies only. The speech server's immutable WAV and generation key
// remain untouched, so existing recordings immediately benefit from this.
module.exports = function compactWav(wav, internal = false) {
    if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE' ||
        wav.readUInt32LE(4) + 8 !== wav.length) return wav;
    let format, data;
    for (let offset = 12; offset + 8 <= wav.length;) {
        const length = wav.readUInt32LE(offset + 4), start = offset + 8;
        if (start + length + (length & 1) > wav.length) return wav;
        const kind = wav.toString('ascii', offset, offset + 4);
        if (kind === 'fmt ') {
            if (format || length < 16) return wav;
            format = { code: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2),
                rate: wav.readUInt32LE(start + 4), align: wav.readUInt16LE(start + 12), bits: wav.readUInt16LE(start + 14) };
        } else if (kind === 'data') {
            if (data) return wav;
            data = { offset, start, length };
        }
        offset = start + length + (length & 1);
    }
    if (!format || !data || format.code !== 1 || format.bits !== 16 || ![1, 2].includes(format.channels) ||
        format.align !== format.channels * 2 || format.rate < 8000 || format.rate > 192000 ||
        !data.length || data.length % format.align) return wav;
    const frames = data.length / format.align;
    const padding = Math.round(format.rate * 0.03);
    const minimumGap = Math.round(format.rate * 0.25);
    const gap = Math.round(format.rate * 0.1);
    const ranges = [];
    let first = -1, last = -1, start = 0;
    for (let frame = 0; frame < frames; frame++) {
        let active = false;
        for (let channel = 0; channel < format.channels; channel++) {
            // Four PCM16 units are about -78 dBFS. Quiet speech stays intact;
            // only practically silent spans are eligible for shortening.
            if (Math.abs(wav.readInt16LE(data.start + frame * format.align + channel * 2)) > 4) active = true;
        }
        if (!active) continue;
        if (first < 0) { first = frame; start = Math.max(0, frame - padding); }
        else if (internal && frame - last - 1 >= minimumGap) {
            ranges.push([start, last + 1 + Math.floor(gap / 2)]);
            start = frame - Math.ceil(gap / 2);
        }
        last = frame;
    }
    // Silent/unknown audio must never become empty or artificially audible.
    if (first < 0) return wav;
    ranges.push([start, Math.min(frames, last + 1 + padding)]);
    if (ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === frames) return wav;
    const samples = Buffer.concat(ranges.map(([from, to]) =>
        wav.subarray(data.start + from * format.align, data.start + to * format.align)));
    const result = Buffer.concat([wav.subarray(0, data.start), samples,
        wav.subarray(data.start + data.length + (data.length & 1))]);
    result.writeUInt32LE(result.length - 8, 4);
    result.writeUInt32LE(samples.length, data.offset + 4);
    return result;
};
