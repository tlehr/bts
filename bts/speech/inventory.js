'use strict';

const context = require('./context');
const COMPONENTS = [
    ['fields', 'Spielfeldansagen'], ['numbers', 'Spielnummern'], ['disciplines', 'Disziplinen und Altersklassen'],
    ['rounds', 'Runden'], ['names', 'Teams, Namen, Vereine und Verbände'], ['roles', 'Offiziellenrollen'],
    ['locations', 'Vorbereitung und Treffpunkte'], ['registration', 'Anmeldetexte'],
    ['instructions', 'Allgemeine Ansageteile'], ['test', 'Sprachtest'], ['free', 'Freie Texte'], ['other', 'Weitere Bausteine'],
];
const STATES = ['stock', 'prepared', 'cached', 'generated', 'ordered', 'potential'];
const READY = new Set(['stock', 'prepared', 'cached', 'generated']);
const empty = () => ({ total: 0, failed: 0, ...Object.fromEntries(STATES.map(state => [state, 0])) });
const add = (counts, item) => { counts.total++; counts[item.state]++; counts.failed += item.failed ? 1 : 0; };

function description(part, groups = []) {
    let recipe;
    try { recipe = context.decode(part || '', 10000); } catch (_) { /* Old cache metadata can lack a recipe. */ }
    const text = recipe?.text || part || 'Gespeicherter Baustein ohne Textzuordnung';
    const has = id => groups instanceof Set ? groups.has(id) : groups.includes(id);
    let group = recipe ? 'instructions' : 'other';
    if (has('D14')) group = 'test';
    else if (['field_start', 'field_end'].includes(recipe?.kind) || /^Für Spielfeld /.test(text)) group = 'fields';
    else if (recipe?.kind === 'team') group = 'names';
    else if (/^Spiel(?:nummer| Nummer) /.test(text)) group = 'numbers';
    else if (recipe?.before === 'Im ' && recipe.after.includes('erwarten wir spannende Spiele')) group = 'disciplines';
    else if (/^(Schiedsrichter|Aufschlagrichter|Tabletbedienung|Klapptafelbedienung):?$/.test(text)) group = 'roles';
    else if (has('registration')) group = 'registration';
    else if (recipe?.kind === 'hall' || /Vorbereitung|Bitte (melde dich|meldet euch)/.test(text)) group = 'locations';
    else if (/finale|Platz|Runde|Gruppenspiel/i.test(text)) group = 'rounds';
    else if (!recipe && part) group = has('D13') ? 'free' : 'instructions';
    const label = recipe?.kind === 'field_start' ? 'Feldanfang' : recipe?.kind === 'field_end' ? 'Feldende' :
        recipe?.kind === 'team' ? /^gegen\s/i.test(text) ? '„gegen“ und zweite Namensposition' :
            /gegen\s*$/.test(recipe.before) ? 'Team / Name · zweite Position' : 'Team / Name · erste Position' :
            /^Für Spielfeld /.test(text) ? 'Feldhinweis in Vorbereitung' : null;
    return { text, group, ...(label ? { label } : {}) };
}

function section(items, groups, label) {
    const total = { id: 'all', label, ...empty() };
    const counts = new Map(groups.map(([id, name]) => [id, { id, label: name, ...empty() }]));
    for (const item of items) {
        add(total, item);
        if (counts.has(item.group)) add(counts.get(item.group), item);
    }
    return { total, groups: [...counts.values()].filter(row => row.total) };
}

function build(components, calls, groups) {
    const byKey = new Map(components.map(row => [row.id, row]));
    const announcements = calls.map(call => {
        const dependencies = call.keys.map(key => byKey.get(key)).filter(Boolean);
        const complete = !call.unresolved && dependencies.length === call.keys.length && dependencies.every(row => READY.has(row.state));
        const missing = dependencies.filter(row => !READY.has(row.state));
        const state = !complete ? !call.unresolved && missing.some(row => row.state === 'ordered') ? 'ordered' : 'potential' :
            call.needed ? dependencies.some(row => row.state === 'generated') ? 'generated' : 'cached' :
                dependencies.some(row => row.state === 'prepared') ? 'prepared' : 'stock';
        return { ...call, state, ready: complete, ready_parts: dependencies.filter(row => READY.has(row.state)).length,
            total_parts: call.keys.length, failed: !complete && missing.some(row => row.failed) };
    });
    return { components, announcements, summary: { components: section(components, COMPONENTS, 'Gesamt · Bausteine'),
        announcements: section(announcements, groups.filter(([id]) => id !== 'other'), 'Gesamt · vollständige Durchsagen') } };
}

function page(snapshot, kind, group, offset, limit, state = 'all') {
    const rank = row => row.failed ? 0 : row.state === 'ordered' ? 1 : ['cached', 'generated'].includes(row.state) ? 2 : row.state === 'potential' ? 3 : 4;
    const source = snapshot[kind].filter(row => (group === 'all' || row.group === group) && (state === 'all' || row.state === state))
        .sort((a, b) => rank(a) - rank(b) || (kind === 'components' ? a.text : a.label || a.text)
            .localeCompare(kind === 'components' ? b.text : b.label || b.text, 'de', { numeric: true }));
    const components = new Map(snapshot.components.map(row => [row.id, row]));
    const rows = source.slice(offset, offset + limit).map(row => {
        if (kind === 'components') return row;
        const { keys, ...value } = row;
        return { ...value, components: keys.map(key => components.get(key)).filter(Boolean) };
    });
    return { kind, group, state, offset, total: source.length, items: rows,
        next_offset: offset + limit < source.length ? offset + limit : null };
}

module.exports = { COMPONENTS, description, build, page };
