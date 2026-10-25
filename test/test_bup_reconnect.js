'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = name => fs.readFileSync(path.join(__dirname, '../static/bup/dev/js', name), 'utf8');

describe('BUP display recovery', function() {
    it('reports loading after reconnection until the tournament state has arrived', function() {
        const sockets = [], timers = [], received = [];
        class WebSocket {
            static OPEN = 1;
            static CLOSED = 3;
            static CLOSING = 2;
            constructor() { this.readyState = 0; sockets.push(this); }
        }
        const context = vm.createContext({ WebSocket, URLSearchParams, console,
            window: { location: { search: '', hash: '', protocol: 'http:', hostname: 'localhost', port: 4433 } },
            state: { settings: { devicemode: 'display' }, _: key => key },
            network: { errstate() {} }, settings: { get_mode: () => 'display' },
            refmode_client_ui: { get_node_id: () => 'test-display' }, match_storage: { remove_all() {} },
            setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
        });
        vm.runInContext(source('btsh.js'), context);
        context.btsh('', 'default').subscribe(context.state, (error, state, event) => received.push({ error, event }));
        sockets[0].onclose(); timers.shift()();
        assert.strictEqual(received[0].error.type, 'network-error');
        sockets[1].readyState = WebSocket.OPEN; sockets[1].onopen();
        assert.strictEqual(received.at(-1).error?.errtype, 'loading');
        assert.strictEqual(received.at(-1).event, null);
        assert(!received.some(row => !row.error && row.event === null));
    });

    it('keeps the loading view when a provider has not supplied an event yet', function() {
        const rendered = [];
        const context = vm.createContext({ console, document: { querySelector: () => null },
            network: { reload_match_information() {} }, uiu: { qs: () => ({}), remove_qsa() {},
            el(_parent, _tag, className) { rendered.push(className); } } });
        vm.runInContext(source('displaymode.js'), context);
        context.displaymode.on_style_change({ settings: {}, ui: { displaymode_visible: true }, event: null });
        assert.deepStrictEqual(rendered, ['display_loading']);
    });
});
