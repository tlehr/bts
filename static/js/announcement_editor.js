/* exported btsAnnouncementEditor */
'use strict';

const btsAnnouncementEditor = (() => {
    const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    const normalize = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('de').replace(/ß/g, 'ss');
    const labels = { state: 'Landesverbände', club: 'Vereine', player: 'Spieler', pair: 'Doppelpaarungen' };
    const name = player => clean(player?.name) || clean([player?.firstname, player?.lastname || player?.surname].filter(Boolean).join(' '));
    const sessions = new Map();
    let sequence = 0;

    function candidates(tournament = {}) {
        const rows = new Map();
        const add = (kind, label, value = label, detail = '', identity = label) => {
            if (!label) return;
            const key = kind + ':' + identity.normalize('NFC').toLocaleLowerCase('de');
            if (!rows.has(key)) rows.set(key, { kind, label, value, detail, search: normalize(label + ' ' + value + ' ' + detail), aliases: [...new Set([normalize(label), normalize(value)])] });
            return rows.get(key);
        };
        const team = players => {
            if (!Array.isArray(players)) return;
            const names = players.map(name), clubs = [...new Set(players.map(player => clean(player?.club)).filter(Boolean))];
            const states = [...new Set(players.map(player => clean(player?.state)).filter(Boolean))];
            for (const player of players) {
                add('player', name(player), name(player), [clean(player?.club), clean(player?.state)].filter(Boolean).join(' · '));
                const club = add('club', clean(player?.club)), state = clean(player?.state);
                if (club && state) {
                    club.states ||= [];
                    if (!club.states.includes(state)) club.states.push(state);
                }
                add('state', state);
            }
            if (names.length > 1 && names.every(Boolean)) add('pair', names.join(' / '), names.join(' und '), [...clubs, ...states].join(' · '), [...names].sort().join(' / '));
        };
        // Registration also supplies people who have not been drawn into games.
        for (const event of tournament.events?.events || []) {
            for (const stage of event.stages || []) for (const entry of stage.entries || []) team(entry.team?.players);
        }
        for (const match of tournament.matches || []) for (const side of match.setup?.teams || []) team(side.players);
        for (const row of rows.values()) if (row.kind === 'club') {
            row.detail = (row.states || []).sort((a, b) => a.localeCompare(b, 'de')).join(' · ');
            row.search = normalize(row.label + ' ' + row.detail);
        }
        return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label, 'de'));
    }

    function token(value, start, end = start) {
        if (start !== end) return null;
        const match = /(?:^|[\s(])\/([^/\n]*(?:[ \t]\/[ \t][^/\n]*)?)$/u.exec(value.slice(0, start));
        if (!match) return null;
        const tail = /^[\p{L}\p{N}'’_-]+/u.exec(value.slice(start))?.[0] || '';
        return { start: start - match[1].length - 1, end: start + tail.length, query: match[1] };
    }

    function replacement(value, range, text, maxLength = -1) {
        const suffix = value.slice(range.end), inserted = text + (suffix ? '' : ' ');
        const result = value.slice(0, range.start) + inserted + suffix;
        return maxLength >= 0 && result.length > maxLength ? null : { value: result, inserted, caret: range.start + inserted.length };
    }

    function completed(value, range, source, maxLength = -1) {
        const query = normalize(range.query);
        // Keep multiword names and the second player of a double editable.
        if (source.some(row => row.aliases.some(alias => alias !== query && alias.startsWith(query)))) return null;
        const boundaries = [...range.query.matchAll(/[\s,.;:!?)]/gu)].reverse();
        for (const boundary of boundaries) {
            const prefix = normalize(range.query.slice(0, boundary.index));
            const row = source.find(item => item.aliases.includes(prefix));
            if (!row) continue;
            const end = range.start + 1 + boundary.index;
            const result = replacement(value, { start: range.start, end }, row.value, maxLength);
            return result ? { ...result, start: range.start, end } : null;
        }
        return null;
    }

    function history({ read = () => [], write = () => {}, limit = 50 } = {}) {
        let saved;
        try { saved = read(); } catch (_) { /* Browsers may deny local storage. */ }
        let entries = (Array.isArray(saved) ? saved : []).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()).slice(-limit);
        let index = entries.length, draft = '';
        const reset = () => { index = entries.length;draft = ''; };
        return {
            get active() { return index < entries.length; },
            reset,
            remember(value) {
                const text = value.trim();
                if (!text) return;
                if (entries.at(-1) !== text) entries = [...entries, text].slice(-limit);
                reset();
                try { write(entries); } catch (_) { /* Keep session history if storage is full or unavailable. */ }
            },
            move(direction, current) {
                if (!entries.length || direction > 0 && index === entries.length) return null;
                if (index === entries.length) draft = current;
                index = Math.max(0, Math.min(entries.length, index + direction));
                return { value: index === entries.length ? draft : entries[index], draft: index === entries.length };
            },
        };
    }

    function create({ textarea, getTournament, getKey }) {
        const doc = textarea.ownerDocument, view = doc.defaultView, controller = new AbortController(), { signal } = controller;
        const id = 'announcement-completion-' + (++sequence), popup = doc.createElement('div');
        popup.id = id;popup.className = 'announcement-completions';popup.setAttribute('role', 'listbox');popup.setAttribute('aria-label', 'Textvervollständigung');
        textarea.setAttribute('role', 'combobox');textarea.setAttribute('aria-autocomplete', 'list');textarea.setAttribute('aria-haspopup', 'listbox');
        textarea.setAttribute('aria-controls', id);textarea.setAttribute('aria-expanded', 'false');
        textarea.placeholder = 'Freie Durchsage … / ergänzt Namen · ↑/↓ letzte Ansagen';
        textarea.title = 'Mit / Spieler, Paarungen, Vereine oder Landesverbände ergänzen. ↑/↓ durchsucht gesendete Ansagen; Umschalt+↑/↓ bleibt zur Textauswahl verfügbar.';
        let rows = [], active = -1, range = null, source = [], sourceKey = '', popupEvents, draftSelection, internalInput = false;
        const owner = new MutationObserver(() => { if (!textarea.isConnected) destroy(); });
        const size = new ResizeObserver(() => position());
        const store = (key = getKey()) => {
            key = String(key || '');
            if (!sessions.has(key)) sessions.set(key, history({
                read: () => JSON.parse(view.localStorage.getItem('bts-free-announcement-history-v1:' + key) || '[]'),
                write: entries => view.localStorage.setItem('bts-free-announcement-history-v1:' + key, JSON.stringify(entries)),
            }));
            return sessions.get(key);
        };
        function close() {
            popup.remove();popupEvents?.abort();popupEvents = null;owner.disconnect();size.disconnect();
            textarea.setAttribute('aria-expanded', 'false');textarea.removeAttribute('aria-activedescendant');
            rows = [];active = -1;range = null;sourceKey = '';source = [];
        }
        function position() {
            if (!popup.isConnected) return;
            const box = textarea.getBoundingClientRect(), height = view.innerHeight, width = view.innerWidth;
            if (!textarea.isConnected || !textarea.getClientRects().length || box.bottom < 0 || box.top > height) { close();return; }
            const above = box.top - 8, below = height - box.bottom - 8, upwards = below < 180 && above > below;
            const available = Math.min(box.width, width - 16);
            popup.style.width = available + 'px';popup.style.left = Math.max(8, Math.min(box.left, width - available - 8)) + 'px';
            popup.style.maxHeight = Math.max(0, Math.min(300, upwards ? above : below)) + 'px';
            popup.style.top = upwards ? 'auto' : box.bottom + 4 + 'px';popup.style.bottom = upwards ? height - box.top + 4 + 'px' : 'auto';
        }
        function activate(index, scroll = false) {
            active = index;
            rows.forEach((row, i) => row.node.setAttribute('aria-selected', String(i === active)));
            if (rows[active]) {
                textarea.setAttribute('aria-activedescendant', rows[active].node.id);
                if (scroll) rows[active].node.scrollIntoView({ block: 'nearest' });
            } else textarea.removeAttribute('aria-activedescendant');
        }
        function changed() {
            internalInput = true;
            try { textarea.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' })); }
            finally { internalInput = false; }
        }
        function choose(row) {
            if (!row || row.disabled || !range) return;
            const current = token(textarea.value, textarea.selectionStart, textarea.selectionEnd);
            if (!current || current.start !== range.start || current.end !== range.end) { close();return; }
            const result = replacement(textarea.value, current, row.value, textarea.maxLength);
            if (!result) return;
            textarea.setRangeText(result.inserted, current.start, current.end, 'end');
            close();store().reset();changed();textarea.focus({ preventScroll: true });
        }
        function update(complete = false) {
            if (internalInput || doc.activeElement !== textarea) return;
            const next = token(textarea.value, textarea.selectionStart, textarea.selectionEnd);
            if (!next) { close();return; }
            const key = getKey() + ':' + textarea.value.slice(0, next.start + 1);
            if (key !== sourceKey) { source = candidates(getTournament());sourceKey = key; }
            const accepted = complete && completed(textarea.value, next, source, textarea.maxLength);
            if (accepted) {
                textarea.setRangeText(accepted.inserted, accepted.start, accepted.end, 'preserve');
                close();changed();return;
            }
            range = next;
            const terms = normalize(next.query).split(/[\s/]+/).filter(Boolean), fragment = doc.createDocumentFragment();
            rows = [];
            const append = (parent, tag, className, text) => {const node = doc.createElement(tag);node.className = className;node.textContent = text;parent.append(node);return node;};
            for (const [kind, label] of Object.entries(labels)) {
                const matches = source.filter(row => row.kind === kind && terms.every(term => row.search.includes(term)));
                if (!matches.length) continue;
                const title = append(fragment, 'div', 'announcement-completion-group', label + (matches.length > 20 ? ' · erste 20 von ' + matches.length : ''));
                title.setAttribute('role', 'presentation');
                for (const item of matches.slice(0, 20)) {
                    const node = append(fragment, 'div', 'announcement-completion-option', '');node.id = id + '-' + rows.length;
                    node.setAttribute('role', 'option');node.dataset.kind = kind;
                    append(node, 'span', 'announcement-completion-label', item.label);
                    if (item.detail) append(node, 'small', 'announcement-completion-detail', item.detail);
                    const disabled = !replacement(textarea.value, range, item.value, textarea.maxLength);
                    node.setAttribute('aria-disabled', String(disabled));
                    if (disabled) node.title = 'Dieser Eintrag würde die maximale Textlänge von ' + textarea.maxLength + ' Zeichen überschreiten.';
                    rows.push({ ...item, node, disabled });
                }
            }
            if (!rows.length) append(fragment, 'div', 'announcement-completion-empty', 'Keine passenden Vorschläge.');
            popup.replaceChildren(fragment);activate(rows.findIndex(row => !row.disabled));
            if (!popup.isConnected) {
                doc.body.append(popup);popupEvents = new AbortController();const signal = popupEvents.signal;
                doc.addEventListener('scroll', event => { if (!popup.contains(event.target)) position(); }, { capture: true, signal });
                view.addEventListener('resize', position, { signal });
                doc.addEventListener('pointerdown', event => { if (event.target !== textarea && !popup.contains(event.target)) close(); }, { signal });
                owner.observe(doc.body, { childList: true, subtree: true });size.observe(textarea);
            }
            textarea.setAttribute('aria-expanded', 'true');position();
        }
        textarea.addEventListener('input', () => { if (!internalInput) { store().reset();update(true); } }, { signal });
        textarea.addEventListener('click', () => update(), { signal });
        textarea.addEventListener('keyup', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) update(); }, { signal });
        textarea.addEventListener('blur', close, { signal });
        textarea.addEventListener('keydown', event => {
            if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            const arrow = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
            if (popup.isConnected) {
                if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();close();return; }
                if (event.key === 'Enter' || event.key === 'Tab') {
                    if (rows[active]) { event.preventDefault();event.stopPropagation();choose(rows[active]); }
                    return;
                }
                if (!arrow) return;
                event.preventDefault();event.stopPropagation();
                const selectable = rows.map((row, i) => row.disabled ? -1 : i).filter(i => i >= 0);
                const index = selectable.indexOf(active);
                activate(selectable[(index + arrow + selectable.length) % selectable.length] ?? -1, true);
                return;
            }
            if (!arrow) return;
            const saved = store();
            if (!saved.active) draftSelection = [textarea.selectionStart, textarea.selectionEnd];
            const recalled = saved.move(arrow, textarea.value);
            if (!recalled) return;
            event.preventDefault();event.stopPropagation();textarea.value = recalled.value;
            if (recalled.draft) textarea.setSelectionRange(...draftSelection);else textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            changed();
        }, { signal });
        popup.addEventListener('pointerdown', event => event.preventDefault(), { signal });
        popup.addEventListener('click', event => choose(rows.find(row => row.node.contains(event.target))), { signal });
        function destroy() { close();controller.abort(); }
        store().reset();
        return { close, destroy, remember: (text, key) => store(key).remember(text) };
    }
    return { candidates, token, replacement, completed, history, create };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = btsAnnouncementEditor;
