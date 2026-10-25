'use strict';

const express = require('express');
const bearer = req => /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
function routes(app, pool) {
    const router = express.Router();
    router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
    const wrap = handler => (req, res, next) => Promise.resolve().then(() => pool.ready).then(() => handler(req, res)).catch(next);
    const json = express.json({ limit: '8kb', strict: true });
    router.post('/register', json, wrap(async (req, res) => res.json(await pool.register(bearer(req), req.body))));
    router.post('/claim', json, wrap(async (req, res) => res.json(await pool.claim(bearer(req)))));
    router.post('/resources', json, wrap(async (req, res) => res.json(await pool.resources(bearer(req), req.body))));
    router.post('/jobs/:id/heartbeat', json, wrap(async (req, res) => res.json(await pool.heartbeat(bearer(req), req.params.id, req.body.lease))));
    router.post('/jobs/:id/fail', json, wrap(async (req, res) => res.json(await pool.fail(bearer(req), req.params.id, req.body.lease, req.body.code))));
    router.get('/runtime', wrap(async (req, res) => {
        const artifact = await pool.asset(bearer(req));
        res.setHeader('ETag', '"' + artifact.sha256 + '"');
        res.sendFile(artifact.path, { dotfiles: 'deny', cacheControl: false });
    }));
    // Authenticate before accepting potentially large WAV bodies.
    router.post('/jobs/:id/result', (req, res, next) => {
        pool.ready.then(() => { pool.worker(bearer(req)); next(); }).catch(next);
    }, express.raw({ type: 'audio/wav', limit: '16mb' }), wrap(async (req, res) => {
        res.json(await pool.complete(bearer(req), req.params.id, req.headers['x-helper-lease'], req.body, Number(req.headers['x-elapsed-ms'])));
    }));
    router.get('/audio/:id', wrap(async (req, res) => {
        const filename = await pool.audio(req.params.id, req.query.expires, req.query.grant);
        res.type('audio/wav'); res.sendFile(filename, { cacheControl: false });
    }));
    router.use((error, _req, res, _next) => { // eslint-disable-line no-unused-vars
        if (!res.headersSent) res.status(error.status || 503).json({ error: error.helper_error ? error.message : 'helper_unavailable' });
    });
    app.use('/speech-helper/v1', router);
}
module.exports = { routes };
