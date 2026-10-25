'use strict';

/* exported btsSpeechHealth */
var btsSpeechHealth = (function() {
    let banner;
    const labels = { worker: 'Ansagenverwaltung', snapshot: 'Ansagenplanung', initialization: 'Start der Ansagenverwaltung',
        upstream_health: 'Verbindung zum Sprachserver', upstream_voices: 'Stimmen des Sprachservers',
        upstream_request: 'Sprachaufnahme / Aufbereitung', upstream_helpers: 'Auftragsverteilung an Sprachhelfer', generation: 'Generierung', cache: 'Audiocache',
        diagnostics: 'Speichern des Fehlerverlaufs', prefetch: 'Ansagenplanung', immediate_prefetch: 'Vorbereitung eines Aufrufs' };
    function update(health) {
        if (!banner) {
            banner = document.createElement('section'); banner.className = 'speech_health_banner';
            banner.setAttribute('role', 'alert'); banner.setAttribute('aria-live', 'assertive');
            document.body.prepend(banner);
            new ResizeObserver(() => document.body.style.setProperty('--speech-health-height', banner.offsetHeight + 'px')).observe(banner);
        }
        const issues = health?.issues || [];
        banner.hidden = !issues.length;
        document.body.classList.toggle('speech_health_active', !!issues.length);
        if (!issues.length) { banner.replaceChildren(); return; }
        const connections = issues.filter(issue => issue.kind === 'upstream_connection');
        const title = document.createElement('strong'); title.textContent = connections.length ?
            'Sprachserver nicht erreichbar – der Turnierbetrieb läuft weiter' : 'Ansagen gestört – der Turnierbetrieb läuft weiter';
        const detail = document.createElement('p');
        detail.textContent = (connections.length ? 'Neue Sprachaufnahmen können derzeit nicht erzeugt werden. ' : 'Lokale Ansagen können fehlen. ') + (issues.every(issue => issue.retrying) ?
            'Die Ansagenverwaltung versucht es automatisch erneut.' : 'Bitte Fehler und Einstellungen prüfen; gegebenenfalls BTS neu starten.');
        const nodes = [title, detail], endpoints = new Set();
        for (const issue of connections) {
            if (endpoints.has(issue.endpoint || '')) continue;
            endpoints.add(issue.endpoint || '');
            const explanation = document.createElement('p');
            explanation.textContent = (issue.endpoint ? 'Sprachserver: ' + issue.endpoint + '. ' : '') + issue.message;
            const action = document.createElement('p'); action.textContent = issue.action;
            nodes.push(explanation, action);
        }
        const list = document.createElement('ul');
        for (const issue of issues) {
            const row = document.createElement('li'), source = issue.source.replace(/^remote\//, '');
            row.textContent = (labels[source.split(':')[0]] || 'Ansagenverwaltung') +
                (source.includes(':') && !source.startsWith('bridge:') ? ' (' + source.split(':').slice(1).join(':') + ')' : '') + ': ' + issue.code +
                (issue.message && issue.message !== issue.code ? ' · ' + issue.message : '');
            list.appendChild(row);
        }
        if (connections.length) {
            const technical = document.createElement('details'), summary = document.createElement('summary');
            summary.textContent = 'Technische Details'; technical.append(summary, list); nodes.push(technical);
        } else nodes.push(list);
        banner.replaceChildren(...nodes);
    }
    return { update, disconnected() {
        if (!banner || banner.hidden) return;
        banner.querySelector('p').textContent = 'Verbindung zu BTS unterbrochen. Der letzte bekannte Ansagenfehler bleibt bis zur erneuten Statusmeldung sichtbar.';
    } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = btsSpeechHealth;
