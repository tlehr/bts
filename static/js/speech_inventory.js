/* exported createSpeechInventory */
'use strict';

function createSpeechInventory({ root, service, progress, paintBar, describeFailures }) {
    const document = root.ownerDocument;
    const groups = new Map(), sections = new Map();
    let stopped = false, version, planRevision;
    const statuses = { stock: 'Im Cache · Vorrat', prepared: 'Vorsorglich vorbereitet', cached: 'Benötigt · aus Cache bereit',
        generated: 'Benötigt · bereit', ordered: 'Wird vorbereitet', potential: 'Noch ohne Auftrag' };
    const callStatuses = { ...statuses, stock: 'Aus Bausteinen bereit · Vorrat', prepared: 'Vorsorglich aus Bausteinen bereit',
        cached: 'Benötigt · alle Teile aus Cache', generated: 'Benötigt · aus Bausteinen bereit' };
    const filterLabels = { stock: 'Vorrat im Cache', prepared: 'Vorsorglich erzeugt · diese Sitzung', cached: 'Benötigt · aus Cache',
        generated: 'Benötigt · neu erzeugt', ordered: 'Beauftragt', potential: 'Noch ohne Auftrag' };
    function el(parent, tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text) node.textContent = text;
        parent.appendChild(node);
        return node;
    }
    const host = el(root, 'div', 'speech_inventory');
    function listing(parent, kind) {
        const node = el(parent, 'div', 'speech_inventory_entries');
        node.dataset.inventoryKind = kind;
        const title = el(node, 'h4', 'speech_inventory_selection');
        const reset = el(node, 'button', 'speech_inventory_reset', kind === 'components' ? 'Alle Bausteine anzeigen' : 'Alle Durchsagen anzeigen');
        reset.type = 'button'; reset.hidden = true;
        const note = el(node, 'p', 'speech_inventory_note');
        note.setAttribute('aria-live', 'polite');
        const list = el(node, 'ul', 'speech_inventory_list');
        const more = el(node, 'button', 'speech_inventory_more', 'Weitere 30 anzeigen');
        more.type = 'button'; more.hidden = true;
        const state = { node, title, reset, list, note, more, kind, group: 'all', filter: 'all', selection: 0,
            items: [], refs: new Set(), loading: false, dirty: true, revision: 0, wanted: 30, nodes: new Map() };
        reset.addEventListener('click', () => select(kind, 'all'));
        more.addEventListener('click', () => { state.wanted += 30; state.dirty = true; void load(state); });
        return state;
    }

    function bindBar(row, kind, id) {
        row.kind = kind; row.id = id;
        row.bar.dataset.inventoryKind = kind;
        row.bar.dataset.coverageGroup = id;
        row.bar.setAttribute('role', 'group');
        row.heading.setAttribute('role', 'button');
        row.heading.tabIndex = 0;
        row.heading.classList.add('speech_inventory_filter');
        row.heading.addEventListener('click', () => select(kind, id));
        row.heading.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(kind, id); }
        });
        const activate = event => {
            const segment = event.target.closest('.speech_coverage_segment');
            if (segment && !segment.hidden) select(kind, id, segment.dataset.coverageState);
        };
        row.bar.addEventListener('click', activate);
        row.bar.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event); }
        });
    }

    function groupNode(parent, kind, id, label) {
        const key = kind + ':' + id;
        if (groups.has(key)) return groups.get(key);
        const node = el(parent, 'div', 'speech_inventory_group');
        node.dataset.inventoryKind = kind; node.dataset.coverageGroup = id;
        const heading = el(node, 'strong', 'speech_coverage_title', label);
        const bar = el(node, 'div', 'speech_coverage_bar');
        const caption = el(node, 'div', 'speech_coverage_counts');
        const failure = el(node, 'div', 'speech_coverage_failure');
        const row = { node, heading, bar, caption, failure, label };
        bindBar(row, kind, id);
        groups.set(key, row); return row;
    }
    for (const [kind, label, help] of [
        ['components', 'Bausteine', 'Einmalige, wiederverwendbare Audioteile. Jeder Baustein zählt hier genau einmal. Die vollständigen Kontextaufnahmen und ihre Schnitte stehen unter „Aufträge an den Sprachserver“.'],
        ['announcements', 'Durchsagen', 'Vollständige Durchsagen aus diesen Bausteinen. Eine Durchsage ist erst bereit, wenn alle Teile vorhanden und die nötigen Angaben bekannt sind. Die Farben zeigen den Stand der verwendeten Bausteine. Das Zusammensetzen benötigt keine neue Sprachgenerierung.'],
    ]) {
        const node = el(host, 'section', 'speech_inventory_section');
        node.dataset.inventoryKind = kind;
        el(node, 'h4', '', label);
        el(node, 'p', 'speech_queue_help', help);
        let total;
        if (kind === 'components') {
            node.appendChild(progress);
            total = { heading: progress.querySelector('.speech_coverage_title'), bar: progress.querySelector('.speech_coverage_bar'),
                caption: progress.querySelector('.speech_coverage_counts'), failure: progress.querySelector('.speech_coverage_failure') };
        } else {
            const heading = el(node, 'strong', 'speech_coverage_title', 'Gesamt · vollständige Durchsagen');
            const bar = el(node, 'div', 'speech_coverage_bar');
            const caption = el(node, 'div', 'speech_coverage_counts');
            const failure = el(node, 'div', 'speech_coverage_failure');
            total = { heading, bar, caption, failure };
        }
        total.label = kind === 'components' ? 'Alle Bausteine' : 'Alle Durchsagen';
        bindBar(total, kind, 'all');
        const breakdown = el(node, 'details', 'speech_inventory_breakdown');
        el(breakdown, 'summary', '', kind === 'components' ? 'Alle Baustein-Balken anzeigen' : 'Alle Durchsagen-Balken anzeigen');
        const children = el(breakdown, 'div', 'speech_inventory_groups');
        const list = listing(node, kind);
        sections.set(kind, { node, total, breakdown, children, listing: list });
    }

    function paintSelection(section) {
        const state = section.listing;
        const category = state.group === 'all' ? section.total.label : groups.get(state.kind + ':' + state.group)?.label || section.total.label;
        state.title.textContent = category + (state.filter === 'all' ? ' · alle Status' : ' · ' + filterLabels[state.filter]);
        state.reset.hidden = state.group === 'all' && state.filter === 'all';
        state.node.dataset.coverageGroup = state.group;
        state.node.dataset.coverageState = state.filter;
        for (const row of [section.total, ...[...groups.values()].filter(row => row.kind === state.kind)]) {
            row.heading.setAttribute('aria-pressed', String(state.group === row.id && state.filter === 'all'));
            for (const segment of row.bar.children) {
                segment.removeAttribute('aria-hidden');
                segment.setAttribute('role', 'button');
                segment.tabIndex = segment.hidden ? -1 : 0;
                segment.setAttribute('aria-label', row.label + ' · ' + segment.title + ' anzeigen');
                segment.setAttribute('aria-pressed', String(state.group === row.id && state.filter === segment.dataset.coverageState));
            }
        }
    }

    function select(kind, group, filter = 'all') {
        const section = sections.get(kind), state = section.listing;
        if (state.group !== group || state.filter !== filter) {
            state.group = group; state.filter = filter; state.selection++; state.wanted = 30;
            state.items = []; state.refs.clear(); state.nodes.clear(); state.list.textContent = '';
            state.more.hidden = true;
            state.dirty = true; state.revision++;
        }
        paintSelection(section);
        void load(state);
    }
    function paintList(state, page) {
        state.refs = new Set();
        const used = new Set();
        let cursor = state.list.firstElementChild;
        for (const item of state.items) {
            used.add(item.id); state.refs.add(item.id);
            let row = state.nodes.get(item.id);
            if (!row) {
                const node = el(state.list, 'li', 'speech_inventory_item');
                const title = el(node, 'strong');
                const text = el(node, 'div', 'speech_inventory_text');
                const status = el(node, 'div', 'speech_inventory_status');
                const error = el(node, 'div', 'speech_inventory_error');
                const details = el(node, 'details', 'speech_inventory_dependencies');
                el(details, 'summary', '', 'Verwendete Bausteine');
                const parts = el(details, 'ul');
                row = { node, title, text, status, error, details, parts }; state.nodes.set(item.id, row);
            }
            if (row.node !== cursor) state.list.insertBefore(row.node, cursor);
            cursor = row.node.nextElementSibling;
            row.node.dataset.inventoryId = item.id;
            row.node.dataset.state = item.state;
            row.title.textContent = item.label || item.text;
            row.text.hidden = !item.label; row.text.textContent = item.text;
            row.status.textContent = item.unresolved || (item.failed ? 'Fehlgeschlagen' : (state.kind === 'announcements' ? callStatuses : statuses)[item.state]) +
                (state.kind === 'announcements' ? ' · ' + item.ready_parts + '/' + item.total_parts + ' Teile bereit' : '');
            const info = describeFailures(item);
            row.error.hidden = !info;
            if (info) row.error.textContent = info.summary + ': ' + info.reason + ' · ' + info.next;
            row.details.hidden = !item.components?.length;
            if (item.components) {
                const signature = JSON.stringify(item.components);
                if (row.signature !== signature) {
                    row.parts.textContent = '';
                    for (const part of item.components) {
                        const text = el(row.parts, 'li', '', (part.label ? part.label + ': ' : '') + part.text + ' · ' + (part.failed ? 'Fehlgeschlagen' : statuses[part.state]));
                        const info = describeFailures(part);
                        if (info) el(text, 'div', 'speech_inventory_error', info.summary + ': ' + info.reason);
                    }
                    row.signature = signature;
                }
                item.components.forEach(part => state.refs.add(part.id));
            }
        }
        for (const [id, row] of state.nodes) if (!used.has(id)) { row.node.remove(); state.nodes.delete(id); }
        state.note.textContent = page.total ? Math.min(state.items.length, page.total) + ' von ' + page.total + ' angezeigt.' : 'Keine Einträge für diese Auswahl.';
        state.more.hidden = page.next_offset == null || state.items.length >= page.total;
        state.more.disabled = false;
    }
    async function load(state) {
        if (stopped || !state.dirty || state.loading || !service.inventory) return;
        state.loading = true;
        const captured = version, revision = state.revision, selection = state.selection;
        const group = state.group, filter = state.filter;
        state.note.textContent = 'Status wird geladen …'; state.more.disabled = true;
        const items = [];
        let last;
        try {
            for (let offset = 0; offset < state.wanted; offset += 30) {
                const page = await service.inventory(state.kind, group, offset, 30, filter);
                if (stopped || captured !== version || selection !== state.selection) return;
                if (!page) { state.note.textContent = 'Liste derzeit nicht verfügbar.'; return; }
                items.push(...page.items); last = page;
                if (page.next_offset == null) break;
            }
            state.items = items; state.dirty = state.revision !== revision;
            paintList(state, last);
        } finally {
            state.loading = false; state.more.disabled = false;
            if (state.dirty && (captured !== version || state.revision !== revision)) void load(state);
        }
    }
    function paintCounts(row, counts, label) {
        const signature = JSON.stringify(counts), previous = row.signature;
        row.signature = signature;
        if (row.bar) {
            paintBar(row.bar, counts, label, row.caption, row.failure);
            row.failure.textContent = counts.failed ? counts.failed + (row.kind === 'announcements' ? ' Durchsagen mit fehlgeschlagenen Teilen' : ' Bausteine fehlgeschlagen') : '';
        }
        const state = sections.get(row.kind).listing;
        if (previous !== signature && row.id === state.group) {
            state.dirty = true; state.revision++;
        }
    }
    return {
        render(coverage, nextVersion, changedKeys = new Set()) {
            host.hidden = false;
            if (version !== nextVersion) {
                version = nextVersion;
                for (const { listing: state } of sections.values()) { state.dirty = true; state.revision++; state.wanted = 30; }
            }
            for (const [kind, section] of sections) {
                const data = coverage[kind];
                if (kind === 'components') section.node.insertBefore(progress, section.breakdown);
                if (section.total.heading) section.total.heading.textContent = data.total.label + ' · ' + data.total.total;
                paintCounts(section.total, data.total, data.total.label);
                const wanted = new Set();
                let cursor = section.children.firstElementChild;
                for (const counts of data.groups) {
                    wanted.add(kind + ':' + counts.id);
                    const row = groupNode(section.children, kind, counts.id, counts.label);
                    row.label = counts.label;
                    if (row.node !== cursor) section.children.insertBefore(row.node, cursor);
                    cursor = row.node.nextElementSibling;
                    row.heading.textContent = (kind === 'announcements' && /^D\d\d$/.test(counts.id) ? counts.id + ' · ' : '') + counts.label + ' · ' + counts.total;
                    paintCounts(row, counts, counts.label);
                }
                for (const [key, row] of groups) if (row.kind === kind && !wanted.has(key)) {
                    row.node.remove(); groups.delete(key);
                }
                if (section.listing.group !== 'all' && !wanted.has(kind + ':' + section.listing.group)) select(kind, 'all');
                paintSelection(section);
            }
            for (const { listing: state } of sections.values()) {
                if (planRevision !== coverage.revision || [...changedKeys].some(key => state.refs.has(key))) { state.dirty = true; state.revision++; }
                void load(state);
            }
            planRevision = coverage.revision;
        },
        hide() { host.hidden = true; },
        stop() { stopped = true; },
    };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createSpeechInventory;
