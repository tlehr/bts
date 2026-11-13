'use strict';

const assert = require('assert');
const create = require('../static/js/speech_readiness');
const createTexts = require('../static/js/announcement_text');
const { _translate: translate } = require('../static/js/ci18n');
const { tournament, setup } = require('./test_speech_text');

function element() {
    const writes = [];
    const dataset = new Proxy({}, { set(target, key, value) { writes.push([key, value]); target[key] = value; return true; } });
    return { isConnected: true, visible: true, dataset, writes, title: 'Spiel aufrufen', textContent: '',
        setAttribute(name, value) { writes.push([name, value]); this[name] = value; } };
}

function harness({ texts = createTexts, schedule } = {}) {
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
            clips: parts.map(text => ({ status: statuses.get(settings.voice + text) || 'missing', local: h.local === true })) };
    } };
    h.ready = (text, voice = settings.voice) => statuses.set(voice + text, 'completed');
    h.advance = ms => { time += ms; };
    h.controller = create({ createTexts: texts, translate: (...args) => translate('de', ...args), service,
        snapshot: () => ({ tournament: current, settings }), now: () => time,
        visible: target => target.visible, schedule });
    return h;
}

describe('Announcement cache readiness indicators', function() {
    it('defers hidden text recipes and restores newly visible controls without keeping stale green states', async function() {
        const h = harness(), targets = [], reads = Array(100).fill(0);
        for (let i = 0; i < 100; i++) {
            const target = element(); target.visible = false; targets.push(target);
            h.ready('Hidden ' + i);
            h.controller.trackText(target, () => { reads[i]++; return ['Hidden ' + i]; });
        }
        assert(reads.every(count => count === 1), 'initial tracking still resolves the recipe before insertion');
        await h.controller.refresh(true); await h.controller.refresh(true);
        assert(reads.every(count => count === 1), 'shared refreshes must not rebuild invisible recipes');
        assert.strictEqual(h.requests.length, 0);
        targets[0].visible = true;
        await h.controller.refresh();
        assert.strictEqual(targets[0].dataset.speechState, 'ready');
        assert.deepStrictEqual(h.requests, [['Hidden 0']]);
        assert(reads.slice(1).every(count => count === 1));
        targets[0].visible = false; h.advance(16000);
        await h.controller.refresh();
        assert.strictEqual(targets[0].dataset.speechState, 'checking');
    });
    it('does not inspect the game inventory for free text or entirely hidden controls', async function() {
        const h=harness(), target=element();
        Object.defineProperty(h.current,'matches',{get(){assert.fail('Free-text readiness does not depend on matches');}});
        h.controller.trackText(target,()=>['Free announcement']);
        await h.controller.refresh();
        assert.strictEqual(target.dataset.speechState,'missing');
        target.visible=false;await h.controller.refresh(true);
        assert.strictEqual(target.dataset.speechState,'checking');
    });
    it('resolves newly tracked buttons without constructing an inventory and preserves last duplicate precedence', async function() {
        const h=harness(), target=element();
        const unknown={setup:setup()};
        Object.defineProperty(unknown,'_id',{get(){assert.fail('A newly tracked final game needs no full inventory');}});
        const first={_id:'match1',setup:{...setup(),match_num:111}}, last={_id:'match1',setup:{...setup(),match_num:222}};
        h.current.matches=[unknown,first,last];
        h.controller.trackMatch(target,'match1','match:manualcall');
        assert.notStrictEqual(target.dataset.speechState,'empty');
        // Shared refreshes still read the current full source and honor its
        // last duplicate, including in-place replacement and removal.
        h.current.matches=[first,last];await h.controller.refresh();
        const expected=[...h.requests.at(-1)];
        h.current.matches[1]={...last,setup:{...last.setup,teams:[{players:[{name:'Replacement player'}]},{players:[{name:'Second player'}]}]}};
        await h.controller.refresh(true);
        assert(h.requests.at(-1).includes('Replacement player'));
        assert.notDeepStrictEqual(h.requests.at(-1),expected);
        h.current.matches.pop();await h.controller.refresh(true);
        assert(!h.requests.at(-1).includes('Replacement player'));
    });
    it('coalesces cache pulses without reevaluating unchanged controls before the forced inspection', async function() {
        const scheduled = [], h = harness({ schedule: (callback, ms) => { scheduled.push({callback, ms}); return scheduled.length; } });
        const target = element(); let reads = 0;
        h.controller.trackText(target, () => { reads++; return ['Text']; });
        scheduled.shift().callback(); await h.controller.refresh();
        assert.strictEqual(target.dataset.speechState, 'missing');
        const before = reads;
        for (let i = 0; i < 20; i++) h.controller.cacheChanged();
        assert.strictEqual(reads, before, 'A progress pulse has no new answers to paint');
        assert.strictEqual(scheduled.length, 1, 'A burst shares the existing forced refresh');
        h.ready('Text');scheduled.shift().callback();await h.controller.refresh();
        assert.strictEqual(h.requests.length, 2, 'The forced inspection must bypass recent cached answers');
        assert.strictEqual(target.dataset.speechState, 'ready');
    });
    it('reuses exact call parts while rechecking readiness and invalidates mutable builder dependencies', async function() {
        let builds = 0;
        const h = harness({ texts(context) {
            const texts = createTexts(context), announce = texts.announceNewMatch;
            texts.announceNewMatch = (...args) => { builds++; return announce(...args); };
            return texts;
        } }), target = element();
        h.controller.trackMatch(target, 'match1', 'match:manualcall');
        await h.controller.refresh();
        const original = [...h.requests[0]];
        original.forEach(text => h.ready(text));
        for (let i = 0; i < 20; i++) await h.controller.refresh(true);
        assert.strictEqual(builds, 1, 'Readiness refreshes must reuse unchanged playback text');
        assert.strictEqual(target.dataset.speechState, 'ready');
        h.statuses.delete(h.settings.voice + original[0]);
        await h.controller.refresh(true);
        assert.strictEqual(target.dataset.speechState, 'missing', 'Text caching must never cache a readiness answer');
        assert.strictEqual(builds, 1);
        h.current.matches[0].setup.teams[0].players[0].name = 'Geänderter Spieler';
        await h.controller.refresh(true);
        assert.strictEqual(builds, 2);
        assert(h.requests.at(-1).includes('Geänderter Spieler'));
        h.current.normalizations ||= [];
        h.current.normalizations.push({origin:'Geänderter Spieler',replace:'Andere Aussprache',language:'de-DE'});
        await h.controller.refresh(true);
        assert.strictEqual(builds, 3);
        assert(h.requests.at(-1).includes('Andere Aussprache'));
        h.current.normalizations.at(-1).replace = 'Neue Aussprache';
        await h.controller.refresh(true);
        assert.strictEqual(builds, 4);
        assert(h.requests.at(-1).includes('Neue Aussprache'));
        h.current.annoncement_include_round = !h.current.annoncement_include_round;
        await h.controller.refresh(true);
        assert.strictEqual(builds, 5);
    });

    it('shows remote generation readiness independently of this device audio permission and preserves button labels', async function() {
        const h = harness(), local = element(), remote = element();
        local.textContent = 'Lokal Abspielen'; remote.textContent = 'Remote Abspielen';
        h.controller.trackText(local, () => ['Text']);
        h.controller.trackText(remote, () => ['Text'], false, { remote: true });
        h.ready('Text'); h.settings.audio_error = 'audio_blocked'; h.settings.audio_ready = false;
        await h.controller.refresh();
        assert.strictEqual(local.dataset.speechState, 'locked');
        assert.strictEqual(remote.dataset.speechState, 'ready');
        assert(remote.title.includes('Serveraudio bereit'));
        assert.strictEqual(local.textContent, 'Lokal Abspielen');
        assert.strictEqual(remote.textContent, 'Remote Abspielen');
        h.statuses.delete(h.settings.voice + 'Text');
        await h.controller.refresh(true);
        assert.strictEqual(remote.dataset.speechState, 'missing');
    });

    it('rehydrates rebuilt buttons immediately and never rewrites unchanged ready indicators', async function() {
        const h = harness(), old = element(), other = element();
        h.controller.trackText(old, () => ['One']); h.controller.trackText(other, () => ['Two']);
        h.ready('One'); h.ready('Two'); await h.controller.refresh();
        const writes = other.writes.length;
        old.isConnected = false;
        const rebuilt = element(); rebuilt.isConnected = false;
        h.controller.trackText(rebuilt, () => ['One']);
        assert.strictEqual(rebuilt.dataset.speechState, 'ready', 'the new DOM node must never start unknown');
        assert.deepStrictEqual(rebuilt.writes.filter(([key]) => key === 'speechState'), [['speechState', 'ready']]);
        rebuilt.isConnected = true;
        h.controller.changed(true); await h.controller.refresh(true);
        assert.strictEqual(other.writes.length, writes, 'an unchanged indicator has no DOM mutations');
        assert.strictEqual(rebuilt.writes.filter(([key]) => key === 'speechState').length, 1);
    });

    it('keeps visible ready states during revalidation and changes only the call whose result changed', async function() {
        const h = harness(), one = element(), two = element();
        h.controller.trackText(one, () => ['One']); h.controller.trackText(two, () => ['Two']);
        h.ready('One'); h.ready('Two'); await h.controller.refresh();
        const writes = two.writes.length;
        h.advance(16000);
        let release;
        h.pending = new Promise(resolve => { release = resolve; });
        const updating = h.controller.refresh(true);
        assert.strictEqual(one.dataset.speechState, 'ready');
        assert.strictEqual(two.dataset.speechState, 'ready');
        h.statuses.delete(h.settings.voice + 'One');
        release(); await updating;
        assert.strictEqual(one.dataset.speechState, 'missing');
        assert.strictEqual(two.dataset.speechState, 'ready');
        assert.strictEqual(two.writes.length, writes);
    });

    it('invalidates only changed announcement text while unrelated ready buttons stay untouched', async function() {
        const h = harness(), one = element(), two = element(); let text = 'One';
        h.controller.trackText(one, () => [text]); h.controller.trackText(two, () => ['Two']);
        h.ready('One'); h.ready('Two'); await h.controller.refresh();
        const writes = two.writes.length;
        text = 'Changed'; h.controller.changed();
        assert.strictEqual(one.dataset.speechState, 'checking');
        assert.strictEqual(two.dataset.speechState, 'ready');
        assert.strictEqual(two.writes.length, writes);
    });

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
        assert.strictEqual(target.dataset.speechState, 'checking');
        h.settings.audio_error = 'audio_blocked';
        h.controller.changed();
        assert.strictEqual(target.dataset.speechState, 'locked');
        assert(target.title.includes('normaler Klick oder Tastendruck'));
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
        assert.strictEqual(target.dataset.speechState, 'missing', 'the new voice is inspected automatically after the old response');
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
        assert.strictEqual(target.dataset.speechState, 'missing', 'the new text needs no second manual refresh');
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

    it('keeps verified locally stored calls ready while the generation server is offline', async function() {
        const h = harness(), target = element();
        h.controller.trackText(target, () => ['Text']);
        h.ready('Text'); h.local = true; h.error = 'speech_unavailable';
        await h.controller.refresh();
        assert.strictEqual(target.dataset.speechState, 'ready');
        h.local = false;
        await h.controller.refresh(true);
        assert.strictEqual(target.dataset.speechState, 'unavailable', 'remote-only references cannot promise offline playback');
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
        assert.deepStrictEqual(h.requests.map(parts => parts.length), [64, 64, 32], 'unknown visible parts need no four-second delay');
        await h.controller.refresh();
        assert.strictEqual(h.requests.length, 3, 'known recent parts must not flood the admin socket');
        h.advance(5000);
        await h.controller.refresh();
        assert(targets.every(target => target.dataset.speechState === 'ready'));
        targets[0].visible = false;
        h.advance(16000);
        await h.controller.refresh();
        assert.strictEqual(targets[0].dataset.speechState, 'checking');
    });

    it('retains a forced cache refresh received during an inspection and never overlaps requests', async function() {
        const h = harness(), target = element();
        h.controller.trackText(target, () => ['Text']);
        h.statuses.set(h.settings.voice + 'Text', 'processing');
        await h.controller.refresh();
        assert.strictEqual(target.dataset.speechState, 'preparing');
        let release;
        h.pending = new Promise(resolve => { release = resolve; });
        const first = h.controller.refresh(true);
        const again = h.controller.refresh(true);
        for (let i = 0; i < 20; i++) h.controller.cacheChanged();
        assert.strictEqual(first, again);
        assert.strictEqual(h.requests.length, 2, 'the follow-up must wait for the current request');
        h.ready('Text');
        release();
        await again;
        assert.strictEqual(h.requests.length, 3, 'the forced follow-up must bypass the recent status cache');
        assert.strictEqual(target.dataset.speechState, 'ready');
    });

    it('immediately inspects newly visible controls while keeping recent visible observations cached', async function() {
        const h = harness(), one = element(), two = element();
        two.visible = false;
        h.controller.trackText(one, () => ['One']);
        h.controller.trackText(two, () => ['Two']);
        h.ready('One'); h.ready('Two');
        await h.controller.refresh();
        assert.deepStrictEqual(h.requests, [['One']]);
        two.visible = true;
        await h.controller.refresh();
        assert.deepStrictEqual(h.requests, [['One'], ['Two']]);
        assert.strictEqual(two.dataset.speechState, 'ready');
    });
});
