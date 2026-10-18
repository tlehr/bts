'use strict';

const assert = require('assert');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { plan, STATES } = require('../bts/speech/coverage');
const { tournament, setup } = require('./test_speech_text');
const { decode } = require('../bts/speech/context');
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

    it('keeps seven disjoint states, deduplicates shared pieces, and distinguishes relevant from other stock', async function() {
        const service = broker();
        await service.coverage.set_plan('default', voice, targets([
            ['Stock', ['D01']], ['Cache', ['D01', 'D02']], ['New', ['D02']], ['Pending', ['D08']],
            ['Reserve', ['D08']], ['Potential', ['D08']], [null, ['D01']],
        ]));
        service.prepare(['Stock', 'Cache', 'New', 'Pending', 'Other stock'], options, 'default');
        service.prepare(['Reserve'], { ...options, priority: 'idle' }, 'default');
        for (const entry of service.entries.values()) if (entry.text !== 'Pending') {
            entry.status = 'completed';
            if (entry.text === 'New') entry.generated_for = new Set(['default']);
            if (entry.text === 'Reserve') service.coverage.mark_generated(entry);
        }
        await service.coverage.remember();
        service.reconcile_prefetch('default', ['Cache', 'New', 'Pending'], { voice });
        let coverage = service.queue('default').coverage;
        assert.deepStrictEqual(STATES.map(state => coverage.total[state]), [1, 1, 1, 1, 1, 1, 2]);
        assert.strictEqual(coverage.total.total, 8);
        assert(coverage.groups.reduce((sum, group) => sum + group.total, 0) > coverage.total.total);
        const pending = service.entries.get(service.key('Pending', voice, 'de-DE'));
        pending.status = 'failed';
        coverage = service.queue('default').coverage;
        assert.strictEqual(coverage.total.failed, 1);
        assert.strictEqual(coverage.total.ordered, 1, 'failures stay visibly outstanding');
        service.reconcile_prefetch('default', ['Cache', 'Pending'], { voice });
        coverage = service.queue('default').coverage;
        assert.strictEqual(coverage.total.generated, 0);
        assert.strictEqual(coverage.total.stock, 1);
        assert.strictEqual(coverage.total.tournament_stock, 2);
        assert.strictEqual(coverage.total.prepared, 1, 'unused session reserve keeps its own category after retirement');
        assert.strictEqual(coverage.total.total, 8, 'finished progress remains visible after retirement');
        assert.strictEqual(service.queue('default', 'hallensprecherin').coverage, null);
    });

    it('includes cached numbers of completed and unresolved games as tournament stock without generating anything', async function() {
        const current = { ...tournament(), speech: { context_version: 'bts-context-v2' } };
        const service = broker(); service.context_version = 'bts-context-v2';
        const matches = [
            { _id: 'played', team1_won: true, setup: setup({ state: 'finished', match_num: 17 }) },
            { _id: 'future', setup: setup({ state: 'scheduled', match_num: 18, court_id: null }) },
            { _id: 'unknown', setup: setup({ state: 'incomplete', match_num: 19, teams: [null, null], event_name: undefined }) },
            { _id: 'no-game', setup: setup({ is_match: false, match_num: 20 }) },
        ];
        const targets = await plan(current, matches);
        const numbered = number => '~bts-context-v2~' + JSON.stringify({ before: '', text: 'Spielnummer ' + number,
            after: ' ist als nächstes an der Reihe.', kind: 'generic' });
        const parts = [17, 18, 19, 999].map(numbered);
        await service.coverage.set_plan('default', voice, targets);
        assert(parts.slice(0, 3).every(part => targets.has(part)));
        assert(!targets.has(numbered(20)), 'non-game rows do not introduce game numbers');
        service.prepare(parts, options, 'default');
        for (const entry of service.entries.values()) entry.status = 'completed';
        await service.coverage.remember();
        service.reconcile_prefetch('default', [], { voice });
        const numbers = service.coverage.inventory('default', voice, 'components', 'numbers');
        assert.deepStrictEqual(numbers.items.filter(row => row.state === 'tournament_stock').map(row => decode(row.part, 10000).text),
            ['Spielnummer 17', 'Spielnummer 18', 'Spielnummer 19']);
        assert.strictEqual(numbers.items.find(row => row.text === 'Spielnummer 999').state, 'stock');
        assert.strictEqual(service.queue('default').coverage.total.tournament_stock, 3);
        assert.strictEqual(service.pending_order().length, 0);
        assert.strictEqual(service.current, null);
    });
});
