'use strict';

const { renderer } = require('./text');
const contextPlan = require('../../static/js/speech_context');
const v2 = require('../../static/js/speech_context_v2');
const { _translate: translate } = require('../../static/js/ci18n');
const keyPart = value => String(value ?? '').trim().replace(/[^A-Za-z0-9:_-]/g, '_').slice(0, 120);
const eventKey = event => keyPart(event.id ?? event.key ?? event.name);
const drawn = (event, matches) => event.is_drawn === true || Number(event.match_count || 0) > 0 ||
    matches.some(match => match.setup?.event_name === event.name || match.setup?.event_name?.startsWith(event.name + ' - '));
const firstDrawn = (tournament, matches) => matches.length > 0 || (tournament.events?.events || []).some(event => drawn(event, matches));

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

function registration(tournament, matches, onCall) {
    const parts = [], texts = renderer(tournament, 'de', []);
    const warmName = players => {
        if (!players?.length || players.some(player => !player?.name?.trim())) return;
        parts.push(...contextPlan(texts, tournament, 'prepareName', { players }).parts);
    };
    const addCall = (kind, label) => {
        const normal = texts.normalizeNames(label);
        for (const target of ['Anmeldung', 'Turnierleitung']) {
            const full = kind === 'pair' ? `Die Paarung ${normal} bitte zur ${target}. ${normal} bitte!` :
                kind === 'state' || kind === 'club' ?
                    `Bitte ein Vertreter ${kind === 'state' ? 'aus' : 'vom Verein'} ${normal} zur ${target}. Ein Vertreter ${kind === 'state' ? 'aus' : 'vom Verein'} ${normal} bitte!` :
                    `${normal} bitte zur ${target}. ${normal} bitte!`;
            const planned = v2.registration(full).parts;
            parts.push(...planned);
            onCall?.(kind, label, full, planned);
        }
    };
    // Fixed registration phrases precede every label; their context examples
    // are references only and never create player/tablet demand.
    parts.push(...Object.entries(v2.fixed).filter(([key]) => key.startsWith('lab-v2/registration-'))
        .map(([, recipe]) => '~bts-context-v2~' + JSON.stringify(recipe)));
    const events = (tournament.events?.events || []).map((event, index) => ({ event, index,
        first: matches.findIndex(match => match.setup?.event_name === event.name || match.setup?.event_name?.startsWith(event.name + ' - ')) }));
    const opened = event => tournament.registration_open_events?.[eventKey(event)] === true || drawn(event, matches) ||
        tournament.registration_completed_events?.[eventKey(event)] === true;
    events.sort((a, b) => Number(opened(b.event)) - Number(opened(a.event)) ||
        (a.first < 0 ? Infinity : a.first) - (b.first < 0 ? Infinity : b.first) || a.index - b.index);
    for (const { event } of events) {
        if (drawn(event, matches)) continue;
        const people = [], pairs = [], states = new Set(), clubs = new Set();
        const openRegistration = !drawn(event, matches) && tournament.registration_completed_events?.[eventKey(event)] !== true;
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
        for (const state of states) addCall('state', state);
        for (const club of clubs) addCall('club', club);
        for (const person of people) addCall('player', person.name);
        for (const pair of pairs) {
            if (pair.anyOpen && pair.players.length > 1) addCall('pair', texts.createSingleTeam(pair.players));
            // Draw preparation can reuse known teams even after check-in.
            warmName(pair.players);
        }
    }
    return [...new Set(parts)];
}

module.exports = { bootstrap, officials, registration, firstDrawn, eventKey };
