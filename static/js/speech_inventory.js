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
    function el(parent, tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text) node.textContent = text;
        parent.appendChild(node);
        return node;
    }
    const host = el(root, 'div', 'speech_inventory');
    function listing(parent, kind, group) {
        const details = el(parent, 'details', 'speech_inventory_entries');
        const title = el(details, 'summary', '', kind === 'announcements' ? 'Durchsagen mit Status anzeigen' : 'Bausteine mit Status anzeigen');
        const list = el(details, 'ul', 'speech_inventory_list');
        const note = el(details, 'p', 'speech_inventory_note');
        const more = el(details, 'button', 'speech_inventory_more', 'Weitere 30 anzeigen');
        more.type = 'button'; more.hidden = true;
        const state = { details, title, list, note, more, kind, group, items: [], refs: new Set(), loading: false, dirty: true, revision: 0, wanted: 30, nodes: new Map() };
        details.addEventListener('toggle', () => { if (details.open) void load(state); });
        more.addEventListener('click', () => { state.wanted += 30; state.dirty = true; void load(state); });
        return state;
    }
    function groupNode(parent, kind, id, label) {
        const key = kind + ':' + id;
        if (groups.has(key)) return groups.get(key);
        const node = el(parent, 'details', 'speech_inventory_group');
        node.dataset.inventoryKind = kind; node.dataset.coverageGroup = id;
        const heading = el(node, 'summary', '', label);
        const bar = el(node, 'div', 'speech_coverage_bar');
        const caption = el(node, 'div', 'speech_coverage_counts');
        const failure = el(node, 'div', 'speech_coverage_failure');
        const listingState = listing(node, kind, id);
        node.addEventListener('toggle', () => { if (node.open) { listingState.details.open = true; void load(listingState); } });
        const state = { node, heading, bar, caption, failure, listing: listingState };
        groups.set(key, state); return state;
    }
    for (const [kind, label, help] of [
        ['components', 'Bausteine', 'Einmalige, wiederverwendbare Audioteile. Jeder Baustein zählt hier genau einmal. Die vollständigen Kontextaufnahmen und ihre Schnitte stehen unter „Aufträge an den Sprachserver“.'],
        ['announcements', 'Durchsagen', 'Vollständige Durchsagen aus diesen Bausteinen. Eine Durchsage ist erst bereit, wenn alle Teile vorhanden und die nötigen Angaben bekannt sind. Die Farben zeigen den Stand der verwendeten Bausteine. Das Zusammensetzen benötigt keine neue Sprachgenerierung.'],
    ]) {
        const node = el(host, 'details', 'speech_inventory_section'); node.open = true;
        el(node, 'summary', '', label);
        el(node, 'p', 'speech_queue_help', help);
        let total;
        if (kind === 'components') {
            node.appendChild(progress);
            total = { listing: listing(progress, kind, 'all') };
        } else {
            const heading = el(node, 'strong', 'speech_coverage_title', 'Gesamt · vollständige Durchsagen');
            const bar = el(node, 'div', 'speech_coverage_bar');
            const caption = el(node, 'div', 'speech_coverage_counts');
            const failure = el(node, 'div', 'speech_coverage_failure');
            total = { heading, bar, caption, failure, listing: listing(node, kind, 'all') };
        }
        const children = el(node, 'div', 'speech_inventory_groups');
        sections.set(kind, { node, total, children });
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
        state.note.textContent = page.total ? Math.min(state.items.length, page.total) + ' von ' + page.total + ' angezeigt.' : 'Noch keine Einträge vorhanden.';
        state.more.hidden = page.next_offset == null || state.items.length >= page.total;
        state.more.disabled = false;
    }
    async function load(state) {
        if (stopped || !state.dirty || state.loading || !state.details.open || !service.inventory) return;
        state.loading = true;
        const captured = version, revision = state.revision;
        state.note.textContent = 'Status wird geladen …'; state.more.disabled = true;
        const items = [];
        let last;
        try {
            for (let offset = 0; offset < state.wanted; offset += 30) {
                const page = await service.inventory(state.kind, state.group, offset, 30);
                if (stopped || captured !== version) return;
                if (!page) { state.note.textContent = 'Liste derzeit nicht verfügbar.'; return; }
                items.push(...page.items); last = page;
                if (page.next_offset == null) break;
            }
            state.items = items; state.dirty = state.revision !== revision;
            paintList(state, last);
        } finally {
            state.loading = false; state.more.disabled = false;
            if (state.dirty && state.details.open && state.revision !== revision) void load(state);
        }
    }
    function paintCounts(row, counts, label) {
        const signature = JSON.stringify(counts), previous = row.signature;
        row.signature = signature;
        if (row.bar) {
            paintBar(row.bar, counts, label, row.caption, row.failure);
            row.failure.textContent = counts.failed ? counts.failed + (row.listing.kind === 'announcements' ? ' Durchsagen mit fehlgeschlagenen Teilen' : ' Bausteine fehlgeschlagen') : '';
        }
        if (previous !== signature) { row.listing.dirty = true; row.listing.revision++; }
    }
    return {
        render(coverage, nextVersion, changedKeys = new Set()) {
            host.hidden = false;
            if (version !== nextVersion) {
                version = nextVersion;
                for (const group of groups.values()) { group.listing.dirty = true; group.listing.revision++; group.listing.wanted = 30; }
                for (const section of sections.values()) { section.total.listing.dirty = true; section.total.listing.revision++; section.total.listing.wanted = 30; }
            }
            for (const [kind, section] of sections) {
                const data = coverage[kind];
                if (kind === 'components') section.node.insertBefore(progress, section.children);
                if (section.total.heading) section.total.heading.textContent = data.total.label + ' · ' + data.total.total;
                paintCounts(section.total, data.total, data.total.label);
                const wanted = new Set();
                let cursor = section.children.firstElementChild;
                for (const counts of data.groups) {
                    wanted.add(kind + ':' + counts.id);
                    const row = groupNode(section.children, kind, counts.id, counts.label);
                    if (row.node !== cursor) section.children.insertBefore(row.node, cursor);
                    cursor = row.node.nextElementSibling;
                    row.heading.textContent = (kind === 'announcements' && /^D\d\d$/.test(counts.id) ? counts.id + ' · ' : '') + counts.label + ' · ' + counts.total;
                    paintCounts(row, counts, counts.label);
                }
                for (const [key, row] of groups) if (row.listing.kind === kind && !wanted.has(key)) {
                    row.node.remove(); groups.delete(key);
                }
            }
            for (const state of [...[...sections.values()].map(row => row.total.listing), ...[...groups.values()].map(row => row.listing)]) {
                if (planRevision !== coverage.revision || [...changedKeys].some(key => state.refs.has(key))) { state.dirty = true; state.revision++; }
                if (state.details.open && !state.details.closest('details:not([open])')) void load(state);
            }
            planRevision = coverage.revision;
        },
        hide() { host.hidden = true; },
        stop() { stopped = true; },
    };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createSpeechInventory;
