'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function harness() {
	let created = 0, conversions = 0, language = 'de-DE';
	const context = {
		setTimeout() {},
		change: { default_handler(fn) { return fn; } },
		crouting: { register() {} },
		ci18n: Object.assign(() => '', {get_lang: () => language}),
		Intl: {
			DateTimeFormat: class extends Intl.DateTimeFormat {
				constructor(...args) { super(...args); created++; }
				formatToParts(...args) { conversions++; return super.formatToParts(...args); }
			},
		},
	};
	const source = fs.readFileSync(require.resolve('../static/js/cmatch'), 'utf8').split('/*@DEV*/')[0];
	// Expose the existing private converter only inside this isolated test VM.
	const exposed = source.replace('return {\n\tadd_match,', 'return {\n test_schedule: zoned_time_to_utc_timestamp, test_date: _format_local_dependency_date,\n\tadd_match,');
	assert.notStrictEqual(exposed, source);
	vm.runInNewContext(exposed, context);
	return { convert: context.cmatch.test_schedule, date: context.cmatch.test_date, created: () => created, conversions: () => conversions, language: value => { language = value; } };
}

describe('Scheduled match time formatting', function() {
	it('reuses timezone formatters while retaining changing dates and times', function() {
		const h = harness();
		for (let i = 0; i < 1000; i++) {
			assert.strictEqual(h.convert('2026-11-09', i % 2 ? '12:30' : '14:45', 'Europe/Berlin'),
				Date.parse(i % 2 ? '2026-11-09T11:30:00Z' : '2026-11-09T13:45:00Z'));
		}
		assert.strictEqual(h.created(), 1);
		assert.strictEqual(h.conversions(), 2);
	});

	it('preserves summer, winter and fractional-hour zone offsets', function() {
		const h = harness();
		for (const [date, time, zone, expected] of [
			['2026-07-09', '12:30', 'Europe/Berlin', '2026-07-09T10:30:00Z'],
			['2026-11-09', '12:30', 'Europe/Berlin', '2026-11-09T11:30:00Z'],
			['2026-03-29', '12:30', 'Europe/Berlin', '2026-03-29T10:30:00Z'],
			['2026-11-09', '12:30', 'Asia/Kathmandu', '2026-11-09T06:45:00Z'],
			['2026-11-09', '12:30', 'UTC', '2026-11-09T12:30:00Z'],
		]) assert.strictEqual(h.convert(date, time, zone), Date.parse(expected));
		assert.strictEqual(h.created(), 3);
	});

	it('retains unknown times and errors for invalid timezones', function() {
		const h = harness();
		assert.strictEqual(h.convert(null, '12:30', 'Europe/Berlin'), 0);
		assert.strictEqual(h.convert('2026-11-09', null, 'Europe/Berlin'), 0);
		assert.strictEqual(h.created(), 0);
		assert.throws(() => h.convert('2026-11-09', '12:30', 'Invalid/Test'), RangeError);
		assert.strictEqual(h.convert('2026-11-09', '12:30', 'Europe/Berlin'), Date.parse('2026-11-09T11:30:00Z'));
	});
});


describe('Dependency date formatting', function() {
 it('reuses formats while reflecting changed dates and language', function() {
  const h = harness();
  for (let i = 0; i < 500; i++) assert.strictEqual(h.date('2026-11-09'), new Intl.DateTimeFormat('de-DE').format(new Date('2026-11-09T00:00:00Z')));
  assert.strictEqual(h.created(), 1);
  h.language('en-US');
  assert.strictEqual(h.date('2026-12-10'), new Intl.DateTimeFormat('en-US').format(new Date('2026-12-10T00:00:00Z')));
  assert.strictEqual(h.created(), 2);
  assert.strictEqual(h.date('unknown'), 'unknown');
  assert.strictEqual(h.date(null), '');
 });
});
