'use strict';

const { renderer } = require('./text');
const contextPlan = require('../../static/js/speech_context');
const v2 = require('../../static/js/speech_context_v2');
const { _translate: translate } = require('../../static/js/ci18n');
const { cmp_scheduled_match_order } = require('../match_automation');
const keyPart = value => String(value ?? '').trim().replace(/[^A-Za-z0-9:_-]/g, '_').slice(0, 120);
const eventKey = event => keyPart(event.id ?? event.key ?? event.name);
const drawn = (event, matches) => event.is_drawn === true || Number(event.match_count || 0) > 0 ||
    matches.some(match => match.setup?.event_name === event.name || match.setup?.event_name?.startsWith(event.name + ' - '));
const firstDrawn = (tournament, matches) => matches.length > 0 || (tournament.events?.events || []).some(event => drawn(event, matches));

function registrationStatus(tournament, entry, player, index) {
    const key = String(entry.stage_entry_id || entry.entry_id || 'entry') + ':' + String(player?.btp_id ?? index);
    return tournament.registration_player_statuses?.[key]?.status;
}

function registrationCompleted(tournament, event) {
    if (tournament.registration_completed_events?.[eventKey(event)] === true) return true;
    let count = 0;
    for (const stage of event.stages || []) {
        const name = [stage.name, stage.stage_name].filter(Boolean).join(' ').toLowerCase();
        if (Number(stage.stage_type) !== 1 && !/hauptfeld|main/.test(name)) continue;
        for (const entry of stage.entries || []) for (const [index, player] of (entry.team?.players || []).entries()) {
            if (!['present', 'absent'].includes(registrationStatus(tournament, entry, player, index))) return false;
            count++;
        }
    }
    return count > 0;
}

function firstRoundNumbers(tournament, event) {
    return tournament.annoncement_include_matchnumber ? [...new Set(event.first_round_match_numbers || [])]
        .filter(number => Number.isSafeInteger(number) && number > 0) : [];
}

function bootstrap(tournament) {
    const parts = [translate('de', 'announcements:speechcheck:text')], texts = renderer(tournament, 'de', []);
    const warm = (name, setup) => parts.push(...contextPlan(texts, tournament, name, setup).parts);
    for (const court of tournament.courts || []) if (court.is_active !== false) warm('prepareFields', { court_id: court._id });
    // Real location additions/meeting points, with each actual singular/plural.
    warm('prepareLocation', {});
    for (const location of tournament.locations || []) warm('prepareLocation', { location_id: location._id });
    warm('prepareInstruction', {});
    warm('prepareCommon', {});
    return [...new Set(parts)];
}

function officials(tournament, umpires) {
    const parts = [], texts = renderer(tournament, 'de', parts);
    for (const person of umpires) if (person.name?.trim()) for (const [role, suffix] of [['umpire', 'Umpire'], ['service_judge', 'ServiceJudge']]) {
        const setup = { [role]: person };
        texts['announceSecondCall' + suffix](setup);
        texts['announceSecondPreparationCall' + suffix](setup);
        for (const location of tournament.locations || []) texts['announceSecondPreparationCall' + suffix]({ ...setup, location_id: location._id });
    }
    return [...new Set(parts)];
}

function registration(tournament, matches, onCall, trace) {
    const parts = [], texts = renderer(tournament, 'de', []);
    let eventInfo = null, labels = new Map(), phase = 'common';
    const group = () => {
        if (!trace) return;
        if (!trace.groups.has(phase)) trace.groups.set(phase, new Map());
        const events = trace.groups.get(phase), id = eventInfo?.id ?? null;
        if (!events.has(id)) events.set(id, new Set());
        return events.get(id);
    };
    const labelOrder = (kind, label) => {
        if (!trace) return 1;
        if (!labels.has(kind)) labels.set(kind, new Map());
        const values = labels.get(kind);
        if (!values.has(label)) values.set(label, values.size + 1);
        if (eventInfo) eventInfo.counts[kind] = values.size;
        return values.get(label);
    };
    const record = (kind, label, values, order = 1) => {
        parts.push(...values);
        if (!trace) return;
        const members = group();
        for (const part of values) members.add(part);
        for (const part of values) if (!trace.parts.has(part)) trace.parts.set(part, {
            kind, label, label_order: order, plan_order: trace.parts.size, registration_phase: phase,
            ...(eventInfo ? { event_id: eventInfo.id, event_name: eventInfo.name,
                event_order: eventInfo.order, event_state: eventInfo.state,
                ...(eventInfo.first_game ? { first_game: eventInfo.first_game } : {}) } : {}),
        });
    };
    if (trace) {
        trace.parts = new Map(); trace.events = [];
        trace.groups = new Map(['common', 'open_states', 'open_clubs', 'open_people', 'open_numbers',
            'closed_states', 'closed_clubs', 'closed_people', 'closed_numbers'].map(id => [id, new Map()]));
    }
    const warmName = players => {
        if (!players?.length || players.some(player => !player?.name?.trim())) return;
        const label = texts.createSingleTeam(players);
        record('team', label, contextPlan(texts, tournament, 'prepareName', { players }).parts, labelOrder('team', label));
    };
    const addCall = (kind, label) => {
        const normal = texts.normalizeNames(label);
        const order = labelOrder(kind, label);
        for (const target of ['Anmeldung', 'Turnierleitung']) {
            const full = kind === 'pair' ? `Die Paarung ${normal} bitte zur ${target}. ${normal} bitte!` :
                kind === 'state' || kind === 'club' ?
                    `Bitte ein Vertreter ${kind === 'state' ? 'aus' : 'vom Verein'} ${normal} zur ${target}. Ein Vertreter ${kind === 'state' ? 'aus' : 'vom Verein'} ${normal} bitte!` :
                    `${normal} bitte zur ${target}. ${normal} bitte!`;
            const planned = v2.registration(full).parts;
            record(kind, label, planned, order);
            onCall?.(kind, label, full, planned);
        }
    };
    // Fixed registration phrases precede every label; their context examples
    // are references only and never create player/tablet demand.
    record('common', 'Allgemeine Anmeldetexte', Object.entries(v2.fixed).filter(([key]) => key.startsWith('lab-v2/registration-'))
        .map(([, recipe]) => '~bts-context-v2~' + JSON.stringify(recipe)));
    const events = (tournament.events?.events || []).map((event, index) => ({ event, index,
        completed: registrationCompleted(tournament, event), isDrawn: drawn(event, matches),
        first: event.first_planned_match ? { setup: { match_num: event.first_planned_match.number,
            scheduled_date: event.first_planned_match.date, scheduled_time_str: event.first_planned_match.time },
        match_order: event.first_planned_match.order } : null }));
    const eventTier = row => row.isDrawn ? 3 : row.completed ? 1 :
        tournament.registration_open_events?.[eventKey(row.event)] === true ? 0 : 2;
    events.sort((a, b) => eventTier(a) - eventTier(b) ||
        (a.first && b.first ? cmp_scheduled_match_order(a.first, b.first) : a.first ? -1 : b.first ? 1 : 0) || a.index - b.index);
    const plannedEvents = [];
    let eventOrder = 0;
    for (const { event, index, completed, isDrawn } of events) {
        eventInfo = { id: eventKey(event), name: event.name || 'Unbenannte Disziplin', btp_order: index + 1,
            ...(event.first_planned_match ? { first_game: event.first_planned_match } : {}),
            order: isDrawn || completed ? null : ++eventOrder,
            state: isDrawn ? 'drawn' : completed ? 'completed' :
                tournament.registration_open_events?.[eventKey(event)] === true ? 'open' : 'closed',
            counts: { state: 0, club: 0, player: 0, pair: 0, team: 0, number: 0 } };
        if (trace) trace.events.push(eventInfo);
        if (isDrawn || completed) continue;
        const people = [], pairs = [], states = new Set(), clubs = new Set();
        const openRegistration = !isDrawn && eventInfo.state !== 'completed';
        for (const stage of event.stages || []) for (const entry of stage.entries || []) {
            const players = entry.team?.players || [];
            const known = players.length && players.every(player => player.name?.trim());
            let anyOpen = false;
            players.forEach((player, i) => {
                if (!player.name?.trim()) return;
                const id = String(entry.stage_entry_id || entry.entry_id || 'entry') + ':' + String(player.btp_id ?? i);
                const status = tournament.registration_player_statuses?.[id]?.status;
                if (openRegistration && !['present', 'absent'].includes(status)) {
                    people.push(player);
                    anyOpen = true;
                    if (player.state) states.add(player.state);
                    if (player.club) clubs.add(player.club);
                }
            });
            if (known) pairs.push({ players, anyOpen });
        }
        const numbers = firstRoundNumbers(tournament, event);
        plannedEvents.push({ info: eventInfo, people, pairs, states, clubs, numbers, labels: new Map() });
    }
    const useEvent = planned => { eventInfo = planned.info; labels = planned.labels; group(); };
    const addPeople = planned => {
        for (const person of planned.people) addCall('player', person.name);
        for (const pair of planned.pairs) {
            if (pair.anyOpen && pair.players.length > 1) addCall('pair', texts.createSingleTeam(pair.players));
            // Draw preparation can reuse known teams even after check-in.
            warmName(pair.players);
        }
    };
    const addNumbers = planned => {
        // Prepare only the known first-round numbers, without requiring a draw
        // or creating game/opponent demand. Reuse the normal match-call recipe.
        for (const number of planned.numbers) {
            const label = String(number);
            record('number', label, contextPlan(texts, tournament, 'prepareMatchNumber', { match_num: number }).parts,
                labelOrder('number', label));
        }
    };
    const passes = state => {
        const selected = plannedEvents.filter(planned => planned.info.state === state);
        // Each area finishes federations across all its disciplines, then
        // clubs, and finally each discipline's players/pairs followed by its
        // first-round numbers. Without a schedule, retain BTP list order.
        phase = state + '_states';
        for (const planned of selected) { useEvent(planned); for (const state of planned.states) addCall('state', state); }
        phase = state + '_clubs';
        for (const planned of selected) { useEvent(planned); for (const club of planned.clubs) addCall('club', club); }
        for (const planned of selected) {
            phase = state + '_people'; useEvent(planned); addPeople(planned);
            phase = state + '_numbers'; group(); addNumbers(planned);
        }
    };
    passes('open');
    passes('closed');
    return [...new Set(parts)];
}

module.exports = { bootstrap, officials, registration, firstDrawn, eventKey, registrationCompleted, registrationStatus, firstRoundNumbers };
