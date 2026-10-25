'use strict';
const assert = require('assert');
const { Plan, digest } = require('../scripts/tts-context-benchmark-plan');
const { repeatedTeam } = require('../scripts/tts-gameblock-context-plan');
const { secondCalls, lexemes } = require('../scripts/tts-second-call-plan');

function catalogue(cachedNormal = true, single = 'Hans Dampf') {
    const plan = new Plan();
    repeatedTeam(plan, single, single);
    repeatedTeam(plan, 'Erika Musterfrau und Otto Normalverbraucher', 'Erika Musterfrau und Otto Normalverbraucher');
    repeatedTeam(plan, 'Max Mustermann', 'Max Mustermann');
    function part(text, profile, before = '', after = '', kind = 'generic', display = text) {
        const source = plan.source(before + text + after, 'fixture');
        const value = { source, before, text, after, kind, profile, display }, id = 'p-' + digest(value).slice(0, 20);
        plan.pieces.set(id, { id, ...value });
    }
    for (const role of ['umpire', 'service', 'tablet', 'board']) {
        part({ umpire: 'Schiedsrichter', service: 'Aufschlagrichter', tablet: 'Tabletbedienung', board: 'Klapptafelbedienung' }[role],
            'lab-v2/B08-role' + (role === 'tablet' ? '' : '-' + role), 'Die Rolle ist ', '.');
    }
    part('Auf Spielfeld acht!', 'lab-v2/field_start', '', ' Spiel eins. Auf Spielfeld acht!', 'field_start', 'Auf Spielfeld 8!');
    part('Auf Spielfeld acht!', 'lab-v2/field_end', 'Auf Spielfeld acht! Spiel eins. ', '', 'field_end', 'Auf Spielfeld 8!');
    part('In Vorbereitung!', 'lab-v2/B09-opening', '', ' Spiel eins. Das Spiel ist in Vorbereitung!');
    if (cachedNormal) {
        const full = 'Auf Spielfeld acht! Zweiter Aufruf für:Tabletbedienung:Hans Dampf';
        part('Zweiter Aufruf für:', 'lab-v2/B11-normal', 'Auf Spielfeld acht! ', 'Tabletbedienung:Hans Dampf');
        part(full, 'lab-v2/role-full-reference', '', '', 'game');
    }
    return { ...plan.export(), strategy: 'bts-context-v2-lab-only',
        origins: Object.fromEntries([...plan.pieces.keys()].map(k => [k, { run: '/approved', sha256: 'a'.repeat(64) }])) };
}

const current = { locations: [{ _id: 'campus', name: 'Campus', preparation_addition: '', meetingpoint_announcement: '' }],
    preparation_meetingpoint_enabled: false };

describe('B11 second calls from browser texts and approved audio', function() {
    it('reuses the male normal prefix, creates one context for preparation and D11, and preserves every browser word', function() {
        const existing = catalogue(), snapshot = JSON.stringify(existing), plan = secondCalls(existing, current);
        assert.strictEqual(JSON.stringify(existing), snapshot);
        assert.strictEqual(new Set(plan.pieces.filter(p => plan.scope.new_pieces.includes(p.id)).map(p => p.source)).size, 1);
        assert.strictEqual(plan.scope.new_pieces.length, 3);
        const calls = plan.cases.filter(c => /^D\d\d$/.test(c.experiment));
        assert.strictEqual(calls.length, 20);
        assert.deepStrictEqual(new Set(calls.map(c => c.experiment)), new Set(['D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11']));
        for (const c of calls) {
            assert.strictEqual(lexemes(c.pieces.map(p => plan.pieces.find(k => k.id === p.piece).text).join(' ')), lexemes(c.browser_texts.join(' ')));
            assert(c.pieces.every(p => !plan.scope.new_pieces.includes(p.piece) ||
                !plan.pieces.find(k => k.id === p.piece).profile.startsWith('lab-v2/team')));
        }
        const requests = plan.pieces.filter(p => p.profile === 'lab-v2/D11-request');
        assert.strictEqual(requests.length, 1, 'same request shared between individuals, doubles and counting boards');
        assert.strictEqual(requests[0].text, 'bitte als Tabletbedienung');
        assert(calls.filter(c => c.experiment === 'D11').every(c => c.pieces.at(-1).piece === requests[0].id));
        for (const id of Object.keys(plan.scope.reused_piece_origins)) assert.deepStrictEqual(plan.pieces.find(p => p.id === id), existing.pieces.find(p => p.id === id));
    });
    it('adds only one further source when the normal prefix is missing', function() {
        const plan = secondCalls(catalogue(false), current);
        assert.strictEqual(new Set(plan.pieces.filter(p => plan.scope.new_pieces.includes(p.id)).map(p => p.source)).size, 2);
        assert.strictEqual(plan.scope.new_pieces.length, 5);
        for (const p of plan.pieces) assert.strictEqual(p.before + p.text + p.after, plan.sources.find(s => s.id === p.source).text);
    });
    it('uses real per-location singular/plural settings and preserves the current D11 browser wording', function() {
        const plan = secondCalls(catalogue(), { preparation_meetingpoint_enabled: true, locations: [
            { _id: 'one', name: 'Halle A', preparation_addition: 'in Halle 2', meetingpoint_announcement: 'Bitte {melde dich/meldet euch} am Eingang!' },
            { _id: 'two', name: 'Halle B', preparation_addition: '', meetingpoint_announcement: '' },
        ] });
        const calls = plan.cases.filter(c => c.experiment === 'D05');
        assert(calls.find(c => c.location_id === 'one' && c.id.endsWith('single')).display.includes('Bitte melde dich am Eingang!'));
        assert(calls.find(c => c.location_id === 'one' && c.id.endsWith('double')).display.includes('Bitte meldet euch am Eingang!'));
        assert(!calls.find(c => c.location_id === 'two').display.includes('Eingang'));
        assert(plan.pieces.some(p => p.profile === 'lab-v2/second-call-hall' && p.text === 'in Halle zwei'));
        assert(plan.pieces.some(p => p.profile === 'lab-v2/second-call-meeting' && p.text === 'Bitte melde dich am Eingang!'));
        const d11 = plan.cases.find(c => c.experiment === 'D11' && c.location_id === 'one' && c.id.endsWith('single'));
        assert(d11.display.includes('Bitte melde dich am Eingangmelden!'), 'do not silently repair legacy browser grammar in local audio');
    });
    it('keeps numbers in displayed names while expanding only the synthesized text', function() {
        const existing = catalogue(false, 'Hans Dampf 2');
        for (const p of existing.pieces.filter(p => p.display?.includes('Hans Dampf 2'))) {
            const source = existing.sources.find(s => s.id === p.source);
            for (const key of ['text', 'before', 'after']) p[key] = p[key].replaceAll('Dampf 2', 'Dampf zwei');
            source.text = source.text.replaceAll('Dampf 2', 'Dampf zwei');
        }
        const plan = secondCalls(existing, current);
        assert(plan.cases.find(c => c.id === 'D04-single').display.includes('Hans Dampf 2'));
        assert(plan.sources.some(s => s.text.includes('Hans Dampf zwei')));
    });
    it('rejects incomplete cached audio or changed pronunciation versions', function() {
        assert.throws(() => secondCalls({ strategy: 'v1' }, current), /v2/);
        const broken = catalogue(); broken.pieces = broken.pieces.filter(p => p.profile !== 'lab-v2/field_end');
        assert.throws(() => secondCalls(broken, current), /complete cached piece/);
        const wrong = catalogue(); wrong.pronunciation.numbers = 'outdated';
        assert.throws(() => secondCalls(wrong, current), /Pronunciation/);
    });
});
