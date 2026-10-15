'use strict';

const assert = require('assert');
const create = require('../static/js/speech_readiness');
const createTexts = require('../static/js/announcement_text');
const { _translate: translate } = require('../static/js/ci18n');
const { tournament, setup } = require('./test_speech_text');

function element() {
    return { isConnected: true, visible: true, dataset: {}, title: 'Spiel aufrufen', textContent: '',
        setAttribute(name, value) { this[name] = value; } };
}

function harness() {
    const current = { ...tournament(), matches: [{ _id: 'match1', setup: setup() }] };
    const settings = { key: 'default', enabled: true, voice: 'hallensprecherin', language: 'de-DE',
        mode: 'auto', max_text: 1200, audio_ready: true };
    const requests = [], statuses = new Map();
    let time = 100000;
    const h = { current, settings, requests, statuses, version: 'one', error: null, fail: false };
    const service = { inspect: async parts => {
        requests.push([...parts]);
        if (h.pending) await h.pending;
        return h.fail ? null : { speech: { enabled: true, cache_version: h.version, last_error: h.error },
            clips: parts.map(text => ({ status: statuses.get(settings.voice + text) || 'missing' })) };
    } };
    h.ready = (text, voice = settings.voice) => statuses.set(voice + text, 'completed');
    h.advance = ms => { time += ms; };
    h.controller = create({ createTexts, translate: (...args) => translate('de', ...args), service,
        snapshot: () => ({ tournament: current, settings }), now: () => time,
        visible: target => target.visible });
    return h;
}

describe('Announcement cache readiness indicators', function() {
    it('never shows a green check for browser mode, blocked audio or a failed audio download', async function() {
        const h = harness(), target = element();
        h.controller.trackText(target, () => ['Text']);
        h.ready('Text');
        await h.controller.refresh();
        assert.strictEqual(target.dataset.speechState, 'ready');
        h.settings.mode = 'browser';
        h.controller.changed();
        assert.strictEqual(target.dataset.speechState, 'browser');
        h.settings.mode = 'auto';
        h.settings.audio_ready = false;
        h.controller.changed();
        assert.strictEqual(target.dataset.speechState, 'locked');
        h.settings.audio_ready = true;
        h.settings.audio_error = 'audio_failed';
        h.controller.changed();
        assert.strictEqual(target.dataset.speechState, 'audio_error');
        h.settings.audio_error = null;
        h.controller.changed();
        assert.strictEqual(target.dataset.speechState, 'ready');
    });
    it('marks a whole call green only after every exact part is ready', async function() {
        const h = harness(), target = element();
        h.controller.trackMatch(target, 'match1', 'match:manualcall');
        await h.controller.refresh();
        assert.strictEqual(target.dataset.speechState, 'missing');
        const parts = h.requests[0];
        assert(parts.includes('Johann Bjarne Schöttmer'));
        assert(parts.includes('gegen'));
        assert(parts.includes('Muhammad Sytsh Abdulquddus'));
        for (const text of parts.slice(1)) h.ready(text);
        h.statuses.set(h.settings.voice + parts[0], 'processing');
        await h.controller.refresh(true);
        assert.strictEqual(target.dataset.speechState, 'preparing');
        assert(target.title.includes((parts.length - 1) + '/' + parts.length));
        h.ready(parts[0]);
        await h.controller.refresh(true);
        assert.strictEqual(target.dataset.speechState, 'ready');
        assert(target['aria-label'].includes('Lokal bereit'));
        assert(target.title.startsWith('Spiel aufrufen\n'));
    });

    it('uses the playback builders for all call buttons, including preparation repeats', async function() {
        const h = harness();
        const actions = [
            ['match:manualcall', false, 'announceNewMatch'],
            ['match:preparationcall', true, 'announcePreparationMatch'],
            ['match:begintoplay', false, 'announceBeginnToPlay'],
            ...[['teamone', 'TeamOne'], ['teamtwo', 'TeamTwo'], ['umpire', 'Umpire'],
                ['servicejudge', 'ServiceJudge'], ['tabletoperator', 'Tabletoperator']].flatMap(([title, suffix]) =>
                [false, true].map(preparation => [
                    'match:secondcal' + (suffix === 'Tabletoperator' ? '' : 'l') + title, preparation,
                    'announceSecond' + (preparation ? 'Preparation' : '') + 'Call' + suffix,
                ])),
        ];
        const expected = [], targets = [];
        const texts = createTexts({ local: true, tournament: h.current, translate: (...args) => translate('de', ...args),
            window: { localStorage: { getItem: () => 'true' } }, claim: () => null,
            announce: parts => expected.push(...parts.filter(Boolean)) });
        for (const [title, preparation, call] of actions) {
            const target = element();
            targets.push(target);
            h.controller.trackMatch(target, 'match1', title, preparation);
            texts[call](h.current.matches[0].setup);
        }
        for (const text of expected) h.ready(text);
        await h.controller.refresh();
        assert.deepStrictEqual(new Set(h.requests.flat()), new Set(expected));
        assert(targets.every(target => target.dataset.speechState === 'ready'));
    });

    it('marks a start call ready only when both reusable clips are complete', async function() {
        const h = harness(), target = element();
        h.controller.trackMatch(target, 'match1', 'match:begintoplay');
        await h.controller.refresh();
        assert.deepStrictEqual(h.requests[0], ['Auf Spielfeld 4', 'Bitte mit dem Spielen beginnen']);
        h.ready('Auf Spielfeld 4');
        await h.controller.refresh(true);
        assert.strictEqual(target.dataset.speechState, 'missing');
        assert(target.title.includes('1/2'));
        h.ready('Bitte mit dem Spielen beginnen');
        await h.controller.refresh(true);
        assert.strictEqual(target.dataset.speechState, 'ready');
    });

    it('checks the selected hall meetingpoint without changing the match setup', async function() {
        const h = harness(), one = element(), two = element();
        h.current.locations.push({ _id: 'hall2', preparation_addition: 'Halle zwei!',
            meetingpoint_announcement: 'Bitte in Halle zwei melden!' });
        h.controller.trackMatch(one, 'match1', 'match:preparationcall', true, 'default_h1');
        h.controller.trackMatch(two, 'match1', 'match:preparationcall', true, 'hall2');
        await h.controller.refresh();
        for (const text of h.requests.flat()) if (!text.includes('zwei')) h.ready(text);
        await h.controller.refresh(true);
        assert.strictEqual(one.dataset.speechState, 'ready');
        assert.strictEqual(two.dataset.speechState, 'missing');
        assert.strictEqual(h.current.matches[0].setup.location_id, 'default_h1');
    });

    it('discards a late answer for another voice and clears its green indicators immediately', async function() {
        const h = harness(), target = element();
        h.controller.trackText(target, () => ['Originaltext']);
        h.ready('Originaltext');
        await h.controller.refresh();
        assert.strictEqual(target.dataset.speechState, 'ready');
        let release;
        h.pending = new Promise(resolve => { release = resolve; });
        const pending = h.controller.refresh(true);
        h.settings.voice = 'hallensprecher';
        h.controller.changed();
        assert.strictEqual(target.dataset.speechState, 'checking');
        release();
        await pending;
        assert.strictEqual(target.dataset.speechState, 'checking');
        await h.controller.refresh(true);
        assert.strictEqual(target.dataset.speechState, 'missing');
        assert(target.title.includes('Hallensprecher ·'));
    });

    it('rechecks changed text even if an earlier request is still in flight', async function() {
        const h = harness(), target = element();
        let text = ' Ä\nU17 ';
        h.controller.trackText(target, () => [text], true);
        h.ready(text);
        let release;
        h.pending = new Promise(resolve => { release = resolve; });
        const pending = h.controller.refresh();
        text = 'Neuer Text';
        h.controller.changed();
        release();
        await pending;
        assert.strictEqual(target.dataset.speechState, 'checking');
        assert.strictEqual(h.requests[0][0], ' Ä\nU17 ');
        await h.controller.refresh(true);
        assert.strictEqual(target.dataset.speechState, 'missing');
        h.ready(text);
        await h.controller.refresh(true);
        assert.strictEqual(target.textContent, 'Lokal bereit (1/1)');
    });

    it('clears ready observations when the synthesis configuration changes', async function() {
        const h = harness(), target = element(), other = element();
        h.controller.trackText(target, () => ['Text']);
        h.controller.trackText(other, () => ['Anderer Text']);
        h.ready('Text');
        h.ready('Anderer Text');
        await h.controller.refresh();
        assert.strictEqual(other.dataset.speechState, 'ready');
        other.visible = false;
        h.version = 'two';
        h.statuses.clear();
        await h.controller.refresh(true);
        assert.strictEqual(target.dataset.speechState, 'missing');
        assert.strictEqual(other.dataset.speechState, 'checking');
    });

    it('shows failures and unavailable status instead of stale readiness', async function() {
        const h = harness(), target = element();
        h.controller.trackText(target, () => ['Text']);
        h.ready('Text');
        await h.controller.refresh();
        h.fail = true;
        await h.controller.refresh(true);
        assert.strictEqual(target.dataset.speechState, 'unavailable');
        h.fail = false;
        h.error = 'speech_unavailable';
        await h.controller.refresh(true);
        assert.strictEqual(target.dataset.speechState, 'unavailable');
        h.error = null;
        h.statuses.set(h.settings.voice + 'Text', 'failed');
        await h.controller.refresh(true);
        assert.strictEqual(target.dataset.speechState, 'failed');
    });

    it('does not inspect disabled, unsupported, empty or disconnected controls', async function() {
        const h = harness(), target = element();
        h.settings.enabled = false;
        h.controller.trackText(target, () => ['Text']);
        await h.controller.refresh();
        assert.strictEqual(target.dataset.speechState, 'disabled');
        h.settings.enabled = true;
        h.settings.language = 'en-GB';
        await h.controller.refresh();
        assert.strictEqual(target.dataset.speechState, 'unsupported');
        h.settings.language = 'de-DE';
        target.isConnected = false;
        await h.controller.refresh();
        const empty = element();
        h.controller.trackText(empty, () => ['']);
        await h.controller.refresh();
        assert.strictEqual(empty.dataset.speechState, 'empty');
        assert.strictEqual(h.requests.length, 0);
    });

    it('retains controls registered before their containing fragment is attached', async function() {
        const h = harness(), target = element();
        target.isConnected = false;
        h.controller.trackText(target, () => ['Text']);
        target.isConnected = true;
        h.ready('Text');
        await h.controller.refresh();
        assert.strictEqual(target.dataset.speechState, 'ready');
    });

    it('bounds and deduplicates inspections, prioritizes visible controls and expires old green states', async function() {
        const h = harness(), targets = [];
        for (let i = 0; i < 160; i++) {
            const target = element();
            targets.push(target);
            h.ready('Text ' + i);
            h.controller.trackText(target, () => ['Text ' + i, 'Text ' + i]);
        }
        await h.controller.refresh();
        assert.deepStrictEqual(h.requests.map(parts => parts.length), [64, 64]);
        await h.controller.refresh();
        assert.strictEqual(h.requests.length, 2, 'rerendering must not flood the admin socket');
        h.advance(5000);
        await h.controller.refresh();
        assert(targets.every(target => target.dataset.speechState === 'ready'));
        targets[0].visible = false;
        h.advance(16000);
        await h.controller.refresh();
        assert.strictEqual(targets[0].dataset.speechState, 'checking');
    });
});
