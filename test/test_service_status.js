'use strict';

const assert = require('assert');
const {createMonitor, speechOutputState} = require('../static/js/service_status');
const admin = require('../bts/admin');
const btp = require('../bts/btp_manager'), ticker = require('../bts/ticker_manager');

function monitor() {
    let now = 0, key = 'one', repeat;
    const requests = [], applied = [], cancelled = [], failures = [], timeouts = new Map();
    let timer = 0;
    const value = createMonitor({
        now: () => now, key: () => key,
        request: (key, callback) => {requests.push({key, callback});return requests.length;},
        cancel: id => cancelled.push(id), apply: snapshot => applied.push(snapshot), failed: error => failures.push(error),
        repeat: (callback, interval) => {assert.strictEqual(interval, 5000);repeat = callback;return 1;}, clearRepeat() {},
        later: callback => {timeouts.set(++timer, callback);return timer;}, clearLater: id => timeouts.delete(id),
    });
    return {value, requests, applied, cancelled, failures, timeouts,
        tick() {now += 5000;repeat();}, key(value) {key = value;},
        answer(index, services) {requests[index].callback(null, {services});},
    };
}

describe('Service status refresh', function() {
    it('refreshes all services on opening and every five seconds, including when BTP is off', function() {
        const h = monitor();h.value.start();assert.strictEqual(h.requests.length, 0);
        h.value.connected(true);assert.strictEqual(h.requests.length, 1);
        const services = {btp:{status:'deactivated'}, ticker:{status:'error'}, speech:{enabled:true}, speech_health:{state:'error'}};
        h.answer(0, services);assert.deepStrictEqual(h.applied, [services]);
        h.value.start();assert.strictEqual(h.requests.length, 1, 'SPA navigation reuses the same refresh interval');
        h.tick();assert.strictEqual(h.requests.length, 2);
        h.answer(1, {...services, ticker:{status:'connected'}});assert.strictEqual(h.applied[1].ticker.status, 'connected');
        h.value.stop();assert.strictEqual(h.timeouts.size, 0);
    });

    it('refreshes immediately after a sync, coalesces concurrent refreshes and preserves newer direct updates', function() {
        const h = monitor();h.value.connected(true);
        h.value.changed('btp');h.value.changed('speech_health');
        h.value.refresh(true);h.value.refresh(true);assert.strictEqual(h.requests.length, 1);
        h.answer(0, {btp:{status:'connecting'}, ticker:{status:'connected'}, speech_health:{state:'error'}});
        assert.deepStrictEqual(h.applied, [{ticker:{status:'connected'}}]);
        assert.strictEqual(h.requests.length, 2, 'one followup captures the completed sync');
        h.answer(1, {btp:{status:'connected'}, speech_health:{state:'ok'}});
        assert.strictEqual(h.applied[1].btp.status, 'connected');
        h.value.refresh(true);assert.strictEqual(h.requests.length, 3, 'manual refresh does not wait for the five-second timer');
        h.value.stop();
    });

    it('cancels old requests on tournament switches and disconnects, and refreshes immediately on reconnect', function() {
        const h = monitor();h.value.connected(true);h.key('two');h.value.start();
        assert.deepStrictEqual(h.cancelled, [1]);assert.strictEqual(h.requests[1].key, 'two');
        h.answer(0, {ticker:{status:'connected'}});assert.strictEqual(h.applied.length, 0);
        h.value.connected(false);assert.deepStrictEqual(h.cancelled, [1, 2]);
        h.answer(1, {ticker:{status:'error'}});assert.strictEqual(h.applied.length, 0);
        h.tick();assert.strictEqual(h.requests.length, 2);
        h.value.connected(true);assert.strictEqual(h.requests.length, 3);
        h.answer(2, {ticker:{status:'connected'}});assert.strictEqual(h.applied.length, 1);
        h.value.stop();
    });

    it('reports a silent connection timeout, drops late replies and retries without accumulating callbacks', function() {
        const h = monitor();h.value.start();h.value.connected(true);
        [...h.timeouts.values()][0]();assert.strictEqual(h.failures.length, 1);assert.deepStrictEqual(h.cancelled, [1]);
        h.answer(0, {ticker:{status:'connected'}});assert.strictEqual(h.applied.length, 0);
        h.tick();assert.strictEqual(h.requests.length, 2);h.answer(1, {ticker:{status:'connected'}});
        assert.strictEqual(h.applied.length, 1);assert.strictEqual(h.timeouts.size, 0);h.value.stop();
    });
});

describe('Current speech output status', function() {
    const input = {connected:true, settings:{enabled:true, mode:'server', audio_ready:true}, health:{state:'ok', issues:[]}, check:{status:'active'}};
    it('replaces the stored successful test with current failure, recovery and local audio permission', function() {
        assert.strictEqual(speechOutputState(input).status, 'active');
        assert.strictEqual(speechOutputState({...input, health:{state:'error', issues:[{message:'Sprachserver nicht erreichbar'}]}}).status, 'error');
        assert.strictEqual(speechOutputState(input).status, 'active');
        for (const settings of [{audio_ready:false}, {audio_error:'audio_blocked'}, {last_error:'speech_unavailable'}, {enabled:false}]) {
            assert.notStrictEqual(speechOutputState({...input, settings:{...input.settings, ...settings}}).status, 'active');
        }
        assert.strictEqual(speechOutputState({...input, connected:false}).status, 'waiting');
        assert.strictEqual(speechOutputState({...input, busy:true}).status, 'running');
    });
    it('keeps the browser test separate from the server connection and detects unsupported browsers', function() {
        const browser = {...input, settings:{mode:'browser'}, health:{state:'error'}};
        assert.deepStrictEqual(speechOutputState(browser), input.check);
        assert.strictEqual(speechOutputState({...browser, check:{status:'error'}}).status, 'error');
        assert.strictEqual(speechOutputState({...browser, browserSupported:false}).status, 'unsupported');
        assert.deepStrictEqual(speechOutputState({...browser, settings:{mode:'auto', enabled:false}}), input.check);
    });
    it('waits for the selected server voice rather than reporting readiness for a missing voice', function() {
        const settings = {...input.settings, voice:'hallensprecherin', voices:[]};
        assert.strictEqual(speechOutputState({...input, settings}).status, 'waiting');
        settings.voices = [{voice_id:'hallensprecher'}];
        assert.strictEqual(speechOutputState({...input, settings}).status, 'error');
        settings.voices.push({voice_id:'hallensprecherin'});
        assert.strictEqual(speechOutputState({...input, settings}).status, 'active');
    });
});

describe('Admin service status snapshot', function() {
    let originalBtp, originalTicker;
    beforeEach(function() {originalBtp = btp.get_status;originalTicker = ticker.get_status;});
    afterEach(function() {btp.get_status = originalBtp;ticker.get_status = originalTicker;});
    it('reads live manager and speech states without database access, new jobs or exposing credentials', function() {
        let online = false;
        btp.get_status = key => ({status:online ? 'connected' : 'error', message:key, fetch_in_progress:!online});
        ticker.get_status = () => ({status:online ? 'connected' : 'deactivated'});
        const app = {speech:{
            broker:{config:{api_key:'private-key'}, public_config:voice => ({enabled:true, voice, last_error:online ? null : 'speech_unavailable'})},
            prefetch:{settings:key => ({voice:'hallensprecher', mode:'server', key})},
            health:{snapshot:() => ({state:online ? 'ok' : 'error', issues:[]})},
        }};
        const answers = [], ws = {respond:(_msg, error, answer) => {assert.ifError(error);answers.push(answer.services);}};
        const msg = {type:'service_status', tournament_key:'one'};
        admin.handle_service_status(app, ws, msg);online = true;admin.handle_service_status(app, ws, msg);
        assert.strictEqual(answers[0].btp.status, 'error');assert.strictEqual(answers[1].btp.status, 'connected');
        assert.strictEqual(answers[0].ticker.status, 'deactivated');assert.strictEqual(answers[1].ticker.status, 'connected');
        assert.strictEqual(answers[0].speech_health.state, 'error');assert.strictEqual(answers[1].speech_health.state, 'ok');
        assert.strictEqual(answers[1].speech.voice, 'hallensprecher');assert(!JSON.stringify(answers).includes('private-key'));
    });
    it('handles a disabled speech service and rejects requests missing a tournament key', function() {
        let result;
        admin.handle_service_status({}, {respond:(_msg, error, answer) => {assert.ifError(error);result = answer;}}, {tournament_key:'unused'});
        assert.strictEqual(result.services.speech.enabled, false);assert.strictEqual(result.services.speech_health.state, 'ok');
        admin.handle_service_status({}, {respond:(_msg, error) => {assert(error.message.includes('tournament_key'));}}, {type:'service_status'});
    });
});
