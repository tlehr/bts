'use strict';

const http = require('http');
const https = require('https');

function request(base, api_key, method, pathname, body, timeout_ms = 2500, headers = {}) {
    const target = new URL(pathname, base);
    const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
        const transport = target.protocol === 'https:' ? https : http;
        const req = transport.request(target, {
            method,
            headers: {
                'X-API-Key': api_key,
                Accept: 'application/json',
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
                ...headers,
            },
        }, res => {
            const chunks = [];
            let length = 0;
            res.on('data', chunk => {
                length += chunk.length;
                if (length > 1048576) req.destroy(new Error('speech_response_limit'));
                else chunks.push(chunk);
            });
            res.on('error', reject);
            res.on('end', () => {
                if (![200, 202].includes(res.statusCode)) {
                    const error = new Error('speech_http_error');
                    error.status = res.statusCode;
                    try { error.response = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
                    catch (_) { /* Non-JSON upstream failures are reported generically. */ }
                    reject(error);
                    return;
                }
                try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                catch (_) { reject(new Error('speech_invalid_response')); }
            });
        });
        // Includes DNS/connect/body; socket inactivity alone is not a total timeout.
        const timeout = setTimeout(() => req.destroy(new Error('speech_timeout')), timeout_ms);
        req.on('close', () => clearTimeout(timeout));
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

module.exports = { request };
