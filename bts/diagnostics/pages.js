'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../..');
function buildVersion(config) {
    const versions = [];
    for (const directory of ['static/js', 'static/css', path.join(config.bup_location || 'static/bup/dev', 'js')]) try {
        for (const name of fs.readdirSync(path.resolve(root, directory)).sort()) if (/\.(?:js|css)$/.test(name)) {
            const stat = fs.statSync(path.resolve(root, directory, name)); versions.push([directory, name, stat.size, stat.mtimeMs]);
        }
    } catch (_) { /* An optional BUP directory does not block startup. */ }
    return crypto.createHash('sha256').update(JSON.stringify(versions)).digest('hex').slice(0, 12);
}
function html(content, version) {
    const script = '<script src="/static/js/diagnostics_client.js?v=' + version + '" data-bts-version="' + version + '"></script>';
    return content.replace(/<head([^>]*)>/i, '<head$1>' + script)
        .replace(/\b(src|href)="([^"?#]+\.(?:js|css))(\?[^"#]*)?"/gi, (all, attribute, file, query) =>
            /^(?:https?:|\/\/)/i.test(file) || file.includes('diagnostics_client.js') ? all : attribute + '="' + file + (query ? query + '&' : '?') + 'v=' + version + '"');
}
function bup(directory, index) {
    return (req, res, next) => {
        if (!req.app.diagnostics || !['GET', 'HEAD'].includes(req.method) || !['/', '/index.html', '/bup.html'].includes(req.path)) return next();
        const name = req.path === '/' ? index || 'index.html' : req.path.slice(1);
        fs.readFile(path.resolve(directory, name), 'utf8', (error, content) => {
            if (error) return next();
            res.set('Cache-Control', 'no-store'); res.type('html').send(html(content, req.app.diagnostics.version));
        });
    };
}
module.exports = { buildVersion, html, bup };
