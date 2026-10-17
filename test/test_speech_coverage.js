'use strict';

const assert = require('assert');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { plan, STATES } = require('../bts/speech/coverage');
const { tournament } = require('./test_speech_text');
const voice = 'hallensprecher';
const options = { voice, prefetch: true };
const targets = values => new Map(values.map(([part, groups]) => [part, { part, groups: new Set(groups) }]));
const broker = () => new SpeechBroker(configuration({ enabled: true, api_key: 'coverage-test-' + 'x'.repeat(32) }, {}),
    { request: async () => { throw new Error('coverage must never generate speech'); } });

describe('Speech coverage by announcement type', function() {
    it('includes unknown games and all registered tablet candidates without creating any generation requests', async function() {
        const context = { ...tournament(), tabletoperator_enabled: true, tabletoperator_split_doubles: true,
            speech: { context_version: 'bts-context-v1' }, events: { events: [
                { stages: [{ entries: [{ team: { players: [{ btp_id: 17, name: 'Noch nicht angefordert' }] } }] }] },
            ] } };
        const matches = [{ _id: 'unknown', setup: { is_match: true, state: 'incomplete', teams: [{ players: [] }, { players: [] }] } }];
        const first = await plan(context, matches);
        context.events.events.push(context.events.events[0]);
        const duplicate = await plan(context, matches);
        assert.strictEqual(duplicate.size, first.size, 'a person registered in two disciplines is counted once');
        assert(first.has('unknown-game:unknown'));
        assert([...first.values()].some(target => target.groups.has('D08') && target.part?.includes('Noch nicht angefordert')));
        const service = broker(); service.context_version = 'bts-context-v1';
        await service.coverage.set_plan('default', voice, first);
        const coverage = service.queue('default').coverage;
        assert.strictEqual(coverage.total.potential, coverage.total.total);
        assert.strictEqual(coverage.total.ordered, 0);
        assert.strictEqual(service.entries.size, 0, 'potential must not enter the work queue');
        assert.strictEqual(service.current, null);
    });

    it('keeps six disjoint states, deduplicates shared pieces overall, and retains retired completed pieces as stock', async function() {
        const service = broker();
        await service.coverage.set_plan('default', voice, targets([
            ['Stock', ['D01']], ['Cache', ['D01', 'D02']], ['New', ['D02']], ['Pending', ['D08']],
            ['Reserve', ['D08']], ['Potential', ['D08']], [null, ['D01']],
        ]));
        service.prepare(['Stock', 'Cache', 'New', 'Pending'], options, 'default');
        service.prepare(['Reserve'], { ...options, priority: 'idle' }, 'default');
        for (const entry of service.entries.values()) if (entry.text !== 'Pending') {
            entry.status = 'completed';
            if (entry.text === 'New') entry.generated_for = new Set(['default']);
            if (entry.text === 'Reserve') service.coverage.mark_generated(entry);
        }
        await service.coverage.remember();
        service.reconcile_prefetch('default', ['Cache', 'New', 'Pending'], { voice });
        let coverage = service.queue('default').coverage;
        assert.deepStrictEqual(STATES.map(state => coverage.total[state]), [1, 1, 1, 1, 1, 2]);
        assert.strictEqual(coverage.total.total, 7);
        assert(coverage.groups.reduce((sum, group) => sum + group.total, 0) > coverage.total.total);
        const pending = service.entries.get(service.key('Pending', voice, 'de-DE'));
        pending.status = 'failed';
        coverage = service.queue('default').coverage;
        assert.strictEqual(coverage.total.failed, 1);
        assert.strictEqual(coverage.total.ordered, 1, 'failures stay visibly outstanding');
        service.reconcile_prefetch('default', ['Cache', 'Pending'], { voice });
        coverage = service.queue('default').coverage;
        assert.strictEqual(coverage.total.generated, 0);
        assert.strictEqual(coverage.total.stock, 2);
        assert.strictEqual(coverage.total.prepared, 1, 'unused session reserve keeps its own category after retirement');
        assert.strictEqual(coverage.total.total, 7, 'finished progress remains visible after retirement');
        assert.strictEqual(service.queue('default', 'hallensprecherin').coverage, null);
    });
});
