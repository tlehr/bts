'use strict';

const { renderer, potential_tabletoperator_groups } = require('./text');
const contextPlan = require('../../static/js/speech_context');
const { _translate: translate } = require('../../static/js/ci18n');
const GROUPS = [
    ['D01', 'Spielaufruf'], ['D02', 'Vorbereitungsaufruf'], ['D03', 'Spielbeginn'],
    ['D04', 'Zweiter Teamaufruf'], ['D05', 'Zweiter Teamaufruf in Vorbereitung'],
    ['D06', 'Schiedsrichter'], ['D07', 'Aufschlagrichter'], ['D08', 'Tablet- / Klapptafelbedienung'],
    ['D09', 'Schiedsrichter in Vorbereitung'], ['D10', 'Aufschlagrichter in Vorbereitung'],
    ['D11', 'Tablet- / Klapptafelbedienung in Vorbereitung'], ['D12', 'Kampfloser Sieg'],
    ['D13', 'Freie Ansagen'], ['D14', 'Sprachtest'], ['other', 'Weitere Bausteine'],
];
const STATES = ['stock', 'prepared', 'cached', 'generated', 'ordered', 'potential'];

// Describe possible playback pieces without submitting them to the broker.
// Unknown games use one shared placeholder until their real text is known.
async function plan(tournament, matches, umpires = []) {
    const targets = new Map(), output = [], texts = renderer(tournament, 'de', output);
    let work = 0;
    const yieldWork = async () => { if (++work % 32 === 0) await new Promise(resolve => setImmediate(resolve)); };
    const add = (part, group, placeholder) => {
        const id = part || placeholder;
        if (!targets.has(id)) targets.set(id, { part, groups: new Set() });
        targets.get(id).groups.add(group);
    };
    const call = (group, name, setup, ...args) => {
        output.length = 0;
        try { texts[name](setup, ...args); } catch (_) { return; }
        for (const part of output) add(part, group);
    };
    const halls = setup => setup.location_id || !tournament.locations?.length ? [setup] :
        tournament.locations.map(location => ({ ...setup, location_id: location._id }));
    const known = team => team?.players?.length && team.players.every(player => player.name?.trim());
    for (const match of matches) {
        await yieldWork();
        const setup = match.setup;
        if (!setup || setup.is_match === false) continue;
        if (!setup.teams?.slice(0, 2).every(known) || setup.teams.length < 2) {
            for (const group of ['D01', 'D02', 'D04', 'D05', 'D12']) add(null, group, 'unknown-game:' + match._id);
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
        call('D03', 'announceBeginnToPlay', setup);
        const fields = tournament.speech?.context_version === 'bts-context-v1' ?
            contextPlan(texts, tournament, 'prepareFields', setup).parts : [texts.createFieldAnnouncement(setup)].filter(Boolean);
        for (const part of fields) add(part, 'D01');
        if (fields[1]) add(fields[1], 'D04');
    }
    for (const official of umpires) for (const [group, role, name] of [
        ['D06', 'umpire', 'Umpire'], ['D07', 'service_judge', 'ServiceJudge'],
    ]) {
        await yieldWork();
        if (!official.name?.trim()) continue;
        call(group, 'announceSecondCall' + name, { [role]: official });
        for (const hall of halls({ [role]: official })) call('D' + String(Number(group.slice(1)) + 3).padStart(2, '0'),
            'announceSecondPreparationCall' + name, hall);
    }
    for (const group of potential_tabletoperator_groups(tournament, matches)) {
        await yieldWork();
        const setup = { tabletoperators: group };
        call('D08', 'announceSecondCallTabletoperator', setup);
        for (const hall of halls(setup)) call('D11', 'announceSecondPreparationCallTabletoperator', hall);
    }
    add(translate('de', 'announcements:speechcheck:text'), 'D14');
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
            if (!entry.idle_tournaments?.has(tournament) || entry.prefetch_tournaments?.has(tournament) ||
                entry.foreground_tournaments?.has(tournament)) this.mark_needed(entry, tournament);
        }
    }

    async set_plan(tournament, voice, targets) {
        const values = new Map();
        for (const [id, target] of targets) values.set(target.part ? this.broker.key(target.part, voice, 'de-DE') : id, target);
        this.plans.set(tournament, { voice, values });
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
                    entry, generated: saved?.generated_for?.includes(tournament) || entry?.generated_for?.has(tournament) || false });
                if (saved) updates.push({ key, tournament, voice: current.voice, groups });
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
        const candidates = new Map([...current.values].map(([key, target]) => [key, { groups: new Set(target.groups) }]));
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
        const total = empty(), groups = new Map(GROUPS.map(([id, label]) => [id, { id, label, ...empty() }]));
        for (const [key, value] of candidates) {
            const entry = broker.check_local(broker.entries.get(key));
            const saved = broker.disk?.lookup(broker.identity, key);
            const ready = !!saved || entry?.status === 'completed' ||
                !broker.disk && value.archived?.entry?.status === 'completed';
            const needed = !!entry?.tournaments.has(tournament) && (!entry.idle_tournaments?.has(tournament) ||
                entry.prefetch_tournaments?.has(tournament) || entry.foreground_tournaments?.has(tournament));
            const requested = !!entry?.tournaments.has(tournament);
            const generated = saved?.generated_for?.includes(tournament) || entry?.generated_for?.has(tournament) || value.archived?.generated;
            const session = this.session_key(key, tournament);
            const prepared = this.session_generated.has(session) && !this.session_needed.has(session);
            const state = ready ? needed ? generated ? 'generated' : 'cached' : prepared ? 'prepared' : 'stock' :
                requested ? 'ordered' : 'potential';
            const failed = requested && entry?.status === 'failed' ? 1 : 0;
            for (const counts of [total, ...[...value.groups].map(group => groups.get(group)).filter(Boolean)]) {
                counts.total++; counts[state]++; counts.failed += failed;
            }
        }
        return { total: { id: 'total', label: 'Gesamt · eindeutige Bausteine und Potenzial', ...total },
            groups: [...groups.values()].filter(group => group.id !== 'other' || group.total),
            verifying: !!broker.disk && !broker.disk.verified };
    }
}

module.exports = { plan, SpeechCoverage, GROUPS, STATES };
