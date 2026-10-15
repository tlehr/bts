/* exported createSpeechQueue */
'use strict';

function createSpeechQueue({ root, service }) {
    const document = root.ownerDocument;
    const rows = new Map();
    const priorities = { high: 'Hoch · aktueller Aufruf', normal: 'Normal · bevorstehendes Spiel', low: 'Niedrig · Vorrat' };
    let running = null, stopped = false, playing = false, available = false, version;
    function element(parent, tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        parent.appendChild(node);
        return node;
    }
    element(root, 'h3', '', 'Texte und Reihenfolge');
    element(root, 'p', 'speech_queue_help',
        'Für die ausgewählte Stimme dieses Turniers. Laufender Auftrag zuerst, danach die nächsten Texte; fertige Aufnahmen stehen unten. Nummern gelten für die gemeinsame Warteschlange.');
    const summary = element(root, 'p', 'speech_queue_summary', 'Warteschlange wird geladen …');
    summary.setAttribute('aria-live', 'polite');
    const list = element(root, 'ol', 'speech_queue_list');
    list.setAttribute('aria-label', 'Sprachtexte in Abarbeitungsreihenfolge');
    const feedback = element(root, 'p', 'speech_queue_feedback');
    feedback.setAttribute('aria-live', 'polite');

    function buttons() {
        for (const row of rows.values()) {
            row.button.disabled = !available || playing || row.item.status !== 'completed' || !row.item.audio_url;
        }
    }

    function status(item) {
        if (item.current) return item.status === 'processing' ? 'Wird erzeugt' :
            item.status === 'queued' ? 'Beim Sprachserver' : 'Wird übermittelt / geprüft';
        if (item.status === 'completed') return 'Fertig';
        if (item.status === 'failed') return 'Generierung fehlgeschlagen';
        if (item.retry_at > Date.now()) return 'Wartet auf erneuten Versuch';
        return 'Im BTS vorgemerkt';
    }

    function rowFor(item) {
        let row = rows.get(item.key);
        if (row) return row;
        const node = element(list, 'li', 'speech_queue_row');
        const order = element(node, 'span', 'speech_queue_order');
        const content = element(node, 'div', 'speech_queue_content');
        const text = element(content, 'div', 'speech_queue_text');
        const meta = element(content, 'div', 'speech_queue_meta');
        const button = element(node, 'button', 'speech_queue_preview', '🔊');
        button.type = 'button';
        row = { node, order, text, meta, button, item };
        rows.set(item.key, row);
        button.addEventListener('click', async () => {
            if (button.disabled) return;
            playing = true;
            buttons();
            feedback.textContent = 'Lokale Aufnahme wird abgespielt …';
            const result = await service.preview(row.item, version);
            if (stopped) return;
            playing = false;
            feedback.textContent = result.status === 'ok' ? 'Aufnahme abgespielt.' :
                result.status === 'busy' ? 'Gerade läuft eine Durchsage. Danach erneut probehören.' :
                result.status === 'cancelled' ? 'Probehören beendet.' :
                result.reason === 'audio_blocked' ? 'Audiowiedergabe gesperrt. Bitte Audio aktivieren.' :
                'Lokale Aufnahme nicht verfügbar. Cache-Status aktualisieren und erneut versuchen.';
            buttons();
        });
        return row;
    }

    async function load() {
        const response = await service.queue();
        if (stopped || !root.isConnected) { stop(); return; }
        available = !!response?.queue && !response.speech_error && response.speech?.enabled !== false;
        if (!available) {
            summary.textContent = response?.speech?.enabled === false ? 'Lokale Sprache ist nicht eingerichtet.' :
                'Warteschlange derzeit nicht verfügbar. Cache-Status aktualisieren oder kurz warten.';
            buttons();
            return;
        }
        version = response.speech.cache_version;
        const items = response.queue.items;
        const ready = items.filter(item => item.status === 'completed').length;
        summary.textContent = items.length ? items.length + ' Texte · ' + ready + ' fertig · ' +
            (items.length - ready) + ' offen' + (response.queue.busy_elsewhere ?
                ' · Ein bereits laufender anderer Auftrag wird noch abgeschlossen.' : '') : 'Noch keine Texte vorgemerkt.';
        const used = new Set(items.map(item => item.key));
        for (const [key, row] of rows) {
            if (!used.has(key)) { row.node.remove(); rows.delete(key); }
        }
        items.forEach((item, index) => {
            const row = rowFor(item);
            row.item = item;
            row.node.dataset.key = item.key;
            row.node.dataset.status = item.status;
            row.node.dataset.priority = item.priority;
            row.node.classList.toggle('speech_queue_current', item.current);
            row.order.textContent = item.current ? '▶' : item.position === null ?
                (item.status === 'completed' ? '✓' : '–') : String(item.position);
            row.order.title = item.current ? 'Laufender Auftrag' : item.position === null ? '' : 'Platz in der Warteschlange';
            row.text.textContent = item.text;
            const voice = item.voice === 'hallensprecher' ? 'Hallensprecher' : 'Hallensprecherin';
            row.meta.textContent = voice + ' · ' + priorities[item.priority] + ' · ' + status(item);
            row.button.setAttribute('aria-label', 'Probehören: ' + voice + ' – ' + item.text);
            row.button.title = item.status === 'completed' ? 'Lokale Aufnahme probehören (' + voice + ')' :
                'Probehören ist nach der Generierung verfügbar.';
            // Keep existing nodes and focus when only status or signed URLs change.
            if (list.children[index] !== row.node) list.insertBefore(row.node, list.children[index] || null);
        });
        buttons();
    }

    function refresh() {
        if (stopped) return Promise.resolve();
        if (!root.isConnected) { stop(); return Promise.resolve(); }
        if (!running) running = load().finally(() => { running = null; });
        return running;
    }
    function stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        observer.disconnect();
        if (playing) service.cancelPreview();
    }
    const observer = new MutationObserver(() => { if (!root.isConnected) stop(); });
    observer.observe(root.closest('.main') || document.body, { childList: true, subtree: true });
    const timer = setInterval(() => {
        if (!root.isConnected) stop();
        else if (!document.hidden) void refresh();
    }, 3000);
    void refresh();
    return { refresh, stop };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createSpeechQueue;
