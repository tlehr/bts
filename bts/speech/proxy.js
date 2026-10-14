'use strict';

const http = require('http');
const https = require('https');

module.exports = function audio_proxy(req, res) {
    const broker = req.app.speech?.broker;
    const { tournament_key, audio_id } = req.params;
    if (!broker?.authorize(tournament_key, audio_id, req.query.expires, req.query.signature)) {
        res.status(401).json({ error: 'invalid_audio_grant' });
        return;
    }
    if (broker.audio_clients >= broker.config.max_audio_clients) {
        res.status(503).json({ error: 'audio_proxy_busy' });
        return;
    }
    broker.audio_clients++;
    const target = new URL('/v1/audio/' + audio_id, broker.config.base_url);
    const upstream = (target.protocol === 'https:' ? https : http).request(target, {
        headers: {
            'X-API-Key': broker.config.api_key,
            ...(req.headers.range ? { Range: req.headers.range } : {}),
            ...(req.headers['if-range'] ? { 'If-Range': req.headers['if-range'] } : {}),
        },
    }, audio => {
        if (![200, 206, 416].includes(audio.statusCode) ||
            audio.statusCode !== 416 && audio.headers['content-type']?.split(';')[0] !== 'audio/wav') {
            audio.resume();
            res.status(503).json({ error: 'audio_unavailable' });
            // A server restart/cleanup must not keep a stale completed reference forever.
            for (const entry of broker.entries.values()) {
                if (entry.audio_id === audio_id) { entry.status = 'unsubmitted'; entry.retry_at = 0; }
            }
            return;
        }
        res.status(audio.statusCode);
        for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
            if (audio.headers[header]) res.setHeader(header, audio.headers[header]);
        }
        const seconds = Math.max(0, Number(req.query.expires) - Math.floor(broker.now() / 1000));
        res.setHeader('Cache-Control', 'private, max-age=' + seconds + ', immutable');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        audio.on('error', () => res.destroy());
        audio.pipe(res);
    });
    const timer = setTimeout(() => upstream.destroy(), broker.config.audio_timeout_ms);
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        clearTimeout(timer);
        broker.audio_clients--;
    };
    res.on('close', () => { release(); if (!res.writableEnded) upstream.destroy(); });
    res.on('finish', release);
    upstream.on('error', () => {
        if (!res.headersSent) res.status(503).json({ error: 'audio_unavailable' });
        else res.destroy();
        release();
    });
    upstream.end();
};
