'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { _normalize_autofetch_timeout_ms: timeout_ms } = require('../bts/btp_conn');

// Execute the actual control and live binding without rendering the rest of
// the Admin page. This reproduces the save callback and error restoration.
function control(value) {
	const source = fs.readFileSync(require.resolve('../static/js/ctournament.js'), 'utf8');
	const binding = source.match(/\tfunction bind_live_prop\([^\n]*[\s\S]*?\n\t}/)[0];
	const start = source.indexOf('if (!curt[\'btp_autofetch_timeout_intervall\'])');
	const end = source.indexOf('\n\t\t\t\tinput.btp_readonly', start);
	assert(start >= 0 && end > start);
	const input = {}, curt = { btp_autofetch_timeout_intervall: value }, requests = [], errors = [];
	vm.runInNewContext(binding + '\n' + source.slice(start, end), {
		curt, input, btp_connection_div: {}, ci18n: key => key,
		uiu: { el: (_parent, _tag, attrs = {}) => ({ value: attrs.value == null ? '' : String(attrs.value),
			listeners: {}, addEventListener(event, handler) { this.listeners[event] = handler; } }) },
		send_single_prop: (field, setting, callback) => requests.push({ field, value: setting, callback }),
		update_edit_dependencies() {}, cerror: { net: error => errors.push(error) },
	});
	return { el: input.btp_autofetch_timeout_intervall, curt, requests, errors };
}

describe('BTP interval Admin control', function() {
	it('shows persisted seconds directly and defaults a missing setting to 30', function() {
		for (const value of [undefined, 30, '30']) assert.strictEqual(control(value).el.value, '30');
	});
	it('keeps 30 seconds through repeated edits, API saves and reloads without appending zeros', function() {
		let stored = 30;
		for (let i = 0; i < 3; i++) {
			const c = control(stored); c.el.value = '30'; c.el.listeners.change();
			const request = c.requests[0]; assert.strictEqual(request.field, 'btp_autofetch_timeout_intervall');
			assert.strictEqual(request.value, 30); assert.strictEqual(timeout_ms(request.value), 30000);
			request.callback(null); assert.strictEqual(c.el.value, '30');
			stored = c.curt.btp_autofetch_timeout_intervall; assert.strictEqual(stored, 30);
		}
	});
	it('sends the newly selected interval in seconds and restores the previous seconds on failure', function() {
		const c = control(30); c.el.value = '45'; c.el.listeners.change();
		assert.strictEqual(c.requests[0].value, 45); assert.strictEqual(timeout_ms(c.requests[0].value), 45000);
		c.requests[0].callback(new Error('Save failed'));
		assert.strictEqual(c.el.value, '30'); assert.strictEqual(c.curt.btp_autofetch_timeout_intervall, 30); assert.strictEqual(c.errors.length, 1);
	});
	it('keeps fractional stored seconds readable and handles an empty input with the default', function() {
		const c = control(0.1); assert.strictEqual(c.el.value, '0.1');
		c.el.value = ''; c.el.listeners.change(); assert.strictEqual(c.requests[0].value, 30);
	});
});
