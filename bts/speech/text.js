'use strict';

const create = require('../../static/js/announcement_text');
const { _translate: translate } = require('../../static/js/ci18n');
const contextPlan = require('../../static/js/speech_context');

const CALLS = [
    'announceNewMatch', 'announcePreparationMatch',
    'announceSecondCallTeamOne', 'announceSecondCallTeamTwo',
    'announceSecondPreparationCallTeamOne', 'announceSecondPreparationCallTeamTwo',
    'announceSecondCallTabletoperator', 'announceSecondCallUmpire', 'announceSecondCallServiceJudge',
    'announceSecondPreparationCallTabletoperator', 'announceSecondPreparationCallUmpire',
    'announceSecondPreparationCallServiceJudge', 'announceBeginnToPlay',
];

function renderer(tournament, locale, parts) {
    return create({
        local: ['bts-context-v1', 'bts-context-v2'].includes(tournament.speech?.context_version),
        tournament,
        translate: (key, data, fallback) => translate(locale, key, data, fallback),
        window: { localStorage: { getItem: () => 'true' } },
        claim: () => null,
        announce: values => parts.push(...values.filter(value => typeof value === 'string' && value.length)),
    });
}

function tabletoperator_groups(tournament, setup) {
    if (tournament.tabletoperator_with_state_from_match_enabled) {
        const player = (setup.teams || []).slice(0, 2).flatMap(team => team.players || []).find(player => player?.state);
        return [[{ name: player?.state }]];
    }
    return (setup.teams || []).slice(0, 2).flatMap(team => {
        const players = team.players || [];
        const teams = tournament.tabletoperator_split_doubles ? players.map(player => [player]) : [players];
        return teams.map(players => tournament.tabletoperator_with_state_enabled && players[0]?.state ?
            [{ name: players[0].state }] : players);
    });
}

// The final reserve tier includes individuals as well as currently configured
// pairings: a doubles player can later be assigned as an individual operator.
// Coverage and idle preparation must describe the same known candidates.
function* potential_tabletoperator_groups(tournament, matches) {
    if (tournament.tabletoperator_enabled !== true) return;
    const players = new Map(), teams = [];
    const known = player => typeof player?.name === 'string' && player.name.trim();
    const collect = team => {
        if (!team?.players?.length) return;
        if (team.players.every(known)) teams.push(team.players);
        for (const player of team.players) if (known(player)) players.set(String(player.btp_id ?? player.name), player);
    };
    for (const event of tournament.events?.events || []) for (const stage of event.stages || []) {
        for (const entry of stage.entries || []) collect(entry.team);
    }
    for (const match of matches) if (match.setup?.is_match !== false) {
        for (const team of match.setup?.teams || []) collect(team);
    }
    const groups = [...players.values()].map(player => [player]);
    if (!tournament.tabletoperator_split_doubles) groups.push(...teams);
    for (const value of tournament.tabletoperators || []) if (value.tabletoperator?.length) groups.push(value.tabletoperator);
    const seen = new Set();
    for (let group of groups) {
        if (tournament.tabletoperator_with_state_enabled || tournament.tabletoperator_with_state_from_match_enabled) {
            const state = group.find(player => player?.state)?.state;
            if (!state) continue;
            group = [{ name: state }];
        }
        if (!group.every(known)) continue;
        const key = JSON.stringify(group.map(player => player.name));
        if (seen.has(key)) continue;
        seen.add(key);
        yield group;
    }
}

function prepare_tabletoperators(texts, tournament, setup = {}, groups) {
    if (tournament.tabletoperator_enabled !== true) return;
    if (!groups) {
        if (setup.state !== 'oncourt' || !setup.court_id) return;
        groups = tabletoperator_groups(tournament, setup);
    }
    for (const players of groups) {
        if (!players?.length || players.some(player => typeof player?.name !== 'string' || !player.name.trim())) continue;
        const candidate = { tabletoperators: players };
        // These exact recipes also supply the role+name used by D01/D02.
        // Their context is independent of the next game and its actual field.
        texts.announceSecondCallTabletoperator(candidate);
        texts.announceSecondPreparationCallTabletoperator(candidate);
        for (const location of tournament.locations || []) {
            texts.announceSecondPreparationCallTabletoperator({ ...candidate, location_id: location._id });
        }
    }
}

function prepare_waiting_tabletoperators(texts, tournament) {
    const groups = (tournament.tabletoperators || []).filter(value => value.court == null && value.end_ts == null)
        .map(value => value.tabletoperator);
    prepare_tabletoperators(texts, tournament, {}, groups);
}

function prepare(tournament, matches, locale = 'de', options = {}) {
    const shared = options.shared !== false;
    if (['bts-context-v1', 'bts-context-v2'].includes(tournament.speech?.context_version) && locale === 'de') {
        const parts = [];
        const texts = renderer(tournament, locale, parts);
        const warm = (name, setup) => parts.push(...contextPlan(texts, tournament, name, setup).parts);
        for (const court of shared ? tournament.courts || [] : []) {
            if (court.is_active !== false) warm('prepareFields', { court_id: court._id });
        }
        if (shared) warm('prepareInstruction', {});
        for (const match of matches) {
            const setup = match.setup;
            if (!setup) continue;
            const complete = setup.teams?.length >= 2 && setup.teams.slice(0, 2)
                .every(team => team.players?.length && team.players.every(player => player.name?.trim()));
            if (complete || tournament.speech?.context_version === 'bts-context-v2') {
                try { warm('prepareGame', setup); } catch (_) { /* No partial block with unknown game data. */ }
            }
            prepare_tabletoperators(texts, tournament, setup,
                options.tablet_candidates ? tabletoperator_groups(tournament, setup) : undefined);
            if (!complete) continue;
            for (const call of CALLS) {
                try { texts[call](setup); } catch (_) { /* Keep known blocks when officials are unresolved. */ }
            }
            if (!setup.location_id) for (const location of tournament.locations || []) {
                for (const call of CALLS.filter(name => name.includes('Preparation'))) {
                    try { texts[call]({ ...setup, location_id: location._id }); } catch (_) { /* Not assigned yet. */ }
                }
            }
        }
        if (shared) {
            if (options.waiting !== false) prepare_waiting_tabletoperators(texts, tournament);
            warm('prepareCommon', {});
            parts.push(translate(locale, 'announcements:speechcheck:text'));
        }
        return [...new Set(parts)];
    }
    const parts = [];
    const texts = renderer(tournament, locale, parts);
    if (shared) parts.push(texts.createBeginToPlayAnnouncement({}));
    for (const court of shared ? tournament.courts || [] : []) {
        if (court.is_active === false) continue;
        parts.push(texts.createFieldAnnouncement({ court_id: court._id }));
        parts.push(texts.createFieldPreparationAnnouncement({ court_id: court._id }));
        parts.push(texts.createBeginToPlayAnnouncement({ court_id: court._id }));
    }
    for (const match of matches) {
        const setup = match.setup;
        if (setup) prepare_tabletoperators(texts, tournament, setup,
            options.tablet_candidates ? tabletoperator_groups(tournament, setup) : undefined);
        if (!setup || !setup.teams?.[0]?.players?.length || !setup.teams?.[1]?.players?.length) continue;
        for (const builder of ['createTeamAnnouncement', 'createEventAnnouncement', 'createRoundAnnouncement',
            'createMatchNumberAnnouncement', 'createUmpire', 'createServiceJudge', 'createTabletOperator',
            'createPreparationAnnouncement', 'createMeetingPointAnnouncement']) {
            try { parts.push(texts[builder](setup)); } catch (_) { /* Still-unknown fields do not block known parts. */ }
        }
        for (const call of CALLS) {
            try { texts[call](setup); } catch (_) { /* Unknown future officials remain unprepared. */ }
        }
        // Either side may win by forfeit. Names and the fixed clause are shared
        // with regular calls, so neither possible winner needs a full recording.
        for (const winner of [0, 1]) {
            try { texts.announceNoMatchWin(setup, winner); }
            catch (_) { /* An unknown round must not block already known names. */ }
        }
        // Preparation location is sometimes assigned only at the actual call.
        if (!setup.location_id) {
            for (const location of tournament.locations || []) {
                texts.announcePreparationMatch({ ...setup, location_id: location._id });
                for (const call of CALLS.filter(name => name.startsWith('announceSecondPreparation'))) {
                    try { texts[call]({ ...setup, location_id: location._id }); }
                    catch (_) { /* Unknown future officials remain unprepared. */ }
                }
            }
        }
    }
    if (shared && options.waiting !== false) prepare_waiting_tabletoperators(texts, tournament);
    // Speech checks, like free announcements, use their original complete text.
    return [...new Set([...(shared ? [translate(locale, 'announcements:speechcheck:text')] : []), ...texts.localParts(parts)])];
}

module.exports = { prepare, renderer, CALLS, prepare_tabletoperators, prepare_waiting_tabletoperators,
    tabletoperator_groups, potential_tabletoperator_groups };
