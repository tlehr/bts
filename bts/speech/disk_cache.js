'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const fsp = fs.promises;
const ID = /^[0-9a-f]{32}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_BYTES = 32 * 1024 * 1024;

function wav(data) {
    if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE' ||
        data.readUInt32LE(4) + 8 !== data.length) return false;
    let format, samples;
    for (let offset = 12; offset + 8 <= data.length;) {
        const length = data.readUInt32LE(offset + 4), start = offset + 8;
        if (start + length + (length & 1) > data.length) return false;
        const kind = data.toString('ascii', offset, offset + 4);
        if (kind === 'fmt ') {
            if (format || length < 16 || data.readUInt16LE(start) !== 1 || data.readUInt16LE(start + 14) !== 16) return false;
            const channels = data.readUInt16LE(start + 2), rate = data.readUInt32LE(start + 4), align = data.readUInt16LE(start + 12);
            if (![1, 2].includes(channels) || rate < 8000 || rate > 192000 || align !== channels * 2) return false;
            format = align;
        }
        if (kind === 'data') { if (samples !== undefined) return false; samples = length; }
        offset = start + length + (length & 1);
    }
    return !!format && samples > 0 && samples % format === 0;
}

class SpeechDiskCache {
    constructor(config) {
        this.config = config;
        this.directory = path.resolve(config.cache_dir);
        this.audio_directory = path.join(this.directory, 'audio');
        const namespace = crypto.createHash('sha256').update(config.base_url).digest('hex');
        this.index = path.join(this.directory, 'index-' + namespace + '.json');
        this.records = new Map();
        this.generation = new Map();
        this.diagnostics = new Map();
        this.valid = new Map();
        this.files = new Map();
        this.state = null;
        this.writes = Promise.resolve();
        fs.mkdirSync(this.audio_directory, { recursive: true, mode: 0o700 });
        try {
            if (fs.statSync(this.index).size > 64 * 1024 * 1024) throw new Error('cache_index_limit');
            const saved = JSON.parse(fs.readFileSync(this.index, 'utf8'));
            if (saved.version === 1 && saved.endpoint === config.base_url && Array.isArray(saved.records)) {
                this.state = saved.state;
                for (const pair of (Array.isArray(saved.diagnostics) ? saved.diagnostics : []).slice(-4096)) {
                    if (!Array.isArray(pair) || pair.length !== 2 || !HASH.test(pair[0])) continue;
                    const row = pair[1];
                    if (!row || !row.families || typeof row.families !== 'object' || Array.isArray(row.families) ||
                        Object.keys(row.families).length > 16 || Object.entries(row.families).some(([key, count]) =>
                            !/^[0-9a-f]{32,64}$/.test(key) || !Number.isSafeInteger(count) || count < 0) ||
                        !Array.isArray(row.recent_failures) || row.recent_failures.length > 8 ||
                        ![row.archived || 0, row.transport_count || 0, row.last_failure_at].every(value => Number.isFinite(value) && value >= 0)) continue;
                    const { cleanEvent } = require('./failures');
                    this.diagnostics.set(pair[0], { ...row, recent_failures: row.recent_failures.map(cleanEvent).filter(Boolean) });
                }
                for (const item of saved.records) if (this.recordValid(item)) this.records.set(this.key(item.identity, item.key), item);
                for (const item of (Array.isArray(saved.generation) ? saved.generation : []).slice(0, 8192)) if (item && typeof item.identity === 'string' &&
                    item.identity.length < 1048576 && HASH.test(item.key) && Array.isArray(item.tournaments) &&
                    item.tournaments.length <= 128 && item.tournaments.every(key => typeof key === 'string' && key.length <= 256)) {
                    this.generation.set(this.key(item.identity, item.key), item);
                }
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw new Error('speech_cache_index_invalid');
        }
        this.verified = false;
        this.ready = this.verify().then(() => { this.verified = true; });
    }

    key(identity, key) { return crypto.createHash('sha256').update(JSON.stringify([identity, key])).digest('hex'); }
    filename(name) {
        if (!/^(?:[0-9a-f]{64}|id-[0-9a-f]{32})\.wav$/.test(name)) throw new Error('invalid_audio_filename');
        return path.join(this.audio_directory, name);
    }
    recordFilename(item) { return item.file || item.sha256 + '.wav'; }
    recordValid(item) {
        return item && HASH.test(item.key) && typeof item.identity === 'string' && item.identity.length < 1048576 &&
            ID.test(item.audio_id) && ID.test(item.job_id) && HASH.test(item.sha256) &&
            Number.isSafeInteger(item.size_bytes) && item.size_bytes > 44 && item.size_bytes <= MAX_BYTES &&
            (!item.file || item.file === item.sha256 + '.wav' || item.file === 'id-' + item.audio_id + '.wav') &&
            typeof item.processed === 'boolean' && [item.leading_quiet_ms, item.trailing_quiet_ms].every(value =>
                Number.isFinite(value) && value >= 0 && value <= 60000) &&
            (item.playback_profile === undefined || item.playback_profile === null || item.playback_profile === 'bts-playback-v1') &&
            (item.generated_for === undefined || Array.isArray(item.generated_for) && item.generated_for.length <= 128 &&
                item.generated_for.every(key => typeof key === 'string' && key.length <= 256)) &&
            (item.usage === undefined || Array.isArray(item.usage) && item.usage.length <= 256 && item.usage.every(value =>
                value && typeof value.tournament === 'string' && value.tournament.length <= 256 &&
                ['hallensprecher', 'hallensprecherin'].includes(value.voice) && Array.isArray(value.groups) &&
                value.groups.length <= 16 && value.groups.every(group => /^(D(?:0[1-9]|1[0-4])|registration|other)$/.test(group)))) &&
            (item.part === undefined || typeof item.part === 'string' && item.part.length <= 41000) &&
            (item.fallback_stage === undefined || ['context', 'name'].includes(item.fallback_stage));
    }

    async inspect(filename, expected = {}) {
        const stat = await fsp.lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES || stat.size < 44 ||
            expected.size_bytes && stat.size !== expected.size_bytes) throw new Error('invalid_cached_audio');
        const data = await fsp.readFile(filename);
        const sha256 = crypto.createHash('sha256').update(data).digest('hex');
        if (!wav(data) || expected.sha256 && sha256 !== expected.sha256) throw new Error('invalid_cached_audio');
        return { path: filename, sha256, size_bytes: data.length, mtime_ms: stat.mtimeMs };
    }

    async verify() {
        const hashes = new Map();
        for (const [key, item] of this.records) {
            const name = this.recordFilename(item);
            if (!hashes.has(name)) {
                try { hashes.set(name, await this.inspect(this.filename(name), item)); }
                catch (_) { hashes.set(name, null); }
            }
            const file = hashes.get(name);
            if (file && file.size_bytes === item.size_bytes && file.sha256 === item.sha256) {
                this.valid.set(key, item);
                this.files.set(item.audio_id, file);
            }
        }
        // Switching an existing installation to shared storage must also
        // replace earlier downloaded copies, without involving the API.
        if (this.config.shared_audio_dir) for (const item of this.valid.values()) {
            if (item.storage === 'hardlink' && item.file === 'id-' + item.audio_id + '.wav') continue;
            try {
                const source = path.join(path.resolve(this.config.shared_audio_dir), item.playback_profile ? 'playback' : '', item.audio_id + '.wav');
                const stat = await fsp.lstat(source);
                if (stat.isFile() && !stat.isSymbolicLink()) await this.save(item.identity, item.key,
                    { job_id: item.job_id, audio: item, fallback_stage: item.fallback_stage });
            } catch (_) { /* Keep the verified copy if sharing is unavailable. */ }
        }
    }

    file(audio_id) {
        const file = this.files.get(audio_id);
        if (!file) return null;
        try {
            const stat = fs.lstatSync(file.path);
            if (stat.isFile() && !stat.isSymbolicLink() && stat.size === file.size_bytes && stat.mtimeMs === file.mtime_ms) return file;
        } catch (_) { /* An absent/corrupt file cannot remain ready. */ }
        this.files.delete(audio_id);
        return null;
    }

    lookup(identity, key) {
        const item = this.valid.get(this.key(identity, key));
        return item && this.file(item.audio_id) ? item : null;
    }

    count() {
        if (!this.verified) return null;
        let count = 0;
        for (const item of this.valid.values()) if (this.files.has(item.audio_id)) count++;
        return count;
    }

    origin(identity, key) { return this.generation.get(this.key(identity, key))?.tournaments || []; }

    async mark_generated(identity, key, tournaments) {
        await this.ready;
        const id = this.key(identity, key), previous = this.generation.get(id);
        if (!previous && this.generation.size >= 8192) return;
        const keys = [...new Set([...(previous?.tournaments || []), ...tournaments])];
        if (keys.length === previous?.tournaments.length) return;
        this.generation.set(id, { identity, key, tournaments: keys });
        await this.persist();
    }

    async tag_progress(identity, updates) {
        await this.ready;
        let changed = false;
        for (const { key, tournament, groups, voice, part } of updates) {
            const item = this.lookup(identity, key);
            if (!item) continue;
            if (part && item.part !== part) { item.part = part; changed = true; }
            item.usage ||= [];
            let usage = item.usage.find(value => value.tournament === tournament && value.voice === voice);
            if (!usage) { usage = { tournament, voice, groups: [] }; item.usage.push(usage); }
            for (const group of groups) if (!usage.groups.includes(group)) { usage.groups.push(group); changed = true; }
        }
        if (changed) await this.persist();
    }

    persist() {
        this.writes = this.writes.catch(() => {}).then(async () => {
            const temporary = this.index + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
            let handle;
            try {
                handle = await fsp.open(temporary, 'wx', 0o600);
                await handle.writeFile(JSON.stringify({ version: 1, endpoint: this.config.base_url, state: this.state,
                    records: [...this.records.values()], generation: [...this.generation.values()], diagnostics: [...this.diagnostics.entries()] }));
                await handle.sync(); await handle.close(); handle = null;
                await fsp.rename(temporary, this.index);
                await this.syncDirectory(this.directory);
            } finally { await handle?.close(); await fsp.unlink(temporary).catch(() => {}); }
        });
        return this.writes;
    }

    async syncDirectory(directory) {
        const handle = await fsp.open(directory, 'r');
        try { await handle.sync(); } finally { await handle.close(); }
    }

    async setState(state) {
        if (JSON.stringify(this.state) === JSON.stringify(state)) return;
        this.state = state;
        await this.persist();
    }

    async download(audio_id, temporary) {
        const target = new URL('/v1/audio/' + audio_id, this.config.base_url);
        await new Promise((resolve, reject) => {
            let output, size = 0;
            const request = (target.protocol === 'https:' ? https : http).get(target, {
                headers: { 'X-API-Key': this.config.api_key },
            }, response => {
                if (response.statusCode !== 200 || response.headers['content-type']?.split(';')[0] !== 'audio/wav' ||
                    Number(response.headers['content-length']) > MAX_BYTES) {
                    response.resume(); reject(new Error('speech_audio_unavailable')); return;
                }
                output = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
                response.on('data', chunk => {
                    size += chunk.length;
                    if (size > MAX_BYTES) request.destroy(new Error('speech_audio_limit'));
                });
                response.on('error', error => { output.destroy(); reject(error); });
                response.on('aborted', () => { output.destroy(); reject(new Error('speech_audio_aborted')); });
                output.on('error', error => { request.destroy(); reject(error); });
                output.on('finish', resolve);
                response.pipe(output);
            });
            const timer = setTimeout(() => request.destroy(new Error('speech_audio_timeout')), this.config.audio_timeout_ms);
            request.on('close', () => clearTimeout(timer));
            request.on('error', error => { output?.destroy(); reject(error); });
        });
    }

    async store(identity, key, response) {
        await this.ready;
        return this.save(identity, key, response);
    }

    async save(identity, key, response) {
        if (!identity || !HASH.test(key) || !ID.test(response.job_id) || !ID.test(response.audio?.audio_id)) throw new Error('invalid_cache_record');
        const audio = response.audio;
        let temporary = path.join(this.audio_directory, '.' + crypto.randomBytes(16).toString('hex') + '.tmp');
        let storage = 'download';
        try {
            if (this.config.shared_audio_dir) {
                const source = path.join(path.resolve(this.config.shared_audio_dir), audio.playback_profile ? 'playback' : '', audio.audio_id + '.wav');
                try {
                    const stat = await fsp.lstat(source);
                    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid_shared_audio');
                    try { await fsp.link(source, temporary); storage = 'hardlink'; }
                    catch (error) {
                        if (!['EXDEV', 'EPERM', 'EACCES'].includes(error.code)) throw error;
                        await fsp.copyFile(source, temporary, fs.constants.COPYFILE_EXCL); storage = 'copy';
                    }
                } catch (error) {
                    if (!['ENOENT', 'EACCES'].includes(error.code)) throw error;
                }
            }
            if (storage === 'download') await this.download(audio.audio_id, temporary);
            const file = await this.inspect(temporary, audio);
            const handle = await fsp.open(temporary, 'r');
            try { await handle.sync(); } finally { await handle.close(); }
            // Each shared audio ID retains its own hardlink, including when
            // two distinct source IDs happen to contain identical PCM data.
            const name = storage === 'hardlink' ? 'id-' + audio.audio_id + '.wav' : file.sha256 + '.wav';
            const filename = this.filename(name);
            try { await fsp.link(temporary, filename); }
            catch (error) {
                if (error.code !== 'EEXIST') throw error;
                try { await this.inspect(filename, file); }
                catch (_) { await fsp.unlink(filename); await fsp.link(temporary, filename); }
                if (storage === 'hardlink') {
                    // Also deduplicate copies created before shared storage was enabled.
                    await fsp.rename(temporary, filename); temporary = null;
                }
            }
            if (temporary) { await fsp.unlink(temporary); temporary = null; }
            await this.syncDirectory(this.audio_directory);
            const stored_file = await this.inspect(filename, file);
            const record_key = this.key(identity, key);
            const previous = this.records.get(record_key);
            const item = { identity, key, job_id: response.job_id, audio_id: audio.audio_id,
                sha256: file.sha256, size_bytes: file.size_bytes, file: name, processed: audio.processed === true,
                playback_profile: audio.playback_profile || null,
                leading_quiet_ms: audio.leading_quiet_ms || 0, trailing_quiet_ms: audio.trailing_quiet_ms || 0, storage,
                ...(response.part || previous?.part ? { part: response.part || previous.part } : {}),
                generated_for: [...new Set([...(previous?.generated_for || []), ...this.origin(identity, key), ...(response.generated_for || [])])],
                ...(previous?.usage ? { usage: previous.usage } : {}),
                ...(response.fallback_stage ? { fallback_stage: response.fallback_stage } : {}) };
            if (!this.recordValid(item)) throw new Error('invalid_cache_record');
            this.records.set(record_key, item);
            this.generation.delete(record_key);
            await this.persist();
            this.valid.set(record_key, item);
            this.files.set(item.audio_id, stored_file);
            if (previous && this.recordFilename(previous) !== name &&
                ![...this.records.values()].some(record => this.recordFilename(record) === this.recordFilename(previous))) {
                await fsp.unlink(this.filename(this.recordFilename(previous))).catch(() => {});
            }
            return item;
        } finally { if (temporary) await fsp.unlink(temporary).catch(() => {}); }
    }
}

module.exports = SpeechDiskCache;
