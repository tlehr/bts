'use strict';

const crypto = require('crypto');
const path = require('path');
const { fork } = require('child_process');
const { cleanString } = require('./sanitize');
const capture = require('./capture');
const short = (value, length = 200) => cleanString(typeof value === 'string' ? value : '', length);
const send = (ws, value) => { if (ws?.readyState === 1 && ws.bufferedAmount < 256 * 1024) { ws.send(JSON.stringify(value)); return true; } return false; };

class Diagnostics {
    constructor(app, version) {
        this.app = app; this.version = version;
        this.pages = new Map(); this.commands = new Map(); this.pending = new Map(); this.serial = 0;
        this.queue = []; this.dropped = 0; this.ready = false; this.closed = false; this.verbose_until = 0; this.store_error = null;
        this.directory = app.config.diagnostics?.directory || (app.db.tournaments.filename ? path.join(path.dirname(app.db.tournaments.filename), 'diagnostics') : null);
        this.start();
        this.unsubscribe = capture.subscribe({ verbose: () => this.verbose_until > Date.now(), record: entry => this.record({ source: 'server', ...entry }) });
        this.fatal = (error, origin) => { this.record({ source: 'server', level: 'error', message: 'Serverabbruch (' + origin + '): ' + cleanString(error?.stack || error, 7000) }); this.flush(); };
        this.warning = warning => this.record({ source: 'server', level: 'warn', message: cleanString(warning?.stack || warning, 7000) });
        process.on('uncaughtExceptionMonitor', this.fatal); process.on('warning', this.warning);
        this.tick = setInterval(() => this.maintain(), 15000); this.tick.unref();
        this.record({ level: 'info', source: 'server', message: 'BTS gestartet · Version ' + version });
    }

    start() {
        if (this.closed) return;
        const worker = fork(path.join(__dirname, 'store_process.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [], serialization: 'advanced' });
        this.worker = worker; worker.unref(); worker.channel?.unref();
        worker.on('message', message => {
            if (this.worker !== worker) return;
            if (message.type === 'ready') { this.ready = true; this.store_error = null; this.flush(); }
            else if (message.type === 'failure') { this.store_error = message.error; this.ready = false; }
            else if (message.type === 'reply') {
                const pending = this.pending.get(message.id);
                if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result); }
            }
        });
        const failure = error => {
            if (this.worker !== worker) return;
            this.worker = null; this.ready = false; this.store_error = short(error?.message || 'Logprozess beendet');
            for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('diagnostics_unavailable')); }
            this.pending.clear();
            if (!this.closed) { this.restart = setTimeout(() => this.start(), 1000); this.restart.unref(); }
        };
        worker.on('error', failure); worker.on('exit', () => failure(new Error('Logprozess beendet')));
        worker.send({ type: 'initialize', directory: this.directory });
    }

    record(entry) {
        if (this.closed) return;
        const row = { source: short(entry.source || 'server', 40), level: ['debug', 'info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info',
            message: short(entry.message, 8000), received_at: Date.now(), client_ts: Number.isFinite(entry.ts) ? entry.ts : null };
        for (const key of ['event_id', 'page_id', 'device_id', 'role', 'path', 'version', 'tournament_key', 'match_id', 'court_id', 'trace_id']) if (entry[key]) row[key] = short(entry[key], key === 'path' ? 500 : 200);
        if (this.queue.length >= 1000) { this.dropped++; return; }
        this.queue.push(row);
        if (!this.flush_task) this.flush_task = setImmediate(() => { this.flush_task = null; void require('../foreground_work').idle().then(() => this.flush()); });
    }

    flush() {
        if (!this.ready || !this.worker?.connected || !this.queue.length || this.sending) return;
        this.sending = true;
        const entries = this.queue.splice(0, 50);
        this.worker.send({ type: 'append', entries }, error => {
            this.sending = false;
            if (error) { this.dropped += entries.length; this.store_error = short(error.message); }
            if (this.queue.length && this.ready && !this.closed) setImmediate(() => this.flush());
        });
    }

    query(filter) {
        if (!this.ready || !this.worker?.connected || this.pending.size >= 16) return Promise.reject(new Error('diagnostics_unavailable'));
        return new Promise((resolve, reject) => {
            const id = ++this.serial, timer = setTimeout(() => { this.pending.delete(id); reject(new Error('diagnostics_timeout')); }, 4000);
            this.pending.set(id, { resolve, reject, timer });
            this.worker.send({ type: 'query', id, filter }, error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
        });
    }

    connect(ws) {
        ws.on('message', raw => {
            try {
                if (raw.length > 300000) throw new Error('message_too_large');
                const msg = JSON.parse(raw);
                if (!ws.diagnostics_page && msg.type !== 'hello') return ws.close(1008, 'hello required');
                if (msg.type === 'hello') this.register(ws, msg);
                else {
                    const page = ws.diagnostics_page;
                    page.last_seen = Date.now();
                    if (msg.type === 'heartbeat') this.metadata(page, msg);
                    else if (msg.type === 'bye') page.leaving = true;
                    else if (msg.type === 'logs') {
                        const now = Date.now();
                        if (now - (ws.log_window || 0) > 60000) { ws.log_window = now; ws.log_count = 0; }
                        if (!Array.isArray(msg.entries) || msg.entries.length > 10 || (ws.log_count += msg.entries.length) > 240 || raw.length > 32000) { page.dropped++; return; }
                        for (const entry of msg.entries) if (typeof entry?.message === 'string') this.record({ ...entry, source: page.role,
                            page_id: page.id, device_id: page.device_id, role: page.role, path: page.path, version: page.version,
                            tournament_key: page.tournament_key, match_id: short(entry.match_id) || page.match_id, court_id: page.court_id });
                        send(ws, { type: 'logs_ack', id: msg.batch_id });
                    } else if (msg.type === 'reload_status') this.status(page, msg);
                    else if (msg.type === 'reload_ready') void this.allowReload(page, msg).catch(() => this.wait(page, msg.id, 'Serverprüfung nicht verfügbar'));
                }
            } catch (_) { ws.close(1008, 'invalid diagnostics message'); }
        });
        ws.on('close', () => {
            const page = ws.diagnostics_page;
            if (!page || page.ws !== ws) return;
            page.online = false; page.last_seen = Date.now();
            const expected = page.leaving || [...this.commands.values()].some(command => command.targets.some(target => target.page_id === page.id && target.state === 'reloading'));
            this.record({ level: expected ? 'info' : 'warn', source: page.role, page_id: page.id, device_id: page.device_id, tournament_key: page.tournament_key,
                message: 'Seite getrennt · ' + page.path });
        });
    }

    register(ws, msg) {
        if (ws.diagnostics_page) return ws.close(1008, 'registration limit');
        const id = short(msg.page_id, 100), device = short(msg.device_id, 100);
        if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id) || !/^[a-zA-Z0-9_-]{8,100}$/.test(device)) return ws.close(1008, 'invalid identity');
        const existing = this.pages.get(id);
        if (!existing && this.pages.size >= 1000) return ws.close(1008, 'registration limit');
        if (existing?.online && existing.ws.readyState === 1 && existing.instance !== msg.instance && !msg.reload_ack) return send(ws, { type: 'identity_conflict' });
        const page = { id, device_id: device, instance: short(msg.instance, 100), address: short(ws._socket?.remoteAddress), ws, online: true, connected_at: Date.now(), last_seen: Date.now(), dropped: 0 };
        this.metadata(page, msg); this.pages.set(id, page); ws.diagnostics_page = page;
        for (const command of this.commands.values()) {
            const target = command.targets.find(target => target.page_id === id);
            if (target && target.instance !== page.instance && ['scheduled', 'waiting', 'reloading', 'disconnected'].includes(target.state)) {
                target.state = 'reconnected'; target.version = page.version; target.at = Date.now();
            }
        }
        send(ws, { type: 'registered', version: this.version, verbose_until: this.verbose_until });
        this.record({ level: 'info', source: page.role, page_id: id, device_id: device, tournament_key: page.tournament_key,
            message: 'Seite verbunden · ' + page.path + ' · Version ' + page.version });
    }

    metadata(page, msg) {
        for (const key of ['path', 'version', 'tournament_key', 'match_id', 'court_id', 'label']) page[key] = short(msg[key], key === 'path' ? 500 : 200);
        page.role = ['admin', 'display', 'umpire', 'client', 'speech-planning', 'diagnostics'].includes(msg.role) ? msg.role : 'client';
        page.client_dropped = Number.isSafeInteger(msg.dropped) && msg.dropped >= 0 ? msg.dropped : 0;
        page.last_seen = Date.now();
    }

    reload(scope, value) {
        if (!['page', 'device', 'role', 'tournament', 'all'].includes(scope) || typeof value !== 'string' || value.length > 200) throw new Error('invalid_reload_target');
        if ([...this.commands.values()].some(command => Date.now() - command.at < 1000)) throw new Error('reload_rate_limit');
        const pages = [...this.pages.values()].filter(page => scope === 'all' || page[scope === 'page' ? 'id' : scope === 'device' ? 'device_id' : scope === 'tournament' ? 'tournament_key' : 'role'] === value);
        const command = { id: crypto.randomUUID(), at: Date.now(), scope, value, expires_at: Date.now() + 600000, targets: [] };
        pages.forEach((page, index) => {
            for (const previous of this.commands.values()) for (const target of previous.targets) if (target.page_id === page.id && ['scheduled', 'waiting'].includes(target.state)) {
                target.state = 'cancelled'; send(page.ws, { type: 'reload_cancel', id: previous.id });
            }
            const target = { page_id: page.id, device_id: page.device_id, instance: page.instance, path: page.path,
                state: page.online ? 'scheduled' : 'unreachable', reason: page.online ? '' : 'Nicht verbunden', at: Date.now() };
            command.targets.push(target);
            if (page.online && !send(page.ws, { type: 'reload_prepare', id: command.id, delay_ms: index * 250, expires_at: command.expires_at })) {
                target.state = 'unreachable'; target.reason = 'Nicht erreichbar';
            }
        });
        this.commands.set(command.id, command);
        while (this.commands.size > 100) this.commands.delete(this.commands.keys().next().value);
        this.record({ source: 'control', level: 'info', message: 'Neuladen angefordert · ' + scope + ' ' + value + ' · ' + pages.length + ' Seiten', trace_id: command.id });
        return command;
    }

    target(page, id) {
        const command = this.commands.get(id);
        return command && command.expires_at > Date.now() ? command.targets.find(target => target.page_id === page.id && target.instance === page.instance) : null;
    }

    status(page, msg) {
        const target = this.target(page, msg.id);
        if (!target || !['scheduled', 'waiting', 'reloading'].includes(target.state)) return;
        if (['waiting', 'reloading'].includes(msg.state)) { target.state = msg.state; target.reason = short(msg.reason); target.at = Date.now(); }
    }

    wait(page, id, reason) {
        const target = this.target(page, id);
        if (!target || !['scheduled', 'waiting', 'reloading'].includes(target.state)) return;
        target.state = 'waiting'; target.reason = reason; target.at = Date.now();
        send(page.ws, { type: 'reload_wait', id, reason });
    }

    async allowReload(page, msg) {
        const target = this.target(page, msg.id);
        if (!target || !['scheduled', 'waiting'].includes(target.state)) return;
        if (page.guard_pending || Date.now() - (page.last_guard || 0) < 900) return;
        page.guard_pending = true; page.last_guard = Date.now();
        try {
            if (page.role === 'umpire' && !msg.guard?.idle || msg.guard?.match_id) {
                const guard = msg.guard;
                if (!guard?.match_id || typeof guard.presses_json !== 'string' || guard.presses_json.length > 250000) return this.wait(page, msg.id, 'Zähltablet: Spielstand noch nicht bestätigt');
                const match = await new Promise((resolve, reject) => this.app.db.matches.findOne({ _id: short(guard.match_id), tournament_key: page.tournament_key },
                    (error, match) => error ? reject(error) : resolve(match)));
                if (!match || match.setup?.now_on_court || !['finished'].includes(match.setup?.state) || JSON.stringify(match.presses || []) !== guard.presses_json) {
                    return this.wait(page, msg.id, 'Zähltablet: Spielabschluss noch nicht auf dem Server bestätigt');
                }
            }
            if (this.target(page, msg.id) !== target || !page.online || !['scheduled', 'waiting'].includes(target.state)) return;
            target.state = 'reloading'; target.reason = ''; target.at = Date.now();
            send(page.ws, { type: 'reload_go', id: msg.id, version: this.version });
        } finally { page.guard_pending = false; }
    }

    cancel(id) {
        const command = this.commands.get(id);
        if (!command) return;
        for (const target of command.targets) if (['scheduled', 'waiting'].includes(target.state)) {
            target.state = 'cancelled'; send(this.pages.get(target.page_id)?.ws, { type: 'reload_cancel', id });
        }
        this.record({ source: 'control', level: 'info', message: 'Ausstehendes Neuladen abgebrochen', trace_id: id });
    }

    verbose(enabled) {
        this.verbose_until = enabled ? Date.now() + 600000 : 0;
        this.app.speech?.send?.({ type: 'diagnostics_configuration', verbose_until: this.verbose_until });
        for (const page of this.pages.values()) if (page.online) send(page.ws, { type: 'configuration', verbose_until: this.verbose_until });
        this.record({ source: 'control', level: 'info', message: enabled ? 'Detailprotokoll für zehn Minuten aktiviert' : 'Detailprotokoll beendet' });
    }

    maintain() {
        const now = Date.now();
        for (const [id, page] of this.pages) {
            if (page.online && now - page.last_seen > 60000) { page.online = false; page.ws.terminate(); }
            if (!page.online && now - page.last_seen > 3600000) this.pages.delete(id);
        }
        for (const command of this.commands.values()) for (const target of command.targets) {
            if (command.expires_at < now && ['scheduled', 'waiting'].includes(target.state)) target.state = 'expired';
            if (target.state === 'reloading' && now - target.at > 30000) target.state = 'disconnected';
        }
    }

    snapshot() {
        this.maintain();
        return { version: this.version, verbose_until: this.verbose_until, store: { ready: this.ready, error: this.store_error, dropped: this.dropped, execution: 'process' },
            pages: [...this.pages.values()].map(page => Object.fromEntries(Object.entries(page).filter(([key]) => !['ws', 'instance', 'guard_pending', 'last_guard'].includes(key)))),
            commands: [...this.commands.values()].slice(-10).reverse(), now: Date.now() };
    }

    close() {
        this.closed = true; this.unsubscribe?.(); process.removeListener('uncaughtExceptionMonitor', this.fatal); process.removeListener('warning', this.warning);
        clearInterval(this.tick); clearTimeout(this.restart); clearImmediate(this.flush_task);
        if (this.worker?.connected) {
            if (this.queue.length) this.worker.send({ type: 'append', entries: this.queue.splice(0) });
            this.worker.send({ type: 'close' });
            const worker = this.worker; const timer = setTimeout(() => worker.kill(), 2000); timer.unref(); worker.once('exit', () => clearTimeout(timer));
        }
    }
}

async function handle(app, ws, msg) {
    const reply = value => (ws.respond_background || ws.respond).call(ws, msg, null, value);
    try {
        const hub = app.diagnostics;
        if (!hub) throw new Error('diagnostics_unavailable');
        if (msg.type === 'diagnostics_snapshot') return reply({ diagnostics: hub.snapshot() });
        if (msg.type === 'diagnostics_logs') {
            const input = msg.filter || {}, filter = {};
            if (typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_log_filter');
            for (const field of ['search', 'source', 'level', 'page_id', 'tournament_key', 'match_id', 'export_id']) if (input[field] !== undefined) {
                if (typeof input[field] !== 'string' || input[field].length > 200) throw new Error('invalid_log_filter');
                filter[field] = input[field];
            }
            for (const field of ['since', 'until', 'cursor', 'limit', 'export_offset']) if (input[field] != null) {
                if (!Number.isFinite(input[field]) || input[field] < 0) throw new Error('invalid_log_filter');
                filter[field] = input[field];
            }
            if (input.export !== undefined) { if (typeof input.export !== 'boolean') throw new Error('invalid_log_filter'); filter.export = input.export; }
            if (Date.now() - (ws.diagnostics_query_last || 0) < 200) throw new Error('diagnostics_rate_limit');
            ws.diagnostics_query_last = Date.now();
            return reply({ logs: await hub.query(filter) });
        }
        if (msg.type === 'diagnostics_reload') return reply({ command: hub.reload(msg.scope, msg.value || '') });
        if (msg.type === 'diagnostics_cancel') { hub.cancel(short(msg.id)); return reply({ ok: true }); }
        if (msg.type === 'diagnostics_verbose') { hub.verbose(msg.enabled === true); return reply({ ok: true }); }
    } catch (error) { reply({ diagnostics_error: short(error.message) }); }
}
module.exports = { Diagnostics, handle };
