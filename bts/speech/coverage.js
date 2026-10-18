'use strict';

const { renderer, potential_tabletoperator_groups } = require('./text');
const contextPlan = require('../../static/js/speech_context');
const inventory = require('./inventory');
const { isRequired } = require('./planning');
const crypto = require('crypto');
const { _translate: translate } = require('../../static/js/ci18n');
const GROUPS = [
    ['D01', 'Spielaufruf'], ['D02', 'Vorbereitungsaufruf'], ['D03', 'Spielbeginn'],
    ['D04', 'Zweiter Teamaufruf'], ['D05', 'Zweiter Teamaufruf in Vorbereitung'],
    ['D06', 'Schiedsrichter'], ['D07', 'Aufschlagrichter'], ['D08', 'Tablet- / Klapptafelbedienung'],
    ['D09', 'Schiedsrichter in Vorbereitung'], ['D10', 'Aufschlagrichter in Vorbereitung'],
    ['D11', 'Tablet- / Klapptafelbedienung in Vorbereitung'], ['D12', 'Kampfloser Sieg'],
    ['registration', 'Anmeldung / Auslosung'], ['D13', 'Freie Ansagen'], ['D14', 'Sprachtest'], ['other', 'Weitere Bausteine'],
];
const STATES = ['stock', 'prepared', 'cached', 'generated', 'ordered', 'potential'];

// Describe possible playback pieces without submitting them to the broker.
// Unknown games use one shared placeholder until their real text is known.
async function plan(tournament, matches, umpires = []) {
    const targets = new Map(), output = [], texts = renderer(tournament, 'de', output);
    const calls = [], browserOutput = [], browser = renderer({ ...tournament, speech: {} }, 'de', browserOutput);
    let scope = { id: 'shared', label: '', needed: false };
    let work = 0;
    const yieldWork = async () => { if (++work % 32 === 0) await new Promise(resolve => setImmediate(resolve)); };
    const add = (part, group, placeholder) => {
        const id = part || placeholder;
        if (!targets.has(id)) targets.set(id, { part, groups: new Set() });
        targets.get(id).groups.add(group);
    };
    const call = (group, name, setup, ...args) => {
        output.length = 0; browserOutput.length = 0;
        try { texts[name](setup, ...args); browser[name](setup, ...args); } catch (_) { return; }
        if (!['bts-context-v1', 'bts-context-v2'].includes(tournament.speech?.context_version)) {
            output.splice(0, output.length, ...texts.localParts(output));
        }
        if (!output.length) return;
        for (const part of output) add(part, group);
        const text = browserOutput.join(' ').replace(/([.!?])(?=[A-ZÄÖÜ])/g, '$1 ');
        const id = crypto.createHash('sha256').update(JSON.stringify([scope.id, group, name, setup.court_id, setup.location_id, args,
            setup.umpire?.name, setup.service_judge?.name, setup.tabletoperators?.map(p => p.name)])).digest('hex');
        calls.push({ id, group, label: scope.label, text, parts: [...new Set(output)], needed: scope.needed,
            ...(['D01', 'D04'].includes(group) && !setup.court_id ? { unresolved: 'Spielfeld noch nicht zugewiesen' } : {}) });
    };
    const halls = setup => setup.location_id || !tournament.locations?.length ? [setup] :
        tournament.locations.map(location => ({ ...setup, location_id: location._id }));
    const known = team => team?.players?.length && team.players.every(player => player.name?.trim());
    for (const match of matches) {
        await yieldWork();
        const setup = match.setup;
        if (!setup || setup.is_match === false) continue;
        scope = { id: match._id, label: 'Spiel ' + (setup.match_num ?? 'ohne Nummer') + (setup.event_name ? ' · ' + setup.event_name : ''), needed: isRequired(match) };
        if (!setup.teams?.slice(0, 2).every(known) || setup.teams.length < 2) {
            for (const group of ['D01', 'D02', 'D04', 'D05', 'D12']) {
                add(null, group, 'unknown-game:' + match._id);
                calls.push({ id: group + ':unknown:' + match._id, group, label: scope.label, text: 'Teilnehmer stehen noch nicht vollständig fest.',
                    parts: [], unresolved: 'Teilnehmer noch unbekannt', needed: scope.needed });
            }
            continue;
        }
        call('D01', 'announceNewMatch', setup);
        for (const hall of halls(setup)) call('D02', 'announcePreparationMatch', hall);
        for (const side of ['One', 'Two']) {
            call('D04', 'announceSecondCallTeam' + side, setup);
            for (const hall of halls(setup)) call('D05', 'announceSecondPreparationCallTeam' + side, hall);
        }
        for (const winner of [0, 1]) call('D12', 'announceNoMatchWin', setup, winner);
        for (const [group, name] of [['D06', 'Umpire'], ['D07', 'ServiceJudge'], ['D08', 'Tabletoperator']]) {
            call(group, 'announceSecondCall' + name, setup);
            for (const hall of halls(setup)) call('D' + String(Number(group.slice(1)) + 3).padStart(2, '0'),
                'announceSecondPreparationCall' + name, hall);
        }
    }
    // Field pieces are shared by games and are counted only once overall.
    for (const court of tournament.courts || []) if (court.is_active !== false) {
        const setup = { court_id: court._id, location_id: court.location_id };
        scope = { id: court._id, label: texts.createFieldAnnouncement(setup), needed: true };
        call('D03', 'announceBeginnToPlay', setup);
        const fields = ['bts-context-v1', 'bts-context-v2'].includes(tournament.speech?.context_version) ?
            contextPlan(texts, tournament, 'prepareFields', setup).parts : texts.localParts([texts.createFieldAnnouncement(setup)].filter(Boolean));
        for (const part of fields) add(part, 'D01');
        if (fields[1]) add(fields[1], 'D04');
    }
    for (const official of umpires) for (const [group, role, name] of [
        ['D06', 'umpire', 'Umpire'], ['D07', 'service_judge', 'ServiceJudge'],
    ]) {
        await yieldWork();
        if (!official.name?.trim()) continue;
        scope = { id: 'official:' + role + ':' + official.name, label: official.name, needed: true };
        call(group, 'announceSecondCall' + name, { [role]: official });
        for (const hall of halls({ [role]: official })) call('D' + String(Number(group.slice(1)) + 3).padStart(2, '0'),
            'announceSecondPreparationCall' + name, hall);
    }
    for (const group of potential_tabletoperator_groups(tournament, matches)) {
        await yieldWork();
        const setup = { tabletoperators: group };
        scope = { id: 'tablet:' + group.map(person => person.name).join('|'), label: group.map(person => person.name).join(' und '), needed: false };
        call('D08', 'announceSecondCallTabletoperator', setup);
        for (const hall of halls(setup)) call('D11', 'announceSecondPreparationCallTabletoperator', hall);
    }
    if (tournament.speech?.context_version === 'bts-context-v2') {
        for (const part of require('./v2_inventory').registration(tournament, matches, (kind, label, text, parts) => {
            calls.push({ id: 'registration:' + crypto.createHash('sha256').update(text).digest('hex'), group: 'registration',
                label: ({ state: 'Verband', club: 'Verein', player: 'Person', pair: 'Paarung' })[kind] + ': ' + label, text, parts, needed: false });
        })) add(part, 'registration');
    }
    const test = translate('de', 'announcements:speechcheck:text');
    add(test, 'D14');
    calls.push({ id: 'speech-test', group: 'D14', label: 'Sprachtest', text: test, parts: [test], needed: true });
    targets.announcements = [...new Map(calls.map(row => [row.id, row])).values()];
    return targets;
}

class SpeechCoverage {
    constructor(broker) {
        this.broker = broker;
        this.plans = new Map();
        this.history = new Map();
        // Session means this broker's lifetime, shared by all browser clients.
        // Keep these markers outside queue entries so eviction cannot erase
        // session progress, and do not restore them from the persistent cache.
        this.session_generated = new Set();
        this.session_needed = new Set();
    }

    session_key(key, tournament) {
        return JSON.stringify([this.broker.identity, tournament, key]);
    }

    mark_needed(entry, tournament) {
        if (entry.context?.kind !== 'source') this.session_needed.add(this.session_key(entry.key, tournament));
    }

    mark_generated(entry) {
        if (entry.context?.kind === 'source') return;
        for (const tournament of entry.tournaments) {
            this.session_generated.add(this.session_key(entry.key, tournament));
            // Work may have been scheduled before the first health response
            // established the cache identity. Preserve its ordinary need too.
            if (!entry.idle_tournaments?.has(tournament) && !entry.spare_tournaments?.has(tournament) || entry.prefetch_tournaments?.has(tournament) ||
                entry.foreground_tournaments?.has(tournament)) this.mark_needed(entry, tournament);
        }
    }

    async set_plan(tournament, voice, targets) {
        const values = new Map();
        for (const [id, target] of targets) values.set(target.part ? this.broker.key(target.part, voice, 'de-DE') : id, target);
        const calls = (targets.announcements || []).map(call => {
            const { parts, ...rest } = call;
            return { ...rest, keys: [...new Set(parts.map(part => this.broker.key(part, voice, 'de-DE')))] };
        });
        this.plans.set(tournament, { voice, values, calls,
            revision: crypto.createHash('sha256').update(JSON.stringify(calls)).digest('hex') });
        await this.remember();
    }

    async remember() {
        const broker = this.broker, updates = [];
        for (const [tournament, current] of this.plans) {
            const values = new Map(current.values);
            for (const entry of broker.entries.values()) if (entry.voice === current.voice && entry.tournaments.has(tournament) &&
                entry.context?.kind !== 'source' && !values.has(entry.key)) {
                values.set(entry.key, { part: entry.part, groups: new Set([entry.context ? 'other' : 'D13']) });
            }
            for (const [key, target] of values) {
                if (!target.part) continue;
                const entry = broker.entries.get(key);
                const saved = broker.disk?.lookup(broker.identity, key);
                if (!saved && entry?.status !== 'completed') continue;
                const id = JSON.stringify([broker.identity, tournament, current.voice, key]);
                const previous = this.history.get(id);
                const groups = [...new Set([...(previous?.groups || []), ...target.groups])];
                this.history.set(id, { identity: broker.identity, tournament, voice: current.voice, key, groups,
                    entry, part: target.part, generated: saved?.generated_for?.includes(tournament) || entry?.generated_for?.has(tournament) || false });
                if (saved) updates.push({ key, tournament, voice: current.voice, groups, part: target.part });
            }
        }
        if (updates.length) {
            try { await broker.disk?.tag_progress(broker.identity, updates); }
            catch (_) { broker.cache_error = 'speech_cache_unavailable'; }
        }
    }

    summary(tournament, voice) {
        const broker = this.broker, current = this.plans.get(tournament);
        if (!current || current.voice !== voice) return null;
        const candidates = new Map([...current.values].map(([key, target]) => [key, { groups: new Set(target.groups), part: target.part }]));
        const add = item => {
            if (item.identity !== broker.identity || item.tournament !== tournament || item.voice !== voice) return;
            if (!candidates.has(item.key)) candidates.set(item.key, { groups: new Set() });
            const value = candidates.get(item.key);
            item.groups.forEach(group => value.groups.add(group));
            value.archived = item;
        };
        for (const item of this.history.values()) add(item);
        for (const item of broker.disk?.valid.values() || []) if (item.identity === broker.identity) {
            for (const usage of item.usage || []) add({ ...usage, identity: item.identity, key: item.key,
                voice: usage.voice, generated: item.generated_for?.includes(tournament) || false });
        }
        for (const entry of broker.entries.values()) {
            if (entry.voice !== voice || !entry.tournaments.has(tournament) || entry.context?.kind === 'source' || candidates.has(entry.key)) continue;
            candidates.set(entry.key, { groups: new Set([entry.context ? 'other' : 'D13']) });
        }
        const empty = () => ({ total: 0, failed: 0, ...Object.fromEntries(STATES.map(state => [state, 0])) });
        const componentRows = [];
        const total = empty(), groups = new Map(GROUPS.map(([id, label]) => [id, { id, label, ...empty() }]));
        for (const [key, value] of candidates) {
            const entry = broker.check_local(broker.entries.get(key));
            const saved = broker.disk?.lookup(broker.identity, key);
            const ready = !!saved || entry?.status === 'completed' ||
                !broker.disk && value.archived?.entry?.status === 'completed';
            const needed = !!entry?.tournaments.has(tournament) && (!entry.idle_tournaments?.has(tournament) && !entry.spare_tournaments?.has(tournament) ||
                entry.prefetch_tournaments?.has(tournament) || entry.foreground_tournaments?.has(tournament));
            const requested = !!entry?.tournaments.has(tournament);
            const generated = saved?.generated_for?.includes(tournament) || entry?.generated_for?.has(tournament) || value.archived?.generated;
            const session = this.session_key(key, tournament);
            const prepared = this.session_generated.has(session) && !this.session_needed.has(session);
            const state = ready ? needed ? generated ? 'generated' : 'cached' : prepared ? 'prepared' : 'stock' :
                requested ? 'ordered' : 'potential';
            const failed = requested && entry?.status === 'failed' ? 1 : 0;
            const target = current.values.get(key);
            if (target?.part || entry || saved || value.archived) {
                const part = target?.part || entry?.part || saved?.part || value.archived?.part;
                componentRows.push({ id: key, part, ...inventory.description(part, value.groups), state, failed: !!failed,
                    diagnostics: broker.failures?.get(broker.identity, key) || null, status: ready ? 'completed' : entry?.status || 'missing',
                    retry_at: Math.max(entry?.retry_at || 0, entry?.server_retry_at || 0, broker.post_retry_at || 0),
                    terminal_failure: entry?.terminal_failure === true, fallback_stage: entry?.fallback_stage });
            }
            for (const counts of [total, ...[...value.groups].map(group => groups.get(group)).filter(Boolean)]) {
                counts.total++; counts[state]++; counts.failed += failed;
            }
        }
        const free = componentRows.filter(row => row.group === 'free').map(row => ({ id: 'free:' + row.id, group: 'D13',
            label: 'Freie Durchsage', text: row.text, keys: [row.id], needed: ['cached', 'generated', 'ordered'].includes(row.state) }));
        current.inventory = inventory.build(componentRows, [...(current.calls || []), ...free], GROUPS);
        return { ...current.inventory.summary, revision: current.revision,
            total: { id: 'total', label: 'Gesamt · eindeutige Bausteine und Potenzial', ...total },
            groups: [...groups.values()].filter(group => group.id !== 'other' || group.total),
            verifying: !!broker.disk && !broker.disk.verified };
    }

    inventories(tournament, voice, queries) {
        if (!Array.isArray(queries) || !queries.length || queries.length > 8) throw new Error('invalid_inventory_request');
        for (const { kind, group = 'all', offset = 0, limit = 30 } of queries) {
            if (!['components', 'announcements'].includes(kind) || typeof group !== 'string' || group.length > 64 || !/^[a-zA-Z0-9_]+$/.test(group) ||
                !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('invalid_inventory_request');
        }
        this.summary(tournament, voice);
        const current = this.plans.get(tournament);
        return queries.map(({ kind, group = 'all', offset = 0, limit = 30 }) =>
            current?.voice === voice && current.inventory ? inventory.page(current.inventory, kind, group, offset, limit) : null);
    }

    inventory(tournament, voice, kind, group = 'all', offset = 0, limit = 30) {
        return this.inventories(tournament, voice, [{ kind, group, offset, limit }])[0];
    }
}

module.exports = { plan, SpeechCoverage, GROUPS, STATES };
