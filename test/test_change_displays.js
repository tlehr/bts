'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const utils = require('../static/bup/dev/js/utils');

function harness(displays = []) {
    const calls = { update: [], options: [], settings: [], deleted: [] };
    const context = { curt: { displays }, utils, cerror: { silent() {} }, ctournament: {
        update_display(display, options) { calls.update.push(display);calls.options.push(options); },
        update_general_displaysettings(change) { calls.settings.push(change); },
        delete_display(change) { calls.deleted.push(change); },
    } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/change'), 'utf8'), context);
    const handle = context.change.default_handler(() => assert.fail('display changes must not rebuild the games'));
    return { context, calls, status: display => handle({ ctype: 'display_status_changed', val: { display_court_displaysetting: display } }), handle };
}

describe('Live display metadata', function() {
    it('notifies the view immediately when a new device connects', function() {
        const h = harness(), display = { client_id: 'new', online: true, panel_devicemode: 'umpire', battery: { level: 0.25 } };
        h.status(display);
        assert.strictEqual(h.context.curt.displays.length, 1);
        assert.strictEqual(h.calls.update[0], display);
    });

    it('applies hostname, IP, mode and cleared battery without losing omitted assignment fields', function() {
        const display = { client_id: 'one', online: true, court_id: 'field', displaysetting_id: 'tablet', hostname: 'old', battery: { level: 0.8 } };
        const h = harness([display]);
        h.status({ client_id: 'one', hostname: 'new', client_ip: '192.168.1.2', panel_devicemode: 'umpire', battery: null });
        assert.strictEqual(display.hostname, 'new');
        assert.strictEqual(display.client_ip, '192.168.1.2');
        assert.strictEqual(display.panel_devicemode, 'umpire');
        assert.strictEqual(display.battery, null);
        assert.strictEqual(display.court_id, 'field');
        assert.strictEqual(display.displaysetting_id, 'tablet');
        assert.strictEqual(display.online, true);
        assert.strictEqual(h.calls.update.length, 1);
    });

    it('retains battery metadata when an offline notification omits it', function() {
        const display = { client_id: 'one', online: true, battery: { level: 0, charging: true } }, h = harness([display]);
        h.status({ client_id: 'one', online: false });
        assert.strictEqual(display.online, false);
        assert.strictEqual(display.battery.level, 0);
        assert.strictEqual(h.calls.update.length, 1);
    });

    it('deduplicates client records and refreshes settings when the profile changes', function() {
        const h = harness([{ client_id: 'one', displaysetting_id: 'old' }, { client_id: 'one', displaysetting_id: 'old' }]);
        h.status({ client_id: 'one', displaysetting_id: 'new', online: true });
        assert.strictEqual(h.context.curt.displays.length, 1);
        assert.strictEqual(h.calls.settings.length, 1);
        assert.strictEqual(h.calls.update.length, 1);
    });

    it('keeps acknowledgement traffic out of the tablet battery card while updating device state', function() {
        const display={client_id:'one',online:true},h=harness([display]);
        h.handle({ctype:'display_wait_for_done',val:{client_id:'one',ctype:'points',message_id:'one'}});
        assert.strictEqual(display.wait_for_done,true);
        h.handle({ctype:'display_is_done',val:{client_id:'one',ctype:'points',message_id:'one'}});
        assert.strictEqual(display.wait_for_done,false);
        assert(h.calls.options.every(options=>options.tablets===false));assert.strictEqual(h.calls.update.length,2);
    });

    it('refreshes tablet connection state from render statistics only when the device becomes online', function() {
        const display={client_id:'one',online:true},h=harness([display]);
        h.handle({ctype:'display_render_stats',val:{client_id:'one',display_render_stats:{ack_count:1}}});
        assert.strictEqual(h.calls.options[0].tablets,false);assert.strictEqual(display.display_render_stats.ack_count,1);
        display.online=false;
        h.handle({ctype:'display_render_stats',val:{client_id:'one',display_render_stats:{ack_count:2}}});
        assert.strictEqual(h.calls.options[1].tablets,true);assert.strictEqual(display.online,true);
    });

    it('skips the tablet card for status messages that only change render diagnostics', function() {
        const h=harness([{client_id:'one',online:true}]);
        h.status({client_id:'one',display_render_stats:{ack_count:1}});assert.strictEqual(h.calls.options[0].tablets,false);
        h.status({client_id:'one',battery:{level:.25}});assert.strictEqual(h.calls.options[1].tablets,true);
    });

    it('does not refresh unchanged metadata and removes deleted clients before notifying the view', function() {
        const display = { client_id: 'one', online: true, battery: { level: 0.25, charging: false } }, h = harness([display]);
        h.status(structuredClone(display));
        assert.strictEqual(h.calls.update.length, 0);
        h.handle({ ctype: 'delete_display', val: { client_id: 'one' } });
        assert.strictEqual(h.context.curt.displays.length, 0);
        assert.strictEqual(h.calls.deleted.length, 1);
    });
});
