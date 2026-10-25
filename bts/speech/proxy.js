'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const compactWav = require('./playback');
const playbackCaches = new WeakMap();
const MAX_PLAYBACK_BYTES = 16 * 1024 * 1024;

function cacheFor(broker) {
    if (!playbackCaches.has(broker)) playbackCaches.set(broker, { items: new Map(), bytes: 0 });
    return playbackCaches.get(broker);
}

function cachePlayback(cache, key, body) {
    const previous = cache.items.get(key);
    if (previous) { cache.bytes -= previous.body.length; cache.items.delete(key); }
    while (cache.items.size && cache.bytes + body.length > MAX_PLAYBACK_BYTES) {
        const oldest = cache.items.keys().next().value;
        cache.bytes -= cache.items.get(oldest).body.length;
        cache.items.delete(oldest);
    }
    const record = { body, etag: '"' + crypto.createHash('sha256').update(body).digest('hex') + '"' };
    cache.items.set(key, record);
    cache.bytes += body.length;
    return record;
}

function playbackResponse(req, res, record) {
    const { body, etag } = record;
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
    let start = 0, end = body.length - 1;
    if (req.headers.range && (!req.headers['if-range'] || req.headers['if-range'] === etag)) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (range && (range[1] || range[2])) {
            if (!range[1]) start = Math.max(0, body.length - Number(range[2]));
            else {
                start = Number(range[1]);
                if (range[2]) end = Math.min(end, Number(range[2]));
            }
        }
        if (!range || !range[1] && !range[2] || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
            start > end || start >= body.length || !range[1] && Number(range[2]) <= 0) {
            res.setHeader('Content-Range', 'bytes */' + body.length);
            res.status(416).end(); return;
        }
        res.status(206);
        res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + body.length);
    }
    res.setHeader('Content-Length', end - start + 1);
    res.end(body.subarray(start, end + 1));
}

module.exports = function audio_proxy(req, res) {
    const broker = req.app.speech?.broker;
    const { tournament_key, audio_id } = req.params;
    const playback = req.query.playback || '';
    if (!broker?.authorize(tournament_key, audio_id, req.query.expires, req.query.signature, playback)) {
        res.status(401).json({ error: 'invalid_audio_grant' });
        return;
    }
    if (broker.audio_clients >= broker.config.max_audio_clients) {
        res.status(503).json({ error: 'audio_proxy_busy' });
        return;
    }
    broker.audio_clients++;
    let upstream, released = false;
    const fail = error => {
        if (error instanceof Error) broker.health?.fail('audio', error);
        if (res.writableEnded || res.destroyed) return;
        if (!res.headersSent) res.status(503).json({ error: 'audio_unavailable' });
        else res.destroy();
    };
    const timer = setTimeout(() => {
        if (res.writableEnded) { if (!res.writableFinished) res.destroy(); }
        else fail(new Error('speech_audio_timeout'));
        upstream?.destroy();
    }, broker.config.audio_timeout_ms);
    const release = () => {
        if (released) return;
        released = true;
        clearTimeout(timer);
        broker.audio_clients--;
    };
    res.on('close', () => { release(); if (!res.writableEnded) upstream?.destroy(); });
    res.on('finish', release);
    const seconds = Math.max(0, Number(req.query.expires) - Math.floor(broker.now() / 1000));
    const headers = () => {
        res.setHeader('Cache-Control', 'private, max-age=' + seconds + ', immutable');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
    };
    const cache = playback ? cacheFor(broker) : null;
    const cacheKey = audio_id + ':' + playback;
    if (cache?.items.has(cacheKey)) {
        const record = cache.items.get(cacheKey);
        cache.items.delete(cacheKey); cache.items.set(cacheKey, record);
        headers(); playbackResponse(req, res, record); return;
    }
    const local = broker.disk?.file(audio_id);
    if (local) {
        headers();
        if (playback) {
            if (local.size_bytes > MAX_PLAYBACK_BYTES) { fail(); return; }
            void fs.promises.readFile(local.path).then(data => {
                if (res.writableEnded || res.destroyed) return;
                playbackResponse(req, res, cachePlayback(cache, cacheKey, compactWav(data, playback === 'words-v1')));
                broker.health?.clear('audio');
            }).catch(fail);
        } else {
            res.setHeader('Content-Type', 'audio/wav');
            res.setHeader('ETag', '"' + local.sha256 + '"');
            res.sendFile(local.path, { cacheControl: false, lastModified: false }, error => {
                if (!error) { broker.health?.clear('audio'); return; }
                if (error.status === 416 && !res.headersSent) {
                    res.setHeader('Content-Range', 'bytes */' + local.size_bytes);
                    res.status(416).end();
                } else fail();
            });
        }
        return;
    }
    const target = new URL('/v1/audio/' + audio_id, broker.config.base_url);
    upstream = (target.protocol === 'https:' ? https : http).request(target, {
        headers: {
            'X-API-Key': broker.config.api_key,
            ...(!playback && req.headers.range ? { Range: req.headers.range } : {}),
            ...(!playback && req.headers['if-range'] ? { 'If-Range': req.headers['if-range'] } : {}),
        },
    }, audio => {
        if (!(playback ? audio.statusCode === 200 : [200, 206, 416].includes(audio.statusCode)) ||
            audio.statusCode !== 416 && audio.headers['content-type']?.split(';')[0] !== 'audio/wav') {
            audio.resume(); fail();
            // A server restart/cleanup must not keep a stale completed reference forever.
            for (const entry of broker.entries.values()) {
                if (entry.audio_id === audio_id) { entry.status = 'unsubmitted'; entry.retry_at = 0; }
            }
            return;
        }
        audio.on('error', fail);
        audio.on('aborted', fail);
        if (playback) {
            const chunks = [];
            let size = 0;
            if (Number(audio.headers['content-length']) > MAX_PLAYBACK_BYTES) { fail(); upstream.destroy(); return; }
            audio.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_PLAYBACK_BYTES) { fail(); upstream.destroy(); }
                else chunks.push(chunk);
            });
            audio.on('end', () => {
                if (res.writableEnded || res.destroyed) return;
                try {
                    const body = compactWav(Buffer.concat(chunks), playback === 'words-v1');
                    const record = cachePlayback(cache, cacheKey, body);
                    headers(); playbackResponse(req, res, record);
                    broker.health?.clear('audio');
                } catch (error) { fail(error); }
            });
        } else {
            res.status(audio.statusCode);
            for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
                if (audio.headers[header]) res.setHeader(header, audio.headers[header]);
            }
            headers(); audio.pipe(res);
            audio.once('end', () => broker.health?.clear('audio'));
        }
    });
    upstream.on('error', fail);
    upstream.end();
};
