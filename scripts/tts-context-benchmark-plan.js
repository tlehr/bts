'use strict';

// Laboratory-only adapter: exercise the existing v1 renderer unchanged.
const crypto = require('crypto');
const fs = require('fs');
const create = require('../static/js/announcement_text');
const { _translate: translate } = require('../static/js/ci18n');
const { spellNumbers, VERSION: pronunciationVersion } = require('../bts/speech/numbers');
const context = require('../bts/speech/context');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

class Plan {
    constructor(normalizations = []) {
        this.sources = new Map(); this.pieces = new Map(); this.cases = [];
        this.normalizations = normalizations;
    }
    source(text, profile = 'bts-context-v1/source', display = text) {
        const id = 's-' + digest([text, profile]).slice(0, 20);
        this.sources.set(id, { id, text, display, profile });
        return id;
    }
    piece(recipe, profile = 'bts-context-v1/' + recipe.kind) {
        const spoken = Object.fromEntries(['before', 'text', 'after'].map(key => [key, spellNumbers(recipe[key] || '')]));
        const full = spoken.before + spoken.text + spoken.after;
        if (full !== spellNumbers(recipe.before + recipe.text + recipe.after)) throw new Error('Number spelling changes a source boundary');
        const source = this.source(full, 'bts-context-v1/source', recipe.before + recipe.text + recipe.after);
        const item = { source, ...spoken, kind: recipe.kind, profile, display: recipe.text };
        const id = 'p-' + digest(item).slice(0, 20);
        this.pieces.set(id, { id, ...item }); return id;
    }
    whole(text, profile = 'bts-context-v1/full-reference') {
        const spoken = spellNumbers(text);
        const source = this.source(spoken);
        const item = { source, text: spoken, before: '', after: '', kind: 'game', profile, display: text };
        const id = 'p-' + digest(item).slice(0, 20);
        this.pieces.set(id, { id, ...item }); return id;
    }
    export() {
        return { schema: 1, strategy: 'bts-context-v1-benchmark', production_strategy: 'bts-context-v1',
            pronunciation: { numbers: pronunciationVersion, normalizations_sha256: digest(this.normalizations),
                normalizations: this.normalizations }, sources: [...this.sources.values()], pieces: [...this.pieces.values()], cases: this.cases };
    }
}

function baseline(normalizations = []) {
    const plan = new Plan(normalizations);
    const tournament = { key: 'lab', language: 'de', normalizations,
        annoncement_include_event: true, annoncement_include_round: true, annoncement_include_matchnumber: true,
        preparation_meetingpoint_enabled: true, tabletoperator_enabled: true,
        speech: { context_version: 'bts-context-v1' },
        locations: [{ _id: 'default_h1', preparation_addition: 'in Halle eins!',
            meetingpoint_announcement: 'Bitte {melde dich/meldet euch} bei der Turnierleitung in Halle eins an!' }],
        courts: [{ _id: 'default_8', num: 8, location_id: 'default_h1', is_active: true }] };
    const setup = { state: 'preparation', event_name: 'ME U19', match_name: 'R16', match_num: 189,
        court_id: 'default_8', location_id: 'default_h1',
        teams: [{ players: [{ name: 'Max Mustermann' }] }, { players: [{ name: 'Hans Dampf' }] }] };
    for (const [id, name, changes, tournament_changes, args] of [
        ['D01', 'announceNewMatch', {}, {}, []],
        ['D05', 'announceSecondPreparationCallTeamOne', {}, {}, []],
        ['D08', 'announceSecondCallTabletoperator', { tabletoperators: [{ name: 'Erika Musterfrau' }, { name: 'Otto Normalverbraucher' }] },
            { tabletoperator_use_manual_counting_boards_enabled: true }, []],
        ['D12', 'announceNoMatchWin', {}, {}, [0]],
    ]) {
        let capture;
        const texts = create({ tournament: { ...tournament, ...tournament_changes },
            translate: (key, data, fallback) => translate('de', key, data, fallback),
            window: { localStorage: { getItem: () => 'true' } }, claim: () => null,
            announce: (browser, _local, _claim, options) => { capture = { browser, ...options }; } });
        texts[name]({ ...setup, ...changes }, ...args);
        const pieces = capture.localParts.map((part, index) => ({ piece: plan.piece(context.decode(part, 1200)),
            pause_ms: capture.localPauses[index] || 0 }));
        plan.cases.push({ id: id + '-v1', group: 'baseline', label: id + ' · unveränderte v1-Montage', pieces,
            display: capture.browser.join(' '), subjective_quality: 'not-rated' });
        const joined = pieces.map(item => plan.pieces.get(item.piece).text).join(' ');
        plan.cases.push({ id: id + '-full', group: 'baseline', label: id + ' · vollständige Kontextreferenz',
            pieces: [{ piece: plan.whole(joined), pause_ms: 0 }], display: joined, subjective_quality: 'not-rated' });
    }
    return plan.export();
}

if (require.main === module) {
    const index = process.argv.indexOf('--tournament');
    const tournament = index < 0 ? {} : JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
    process.stdout.write(JSON.stringify(baseline(tournament.normalizations || []), null, 2) + '\n');
}
module.exports = { baseline, Plan, digest };
