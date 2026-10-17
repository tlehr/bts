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
        local: tournament.speech?.context_version === 'bts-context-v1',
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

function prepare(tournament, matches, locale = 'de') {
    if (tournament.speech?.context_version === 'bts-context-v1' && locale === 'de') {
        const parts = [];
        const texts = renderer(tournament, locale, parts);
        const warm = (name, setup) => parts.push(...contextPlan(texts, tournament, name, setup).parts);
        for (const court of tournament.courts || []) {
            if (court.is_active !== false) warm('prepareFields', { court_id: court._id });
        }
        warm('prepareInstruction', {});
        for (const match of matches) {
            const setup = match.setup;
            if (!setup) continue;
            const complete = setup.teams?.length >= 2 && setup.teams.slice(0, 2)
                .every(team => team.players?.length && team.players.every(player => player.name?.trim()));
            if (complete) {
                try { warm('prepareGame', setup); } catch (_) { /* No partial block with unknown game data. */ }
            }
            prepare_tabletoperators(texts, tournament, setup);
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
        prepare_waiting_tabletoperators(texts, tournament);
        warm('prepareCommon', {});
        parts.push(translate(locale, 'announcements:speechcheck:text'));
        return [...new Set(parts)];
    }
    const parts = [];
    const texts = renderer(tournament, locale, parts);
    parts.push(texts.createBeginToPlayAnnouncement({}));
    for (const court of tournament.courts || []) {
        if (court.is_active === false) continue;
        parts.push(texts.createFieldAnnouncement({ court_id: court._id }));
        parts.push(texts.createFieldPreparationAnnouncement({ court_id: court._id }));
        parts.push(texts.createBeginToPlayAnnouncement({ court_id: court._id }));
    }
    for (const match of matches) {
        const setup = match.setup;
        if (setup) prepare_tabletoperators(texts, tournament, setup);
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
    prepare_waiting_tabletoperators(texts, tournament);
    // Speech checks, like free announcements, use their original complete text.
    return [...new Set([translate(locale, 'announcements:speechcheck:text'), ...texts.localParts(parts)])];
}

module.exports = { prepare, renderer, CALLS, prepare_tabletoperators, tabletoperator_groups };
