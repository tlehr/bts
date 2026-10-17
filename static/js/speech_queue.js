/* exported createSpeechQueue */
'use strict';

function createSpeechQueue({ root, service, onSnapshot = () => {} }) {
    const document = root.ownerDocument;
    const window = document.defaultView;
    const rows = new Map();
    const recordings = new Map();
    const coverage_rows = new Map();
    const bar_segments = new WeakMap();
    const coverage_states = [
        ['stock', 'Vorrat im Cache'], ['cached', 'Benötigt · aus Cache'], ['generated', 'Benötigt · neu erzeugt'],
        ['ordered', 'Beauftragt'], ['potential', 'Noch ohne Auftrag'],
    ];
    let next_recording = 1;
    const priorities = { high: 'Hoch · aktueller Aufruf', normal: 'Normal · bevorstehendes Spiel', low: 'Niedrig · Vorrat',
        idle: 'Nur bei Leerlauf · mögliche spätere Ansage' };
    const operation = item => item.operation || (['source', 'text'].includes(item.kind || 'text') ? 'synthesis' :
        item.kind === 'game' ? 'processing' : 'excerpt');
    const operation_labels = { synthesis: 'Sprachaufnahme erzeugen', excerpt: 'Aus Aufnahme ausschneiden', processing: 'Aufnahme aufbereiten' };
    const partLabel = item => ({ field_start: 'Feldanfang', field_end: 'Feldende', game: 'Spielblock', team: 'Team',
        prep_prefix: 'Vorbereitungspräfix', board_long: 'Klapptafel-Aufruf', hall: 'Hallenzusatz' })[item.kind] ||
        (item.excerpt_position === 'start' ? 'Anfang' : item.excerpt_position === 'end' ? 'Ende' : 'Ausschnitt');
    function recordingLabel(key) {
        if (!recordings.has(key)) recordings.set(key, 'Aufnahme A' + next_recording++);
        return recordings.get(key);
    }
    let running = null, stopped = false, playing = false, available = false, version;
    let refresh_timer = null, refresh_again = false, last_refresh = -Infinity;
    function element(parent, tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        parent.appendChild(node);
        return node;
    }
    element(root, 'h3', '', 'Texte und Reihenfolge');
    element(root, 'p', 'speech_queue_help',
        'Vollständige Sprachaufnahmen werden einmal erzeugt und wiederverwendet. Ausschnitte und Aufbereitung verwenden diese Aufnahmen. ' +
        'BTS setzt die fertigen Bausteine beim Aufruf zusammen.');
    element(root, 'p', 'speech_queue_help',
        'Die Liste zeigt den aktuellen Bedarf und begonnene Leerlauf-Vorbereitung dieses Turniers. ' +
        'Zusätzliche mögliche Ansagen werden nur vorbereitet, wenn alle regulären Aufträge erledigt sind. ' +
        'Nicht mehr benötigte Aufträge entfallen; fertige Aufnahmen bleiben gespeichert. ' +
        'Laufender Auftrag zuerst; fertige stehen unten. Nummern links zeigen die Reihenfolge. A-Nummern verknüpfen Bausteine mit ihrer Aufnahme.');
    const summary = element(root, 'p', 'speech_queue_summary', 'Warteschlange wird geladen …');
    summary.setAttribute('aria-live', 'polite');
    const breakdown = element(root, 'div', 'speech_queue_breakdown');
    breakdown.hidden = true;
    const synthesis_counts = element(breakdown, 'p', 'speech_queue_synthesis_counts');
    const processing_counts = element(breakdown, 'p', 'speech_queue_processing_counts');
    const progress_container = element(root, 'div', 'speech_queue_progress_container');
    progress_container.hidden = true;
    const progress_title = element(progress_container, 'strong', 'speech_coverage_title');
    const progress = element(progress_container, 'div', 'speech_queue_progress speech_coverage_bar');
    const progress_counts = element(progress_container, 'div', 'speech_coverage_counts');
    const progress_failure = element(progress_container, 'div', 'speech_coverage_failure');
    const progress_label = element(progress_container, 'div', 'speech_queue_progress_label');
    const coverage_legend = element(progress_container, 'div', 'speech_coverage_legend');
    for (const [state, label] of coverage_states) {
        const item = element(coverage_legend, 'span');
        const swatch = element(item, 'span', 'speech_coverage_swatch');
        swatch.dataset.coverageState = state;
        swatch.setAttribute('aria-hidden', 'true');
        element(item, 'span', '', label);
    }
    const cache_status = element(root, 'p', 'speech_queue_cache_status speech_queue_help');
    cache_status.hidden = true;
    const coverage_details = element(root, 'details', 'speech_coverage_details');
    coverage_details.open = true;
    coverage_details.hidden = true;
    element(coverage_details, 'summary', '', 'Vorbereitung nach Aufrufart');
    element(coverage_details, 'p', 'speech_queue_help',
        'Grau umfasst auch Spiele mit unbekannten Teilnehmern und mögliche Bediener aus allen Disziplinen. ' +
        'Bei Leerlauf werden zuerst wahrscheinliche nächste Tabletbediener, dann weitere Teams laufender Disziplinen und bekannte Offizielle vorbereitet. ' +
        'Unbekannte Teilnehmer bleiben ohne Auftrag. Fertiger Leerlauf-Vorrat erscheint blau. ' +
        'Die Balken zählen wiederverwendbare Bausteine und noch unbekannte Spiele. ' +
        'Gemeinsame Bausteine erscheinen bei mehreren Aufrufarten und im Gesamtbalken nur einmal.');
    const coverage_list = element(coverage_details, 'div', 'speech_coverage_list');
    const list = element(root, 'ol', 'speech_queue_list');
    list.setAttribute('aria-label', 'Sprachaufnahmen und Verarbeitung in Abarbeitungsreihenfolge');
    const feedback = element(root, 'p', 'speech_queue_feedback');
    feedback.setAttribute('aria-live', 'polite');

    function paintBar(bar, counts, label, caption, failure) {
        const signature = JSON.stringify(counts);
        if (bar.dataset.signature === signature) return;
        bar.dataset.signature = signature;
        let segments = bar_segments.get(bar);
        if (!segments) {
            segments = new Map();
            for (const [state] of coverage_states) {
                const segment = element(bar, 'span', 'speech_coverage_segment');
                segment.dataset.coverageState = state;
                segment.setAttribute('aria-hidden', 'true');
                segments.set(state, segment);
            }
            bar_segments.set(bar, segments);
        }
        const detail = coverage_states.map(([state, text]) => text + ': ' + counts[state]).join(' · ');
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', label + ' · ' + detail);
        bar.dataset.ready = counts.cached + counts.generated;
        bar.dataset.needed = counts.cached + counts.generated + counts.ordered;
        for (const [state, text] of coverage_states) {
            const segment = segments.get(state);
            segment.hidden = !counts[state];
            segment.style.width = (counts[state] * 100 / (counts.total || 1)) + '%';
            segment.title = text + ': ' + counts[state];
        }
        caption.textContent = counts.total ? detail : 'Noch keine Bausteine oder Personen bekannt.';
        failure.hidden = !counts.failed;
        failure.textContent = counts.failed ? counts.failed + ' beauftragte Bausteine fehlgeschlagen' : '';
    }

    function paintCoverage(coverage, fallback) {
        const total = coverage?.total || fallback;
        progress_title.textContent = coverage ? 'Gesamt · eindeutige Bausteine und Potenzial' : 'Aktuelle Aufträge';
        paintBar(progress, total, progress_title.textContent, progress_counts, progress_failure);
        const ready = total.cached + total.generated, needed = ready + total.ordered;
        progress_label.textContent = coverage?.verifying ? 'Gespeicherter Bestand wird geprüft …' :
            'Aktuell benötigt: ' + ready + ' von ' + needed + ' Bausteinen bereit' + (needed ? ' · ' + Math.floor(ready * 100 / needed) + ' %' : '');
        progress_container.hidden = !total.total;
        coverage_details.hidden = !coverage;
        if (!coverage) return;
        const used = new Set();
        for (const group of coverage.groups) {
            used.add(group.id);
            let row = coverage_rows.get(group.id);
            if (!row) {
                const node = element(coverage_list, 'div', 'speech_coverage_row');
                node.dataset.coverageGroup = group.id;
                const title = element(node, 'strong', 'speech_coverage_title');
                const bar = element(node, 'div', 'speech_coverage_bar');
                const counts = element(node, 'div', 'speech_coverage_counts');
                const failure = element(node, 'div', 'speech_coverage_failure');
                row = { node, title, bar, counts, failure };
                coverage_rows.set(group.id, row);
            }
            row.title.textContent = group.id === 'other' ? group.label : group.id + ' · ' + group.label;
            paintBar(row.bar, group, row.title.textContent, row.counts, row.failure);
        }
        for (const [id, row] of coverage_rows) if (!used.has(id)) { row.node.remove(); coverage_rows.delete(id); }
    }

    function buttons() {
        for (const row of rows.values()) {
            row.button.disabled = !available || playing || row.item.status !== 'completed' || !row.item.audio_url;
        }
    }

    function status(item, source) {
        const type = operation(item);
        if (item.current) return item.status === 'processing' ? {
            synthesis: 'Sprachaufnahme wird erzeugt', excerpt: 'Wird ausgeschnitten', processing: 'Wird aufbereitet',
        }[type] :
            item.status === 'queued' ? 'Beim Sprachserver' : 'Wird übermittelt / geprüft';
        if (item.status === 'completed') return 'Fertig';
        if (item.status === 'failed') return item.terminal_failure ? 'Auch Einzelaufnahme fehlgeschlagen; automatische Versuche beendet' :
            type === 'synthesis' ? 'Sprachaufnahme fehlgeschlagen' : 'Verarbeitung fehlgeschlagen';
        if (source && source.status !== 'completed') return 'Wartet auf ' + recordingLabel(source.key) +
            (source.status === 'failed' ? ' (fehlgeschlagen)' : '');
        if (item.retry_at > Date.now()) return 'Wartet auf erneuten Versuch';
        return 'Im BTS vorgemerkt';
    }

    function rowFor(item) {
        let row = rows.get(item.key);
        if (row) return row;
        const node = element(list, 'li', 'speech_queue_row');
        node.id = 'speech-queue-' + item.key;
        node.tabIndex = -1;
        const order = element(node, 'span', 'speech_queue_order');
        const content = element(node, 'div', 'speech_queue_content');
        const action = element(content, 'span', 'speech_queue_action');
        const purpose = element(content, 'strong', 'speech_queue_purpose');
        const explanation = element(content, 'div', 'speech_queue_explanation');
        const text = element(content, 'div', 'speech_queue_text');
        const source_info = element(content, 'div', 'speech_queue_source');
        const source_link = element(source_info, 'a', 'speech_queue_source_link');
        const source_details = element(source_info, 'details', 'speech_queue_source_details');
        element(source_details, 'summary', '', 'Schnitt im Originaltext anzeigen');
        const source_text = element(source_details, 'p', 'speech_queue_source_text');
        const before = element(source_text, 'span');
        const selected = element(source_text, 'mark');
        const after = element(source_text, 'span');
        const results = element(content, 'details', 'speech_queue_results');
        const results_summary = element(results, 'summary');
        const results_list = element(results, 'ul');
        const meta = element(content, 'div', 'speech_queue_meta');
        const button = element(node, 'button', 'speech_queue_preview', '🔊');
        button.type = 'button';
        row = { node, order, action, purpose, explanation, text, source_info, source_link, source_details,
            before, selected, after, results, results_summary, results_list, meta, button, item };
        rows.set(item.key, row);
        source_link.addEventListener('click', event => {
            event.preventDefault();
            const source = rows.get(row.item.source_key);
            if (!source) return;
            source.node.scrollIntoView({ block: 'nearest' });
            source.node.focus({ preventScroll: true });
        });
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
                result.reason === 'audio_blocked' ? 'Browser-Audio gesperrt. Bitte einmal im BTS klicken oder eine Taste drücken.' :
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
            progress_container.hidden = true;
            breakdown.hidden = true;
            coverage_details.hidden = true;
            cache_status.hidden = true;
            summary.textContent = response?.speech?.enabled === false ? 'Lokale Sprache ist nicht eingerichtet.' :
                'Warteschlange derzeit nicht verfügbar. Cache-Status aktualisieren oder kurz warten.';
            onSnapshot(response, null);
            buttons();
            return;
        }
        version = response.speech.cache_version;
        const items = response.queue.items;
        const by_key = new Map(items.map(item => [item.key, item]));
        const children = new Map();
        for (const item of items) {
            if (operation(item) === 'synthesis') recordingLabel(item.key);
            if (item.source_key) {
                if (!children.has(item.source_key)) children.set(item.source_key, []);
                children.get(item.source_key).push(item);
            }
        }
        const needed = items.filter(item => !item.idle), idle = items.filter(item => item.idle);
        const ready = needed.filter(item => item.status === 'completed').length;
        const failed = needed.filter(item => item.status === 'failed').length;
        const fields = needed.filter(item => item.source_usage?.type === 'field').length;
        const games = needed.filter(item => item.source_usage?.type === 'game').length;
        const counts = { total: needed.length, ready, failed, preparing: needed.length - ready - failed,
            saved: needed.filter(item => item.status === 'completed' && item.local).length };
        const summary_text = (needed.length ? 'Aktuell benötigt: ' + needed.length + ' Aufträge · ' + ready + ' bereit · ' +
            counts.preparing + ' offen' + (failed ? ' · ' + failed + ' fehlgeschlagen' : '') +
            (fields || games ? ' · ' + fields + ' Feldreferenzen · ' + games + ' Spielblöcke' : '') : 'Aktuell keine Aufträge benötigt.') +
            (idle.length ? ' · Leerlauf-Vorrat: ' + idle.filter(item => item.status === 'completed').length + ' bereit, ' +
                idle.filter(item => item.status !== 'completed').length + ' offen' : '') +
            (response.queue.busy_elsewhere ?
                ' · Ein bereits laufender anderer Auftrag wird noch abgeschlossen.' : '');
        if (summary.textContent !== summary_text) summary.textContent = summary_text;
        breakdown.hidden = !items.length;
        const countLabel = values => values.length + ' gesamt · ' + values.filter(item => item.status === 'completed').length + ' fertig';
        synthesis_counts.textContent = 'Sprachaufnahmen: ' + countLabel(items.filter(item => operation(item) === 'synthesis'));
        processing_counts.textContent = 'Ausschneiden / Aufbereiten: ' + countLabel(items.filter(item => operation(item) !== 'synthesis'));
        paintCoverage(response.queue.coverage, { total: items.length, stock: idle.filter(item => item.status === 'completed').length,
            cached: ready, generated: 0,
            ordered: needed.length - ready + idle.filter(item => item.status !== 'completed').length, potential: 0, failed });
        const persistent = response.speech.persistent_cache;
        cache_status.hidden = !persistent?.enabled;
        cache_status.textContent = persistent?.error ? 'Dauerhaft gespeicherter Bestand derzeit nicht verfügbar.' :
            Number.isInteger(persistent?.stored) ? 'Dauerhaft im BTS-Cache: ' + persistent.stored.toLocaleString('de-DE') +
                (persistent.stored === 1 ? ' Aufnahme oder Baustein' : ' Aufnahmen und Bausteine') +
                ' (alle Turniere und Stimmen).' : 'Dauerhaft gespeicherter Bestand wird geprüft …';
        onSnapshot(response, counts);
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
            const type = operation(item);
            row.node.dataset.operation = type;
            row.action.textContent = operation_labels[type];
            row.node.classList.toggle('speech_queue_current', item.current);
            row.order.textContent = item.current ? '▶' : item.position === null ?
                (item.status === 'completed' ? '✓' : '–') : String(item.position);
            row.order.title = item.current ? 'Laufender Auftrag' : item.position === null ? '' : 'Platz in der Warteschlange';
            row.text.textContent = item.text;
            const usage = item.source_usage?.type;
            row.purpose.hidden = false;
            row.explanation.hidden = !item.fallback_stage && !['field', 'game'].includes(usage);
            row.purpose.textContent = type === 'synthesis' ? recordingLabel(item.key) + ' · ' +
                (usage === 'field' ? 'Feldreferenz: ' + item.source_usage.text : usage === 'game' ? 'Spielblock · einmal pro Spiel' :
                    usage === 'shared' ? 'Referenz für mehrere Bausteine' : 'Einzeltext') : partLabel(item);
            row.explanation.textContent = item.fallback_stage === 'context' ?
                'Namensschnitt fehlgeschlagen: neue Aufnahme mit vollständigem Kontext und anderem Zufallswert.' :
                item.fallback_stage === 'name' ? 'Letzter Fallback: vollständigen Namen einzeln erzeugen und aufbereiten.' : usage === 'field' ?
                'Feste Beispielansage zum Ausschneiden von Anfang und Ende. Diese Feldbausteine werden für alle Spiele wiederverwendet.' :
                usage === 'game' ? 'Wird mit den vorbereiteten Feldbausteinen zusammengesetzt.' : '';
            const source = by_key.get(item.source_key);
            row.source_info.hidden = !source;
            if (source) {
                row.source_link.textContent = 'Aus ' + recordingLabel(source.key);
                row.source_link.href = '#speech-queue-' + source.key;
                const range = item.source_range;
                const valid_range = range && Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 &&
                    range.end > range.start && range.end <= source.text.length && source.text.slice(range.start, range.end) === item.text;
                row.source_details.hidden = type !== 'excerpt' || !valid_range;
                if (valid_range) {
                    row.before.textContent = source.text.slice(0, range.start);
                    row.selected.textContent = source.text.slice(range.start, range.end);
                    row.after.textContent = source.text.slice(range.end);
                }
            }
            const derived = children.get(item.key) || [];
            row.results.hidden = !derived.length;
            row.results_summary.textContent = 'Liefert ' + derived.length + (derived.length === 1 ? ' Baustein' : ' Bausteine');
            const result_signature = derived.map(child => child.key).join(',');
            if (row.result_signature !== result_signature) {
                row.results_list.textContent = '';
                for (const child of derived) element(row.results_list, 'li', '', partLabel(child) + ': ' + child.text);
                row.result_signature = result_signature;
            }
            const voice = item.voice === 'hallensprecher' ? 'Hallensprecher' : 'Hallensprecherin';
            const stage = item.kind === 'source' ? 'Kontextaufnahme' : item.kind === 'field_start' ? 'Feldanfang · Ausschnitt' :
                item.kind === 'field_end' ? 'Feldende · Ausschnitt' : item.kind === 'game' ? 'Spielblock · Audiobearbeitung' :
                item.excerpt_position === 'start' ? 'Anfang · Ausschnitt' : item.excerpt_position === 'end' ? 'Ende · Ausschnitt' : '';
            row.meta.textContent = voice + ' · ' + priorities[item.idle ? 'idle' : item.priority] + ' · ' +
                (stage ? stage + ' · ' : '') + status(item, source);
            row.button.setAttribute('aria-label', 'Probehören: ' + voice + (stage ? ' (' + stage + ')' : '') + ' – ' + item.text);
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
        if (running) { refresh_again = true; return running; }
        clearTimeout(refresh_timer);
        refresh_timer = null;
        last_refresh = Date.now();
        running = load().finally(() => {
            running = null;
            if (refresh_again) { refresh_again = false; scheduleRefresh(); }
        });
        return running;
    }

    function scheduleRefresh() {
        if (stopped || document.hidden) return;
        if (!root.isConnected) { stop(); return; }
        if (refresh_timer !== null) return;
        // Coalesce fast cache hits and never overlap an existing status request.
        refresh_timer = setTimeout(() => { refresh_timer = null; void refresh(); }, Math.max(0, 1000 - (Date.now() - last_refresh)));
    }
    function stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        clearTimeout(refresh_timer);
        window.removeEventListener('bts-speech-cache-changed', scheduleRefresh);
        document.removeEventListener('visibilitychange', scheduleRefresh);
        observer.disconnect();
        if (playing) service.cancelPreview();
    }
    const observer = new MutationObserver(() => { if (!root.isConnected) stop(); });
    observer.observe(root.closest('.main') || document.body, { childList: true, subtree: true });
    window.addEventListener('bts-speech-cache-changed', scheduleRefresh);
    document.addEventListener('visibilitychange', scheduleRefresh);
    const timer = setInterval(() => {
        if (!root.isConnected) stop();
        else if (!document.hidden) void refresh();
    }, 3000);
    void refresh();
    return { refresh, stop };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createSpeechQueue;
