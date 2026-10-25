'use strict';

function connectionIssue(source, code, endpoint) {
    if (!source.startsWith('upstream_')) return null;
    const reasons = {
        ECONNREFUSED: 'Die Verbindung wird abgelehnt; der Sprachserver ist möglicherweise nicht gestartet.',
        ENOTFOUND: 'Die Adresse des Sprachservers kann nicht aufgelöst werden.',
        EAI_AGAIN: 'Die Adresse des Sprachservers kann derzeit nicht aufgelöst werden.',
        ETIMEDOUT: 'Der Sprachserver antwortet nicht rechtzeitig.',
        speech_timeout: 'Der Sprachserver antwortet nicht rechtzeitig.',
        ECONNRESET: 'Die Verbindung zum Sprachserver wurde unterbrochen.',
        EHOSTUNREACH: 'Der Sprachserver ist über das Netzwerk nicht erreichbar.',
        ENETUNREACH: 'Der Sprachserver ist über das Netzwerk nicht erreichbar.',
    };
    if (!Object.hasOwn(reasons, code)) return null;
    let address, local = false;
    try {
        const url = new URL(endpoint);
        if (['http:', 'https:'].includes(url.protocol)) {
            address = url.origin;
            local = ['localhost', '[::1]'].includes(url.hostname) || /^127\./.test(url.hostname);
        }
    } catch (_) { /* Do not expose raw URLs or request messages. */ }
    return { kind: 'upstream_connection', endpoint: address, message: reasons[code], action: local ?
        'Den Sprachserver auf dem BTS-Rechner separat starten und Adresse sowie Port prüfen. „make dev“ startet nur BTS.' :
        'Bitte prüfen, ob der Sprachserver läuft und seine Adresse, der Port und die Netzwerkverbindung stimmen.' };
}
function logKey(issue) { return issue.kind === 'upstream_connection' ? 'upstream_connection:' + (issue.endpoint || '') : issue.source; }

// Speech failures must never escape into tournament work, including failures
// while reporting them. Only small status records cross the worker boundary.
class SpeechHealth {
    constructor(app = {}, now = Date.now) {
        this.app = app;
        this.now = now;
        this.issues = new Map();
        this.logged = new Map();
    }

    fail(source, error, retrying = true, context = {}) {
        const code = String(error?.response?.error?.code || error?.code || error?.message || 'speech_unavailable').slice(0, 240);
        const connection = connectionIssue(source, code, context.endpoint);
        const message = connection?.message || String(error?.message || error || 'speech_unavailable').slice(0, 240);
        const signature = JSON.stringify([code, message, error?.status]);
        const key = logKey({ source, ...connection });
        const previous = this.logged.get(key), now = this.now();
        if (!previous || previous.signature !== signature || now - previous.at >= 30000) {
            this.logged.set(key, { signature, at: now });
            if (connection) {
                console.error('[bts speech] Sprachserver nicht erreichbar' + (connection.endpoint ? ' (' + connection.endpoint + ')' : '') + // eslint-disable-line no-console
                    ': ' + message + ' ' + connection.action + (retrying ? ' BTS versucht die Verbindung automatisch erneut.' : '') + ' [' + code + ']');
            } else {
                console.error('[bts speech] ' + source + ': ' + code + (error?.status ? ' (HTTP ' + error.status + ')' : ''), error?.stack || message); // eslint-disable-line no-console
            }
        }
        const old = this.issues.get(source);
        if (old?.code === code && old.message === message && old.retrying === retrying && old.endpoint === connection?.endpoint) return;
        this.issues.set(source, { source, code, message, retrying, since: now, ...connection });
        this.publish();
    }

    clear(source) {
        this.logged.delete(source);
        const old = this.issues.get(source);
        if (!this.issues.delete(source)) return;
        if (old.kind === 'upstream_connection' && ![...this.issues.values()].some(issue => logKey(issue) === logKey(old))) this.logged.delete(logKey(old));
        this.publish();
    }

    adopt(snapshot) {
        const next = new Map([...this.issues].filter(([source]) => !source.startsWith('remote/')));
        for (const issue of (snapshot?.issues || []).slice(0, 16)) {
            const source = 'remote/' + issue.source;
            next.set(source, { ...issue, source });
        }
        if (JSON.stringify([...next]) === JSON.stringify([...this.issues])) return;
        this.issues = next;
        this.publish();
    }

    snapshot() { return { state: this.issues.size ? 'error' : 'ok', issues: [...this.issues.values()] }; }

    send(ws) {
        if (!ws.speech_health_subscribed) return;
        try { ws.sendmsg({ type: 'speech_health', health: this.snapshot() }); }
        catch (_) { /* A closed admin window cannot break speech or the server. */ }
    }

    publish() {
        try { this.on_change?.(this.snapshot()); } catch (_) { /* Status reporting is optional. */ }
        for (const ws of this.app.wss?.clients || []) if (ws.speech_health_subscribed) this.send(ws);
    }
}

module.exports = { SpeechHealth, health: app => app.speech_health || (app.speech_health = new SpeechHealth(app)) };
