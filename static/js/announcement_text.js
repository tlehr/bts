/* global createContextSpeechPlan */
/* Shared legacy text builders. Context separates text preparation from playback. */
function createAnnouncementTexts(context) {
    const curt = context.tournament;
    let activeCall;
    let api;
    const ci18n = context.translate;
    // Remember the structure while still returning the original strings from
    // public builders. Browser utterances keep their existing sentence layout;
    // local audio can reuse the leaves of these compositions.
    const compositions = new Map();
    const names = new Set();
    function compose(parts, separator = '') {
        const text = parts.join(separator);
        const chunks = [];
        parts.forEach((part, index) => {
            if (index) chunks.push(separator);
            chunks.push(...(compositions.get(part) || [part]));
        });
        compositions.set(text, chunks);
        return text;
    }

    function localPlan(parts) {
        return parts.filter(Boolean).flatMap(text => {
            const chunks = [];
            for (const piece of compositions.get(text) || [text]) {
                if (!piece || !piece.trim()) continue;
                // Treat boundaries uniformly, including punctuation inside a
                // complete phrase such as "Spiel Nummer 186!". Original names
                // remain verbatim, including initials and their punctuation.
                if (/^[\s,;:.!?]+$/.test(piece)) {
                    if (chunks.length) chunks[chunks.length - 1].after += piece;
                    continue;
                }
                const value = piece.trim();
                if (names.has(value)) chunks.push({ text: value, before: '', after: '' });
                else {
                    const [, before, body, after] = /^([\s,;:.!?]*)([\s\S]*?)([\s,;:.!?]*)$/.exec(value);
                    chunks.push({ text: body, before, after });
                }
            }
            return chunks;
        });
    }

    function localParts(parts) {
        return localPlan(parts).map(part => part.text);
    }

    function announce(parts, local, claim) {
        const plan = localPlan(parts);
        const call = activeCall;
        if (!claim && call) {
            const kind = createAnnouncementTexts.calls[call.name]?.kind;
            if (kind) claim = context.claim?.(call.setup, kind);
        }
        // The browser may load before the speech worker advertises its recipe
        // version. Build again at playback, after metadata has been synchronized.
        const buildLocalPlan = speech => {
            const current = speech ? { ...curt, speech: { ...curt.speech, ...speech } } : curt;
            if (call && ['bts-context-v1', 'bts-context-v2'].includes(current.speech?.context_version) && ci18n('announcements:lang') === 'de-DE') {
                const planner = typeof module !== 'undefined' && module.exports ? require('./speech_context') : createContextSpeechPlan;
                const recipe = planner(api, current, call.name, call.setup, call.args, parts);
                if (recipe) return recipe;
            }
            return { parts: plan.map(part => part.text), pauses: plan.map((part, index) => {
                const boundary = part.after + (plan[index + 1]?.before || '');
                return /[.!?]/.test(boundary) ? 250 : /[,;:]/.test(boundary) ? 120 : 0;
            }) };
        };
        const prepared = buildLocalPlan();
        context.announce(context.local ? prepared.parts : parts, local, claim, {
            localParts: prepared.parts, localPauses: prepared.pauses,
            ...(!context.local && call ? { buildLocalPlan } : {}),
        });
    }
    const window = context.window;
    const buildAnnouncementClaimKey = context.claim;
    const utils = { find: (items, predicate) => (items || []).find(predicate) };
    function getLocationID(matchSetup) {
        if (!matchSetup) {
            return null;
        }
        if (matchSetup.location_id) {
            return matchSetup.location_id;
        }
        if (matchSetup.court_id) {
            const court = utils.find(curt.courts, c => c._id === matchSetup.court_id);
            if (court && court.location_id) {
                return court.location_id;
            }
        }
        return null;
    }

    function announceNewMatch(matchSetup) {
        const location_id = getLocationID(matchSetup);
        const calls_enabled = window.localStorage.getItem('enable_announcement_calls_' + location_id) === 'true';
        if (!calls_enabled) {
            return;
        }
        const field = createFieldAnnouncement(matchSetup);
        const matchNumber = createMatchNumberAnnouncement(matchSetup);
        const eventName = createEventAnnouncement(matchSetup);
        const round = createRoundAnnouncement(matchSetup);
        const teams = createTeamAnnouncement(matchSetup);
        const umpire = createUmpire(matchSetup);
        const serviceJudge = createServiceJudge(matchSetup);
        const tabletOperator = createTabletOperator(matchSetup);
        announce(
            [field, matchNumber, eventName, round, teams, umpire, serviceJudge, tabletOperator, field],
            false,
            buildAnnouncementClaimKey(matchSetup, 'match_called_on_court'),
        );
    }

    function announcePreparationMatch(matchSetup) {
        const location_id = getLocationID(matchSetup);
        const preparations_enabled = window.localStorage.getItem('enable_announcement_preparations_' + location_id) === 'true';
        if (!preparations_enabled) {
            return;
        }
        const field = createFieldPreparationAnnouncement(matchSetup);
        var preparation = createPreparationAnnouncement(matchSetup, true);
        var matchNumber = createMatchNumberAnnouncement(matchSetup);
        var eventName = createEventAnnouncement(matchSetup);
        var round = createRoundAnnouncement(matchSetup);
        var teams = createTeamAnnouncement(matchSetup);
        const umpire = createUmpire(matchSetup);
        const serviceJudge = createServiceJudge(matchSetup);
        const tabletOperator = createTabletOperator(matchSetup);
        var lastPart = createPreparationClosingAnnouncement(matchSetup, true);
        announce(
            [preparation, field, matchNumber, eventName, round, teams, umpire, serviceJudge, tabletOperator, lastPart],
            false,
            buildAnnouncementClaimKey(matchSetup, 'match_preparation_call'),
        );
    }

    function announceNoMatchWin(matchSetup, winningTeamIndex) {
        const location_id = getLocationID(matchSetup);
        const calls_enabled = window.localStorage.getItem('enable_announcement_calls_' + location_id) === 'true';
        const free_enabled = window.localStorage.getItem('enable_free_announcements') === 'true';
        if (!calls_enabled && !free_enabled) {
            return;
        }
        const teams = matchSetup && matchSetup.teams ? matchSetup.teams : [];
        const team1 = teams[0] && teams[0].players ? createSingleTeam(teams[0].players) : '';
        const team2 = teams[1] && teams[1].players ? createSingleTeam(teams[1].players) : '';
        const winner = teams[winningTeamIndex] && teams[winningTeamIndex].players
            ? createSingleTeam(teams[winningTeamIndex].players)
            : '';
        if (!team1 || !team2 || !winner) {
            return;
        }
        const introParts = [
            createMatchNumberAnnouncement(matchSetup),
            createEventAnnouncement(matchSetup),
            createRoundAnnouncement(matchSetup),
        ].filter(Boolean).map(part => String(part).replace(/!+$/, ''));
        const intro = introParts.length > 0 ? compose([compose(introParts, ', '), '!']) : '';
        const values = {
            team1,
            team2,
            winner,
        };
        const teamsPart = ci18n('announcements:no_match_win:teams', values);
        // Use the translated placeholder order, including repeated winners.
        // Only register a composition if it renders exactly like ci18n.
        const templateParts = ci18n('announcements:no_match_win:teams').split(/(\{(?:team1|team2|winner)\})/)
            .map(part => Object.hasOwn(values, part.slice(1, -1)) ? values[part.slice(1, -1)] : part);
        if (templateParts.join('') === teamsPart) compose(templateParts);
        announce(
            [intro, teamsPart],
            false,
            buildAnnouncementClaimKey(matchSetup, 'match_no_match_announcement'),
        );
    }

    function announceSecondCallTeamOne(matchSetup) {
        if(!(window.localStorage.getItem('enable_announcement_calls_' + getLocationID(matchSetup)) === 'true')) {
            return;
        }
        announceSecondCall(matchSetup, matchSetup.teams[0]);
    }

    function announceSecondCallTeamTwo(matchSetup) {
        if(!(window.localStorage.getItem('enable_announcement_calls_' + getLocationID(matchSetup)) === 'true')) {
            return;
        }
        announceSecondCall(matchSetup, matchSetup.teams[1]);
    }

    function announceSecondPreparationCallTeamOne(matchSetup) {
        if(!(window.localStorage.getItem('enable_announcement_preparations_' + getLocationID(matchSetup)) === 'true')) {
            return;
        }
        announceSecondPreparationCall(matchSetup, matchSetup.teams[0]);
    }

    function announceSecondPreparationCallTeamTwo(matchSetup) {
        if(!(window.localStorage.getItem('enable_announcement_preparations_' + getLocationID(matchSetup)) === 'true')) {
            return;
        }
        announceSecondPreparationCall(matchSetup, matchSetup.teams[1]);
    }

    function announceSecondCallTabletoperator(matchSetup) {
        if (!(window.localStorage.getItem('enable_announcement_calls_' + getLocationID(matchSetup)) === 'true')) {
            return;
        }
        const tabletOperatorCall = createTabletOperator(matchSetup);
        if (tabletOperatorCall != null) {
            const call = prependFieldAnnouncement(matchSetup, compose([createSecondCallAnnouncement(), tabletOperatorCall]));
             announce([call]);
        }
    }
    function announceSecondCallUmpire(matchSetup) {
        if (!(window.localStorage.getItem('enable_announcement_calls_' + getLocationID(matchSetup)) === 'true')) {
            return;
        }
        const umpireCall = createUmpire(matchSetup);
        if (umpireCall != null) {
            const call = prependFieldAnnouncement(matchSetup, compose([createSecondCallAnnouncement(), umpireCall]));
            announce([call]);
        }
    }
    function announceSecondCallServiceJudge(matchSetup) {
        if (!(window.localStorage.getItem('enable_announcement_calls_' + getLocationID(matchSetup)) === 'true')) {
            return;
        }
        const servicejudgeCall = createServiceJudge(matchSetup);
        if (servicejudgeCall != null) {
            const call = prependFieldAnnouncement(matchSetup, compose([createSecondCallAnnouncement(), servicejudgeCall]));
            announce([call]);
        }
    }


    function announceSecondCall(matchSetup, team) {
        if(!(window.localStorage.getItem('enable_announcement_calls_' + getLocationID(matchSetup)) === 'true')) {
            return;
        }
        var secondCall = compose([createSecondCallAnnouncement(), createSingleTeam(team.players)]);
        var field = createFieldAnnouncement(matchSetup);
        announce([secondCall, field]);
    }


    function announceSecondPreparationCallTabletoperator(matchSetup) {
        if(!(window.localStorage.getItem('enable_announcement_preparations_' + getLocationID(matchSetup)) === 'true')) {
            return;
        }
        const tabletOperatorCall = createTabletOperator(matchSetup);
        if (tabletOperatorCall != null) {
            var secondCall = compose([createSecondPreparationCallAnnouncement(), tabletOperatorCall, '!']);


            var callUs = compose([createSingleTeam(matchSetup.tabletoperators), ', ', ci18n('announcements:please_as_tablet_service')]);
            if (curt.preparation_meetingpoint_enabled) {
                var meetingPoint = createMeetingPointAnnouncement(matchSetup, !matchSetup.tabletoperators || matchSetup.tabletoperators.length !== 1);
                meetingPoint = meetingPoint.replace('bitte meldet euch ', '');
                meetingPoint = meetingPoint.replace('Bitte meldet euch ', '');
                meetingPoint = meetingPoint.replace('!', '');
                callUs = compose([callUs, ' ', meetingPoint + 'melden!']);
            }
            announce([secondCall, callUs]);
        }
    }


    function announceSecondPreparationCallUmpire(matchSetup) {
        if(!(window.localStorage.getItem('enable_announcement_preparations_' + getLocationID(matchSetup)) === 'true')) {
            return;
        }
        const umpireCall = createUmpire(matchSetup);
        if (umpireCall != null) {
            var secondCall = compose([createSecondPreparationCallAnnouncement(), umpireCall, '!']);


            var callUs = normalizeNames(matchSetup.umpire.name);
            if (curt.preparation_meetingpoint_enabled) {
                var meetingPoint = createMeetingPointAnnouncement(matchSetup, false);
                callUs = compose([callUs, ' ', meetingPoint]);
            } else {
                callUs = compose([callUs, ' ', ci18n('announcements:preparation') + '!']);
            }
            announce([secondCall, callUs]);
        }
    }

    function announceSecondPreparationCallServiceJudge(matchSetup) {
        if(!(window.localStorage.getItem('enable_announcement_preparations_' + getLocationID(matchSetup)) === 'true')) {
            return;
        }
        const servicejudgeCall = createServiceJudge(matchSetup);
        if (servicejudgeCall != null) {
            var secondCall = compose([createSecondPreparationCallAnnouncement(), servicejudgeCall, '!']);


            var callUs = normalizeNames(matchSetup.service_judge.name);
            if (curt.preparation_meetingpoint_enabled) {
                var meetingPoint = createMeetingPointAnnouncement(matchSetup, false);
                callUs = compose([callUs, ' ', meetingPoint]);
            } else {
                callUs = compose([callUs, ' ', ci18n('announcements:preparation') + '!']);
            }
            announce([secondCall, callUs]);
        }
    }


    function announceSecondPreparationCall(matchSetup, team) {
        if(!(window.localStorage.getItem('enable_announcement_preparations_' + getLocationID(matchSetup)) === 'true')) {
            return;
        }
        var secondCall = compose([createSecondPreparationCallAnnouncement(), createSingleTeam(team.players)]);
        const usePlural = team.players.length !== 1;
        if(matchSetup.location_id) {
            const l = utils.find(curt.locations, l => l._id === matchSetup.location_id);
            if(l) {
                secondCall = compose([secondCall, ' ', resolveSingularPluralAnnouncement(l.preparation_addition, usePlural)]);
            }
        }
        secondCall = compose([secondCall, '!']);
        var callUs = createSingleTeam(team.players);
        if (curt.preparation_meetingpoint_enabled) {
            var meetingPoint = createMeetingPointAnnouncement(matchSetup, usePlural);

            callUs = compose([callUs, ' ', meetingPoint]);
        }
        announce([secondCall, callUs]);
    }

    function announceBeginnToPlay(matchSetup) {
        if(!(window.localStorage.getItem('enable_announcement_calls_' + getLocationID(matchSetup)) === 'true')) {
            return;
        }
        announce([createBeginToPlayAnnouncement(matchSetup)]);
    }

    function prependFieldAnnouncement(matchSetup, text) {
        return compose([createFieldAnnouncement(matchSetup), text].filter(Boolean), ' ');
    }

    function createBeginToPlayAnnouncement(matchSetup) {
        return prependFieldAnnouncement(matchSetup, ci18n('announcements:begin_to_play'));
    }

    function createSecondCallAnnouncement() {
        return ci18n('announcements:second_call') + ' ' + ci18n('announcements:second_call_for') + ':';
    }

    function createSecondPreparationCallAnnouncement() {
        return ci18n('announcements:second_call') + ' ' + ci18n('announcements:preparation')+ ' ' + ci18n('announcements:second_call_for') + ':';
    }

    function createTeamAnnouncement(matchSetup) {
        var teams = compose([createSingleTeam(matchSetup.teams[0].players), ',' + ci18n('announcements:vs'), createSingleTeam(matchSetup.teams[1].players)]);
        return teams;
    }

    function createTabletOperator(matchSetup) {
        if (matchSetup.tabletoperators && matchSetup.tabletoperators != null) {
            return compose([curt.tabletoperator_use_manual_counting_boards_enabled ? ci18n('announcements:counting_board_service') : ci18n('announcements:table_service'), createSingleTeam(matchSetup.tabletoperators)]);
        }
        return null;
    }

    function createUmpire(matchSetup) {
        if (matchSetup.umpire && matchSetup.umpire.name && matchSetup.umpire.name != null) {
            return compose([ci18n('announcements:umpire'), normalizeNames(matchSetup.umpire.name)]);
        }
        return null;
    }

    function createServiceJudge(matchSetup) {
        if (matchSetup.service_judge && matchSetup.service_judge.name && matchSetup.service_judge.name != null) {
            return compose([ci18n('announcements:service_judge'), normalizeNames(matchSetup.service_judge.name)]);
        }
        return null;
    }

    function createSingleTeam(playersSetup) {
        var team = normalizeNames(playersSetup[0].name);
        if (playersSetup.length == 2) {
            team = compose([team, ci18n('announcements:and'), normalizeNames(playersSetup[1].name)]);
        }
        return team;
    }


    function normalizeNames(name) {
        if (curt.normalizations && curt.normalizations.length > 0) {
            for (const norm of curt.normalizations) {
                if (ci18n('announcements:lang') == norm.language) {
                    name = name.replaceAll(norm.origin, norm.replace);
                }
            }
        }
        if (typeof name === 'string') names.add(name.trim());
        return name;
    }

    function createRoundAnnouncement(matchSetup) {
        if (curt.annoncement_include_round) {
            var round = matchSetup.match_name;
            if (round == 'R16') {
                round = ci18n('announcements:round_16');
            } else if (round == 'VF') {
                round = ci18n('announcements:quaterfinal');
            } else if (round == 'HF') {
                round = ci18n('announcements:semifinal');
            } else if (round == 'Finale') {
                round = ci18n('announcements:final');
            } else if (round.indexOf('/') !== -1) {
                var roundParts = round.split('/');
                var diff = roundParts[1] - roundParts[0];
                round = [
                    ci18n(diff > 1 ? 'announcements:round_for_places' : 'announcements:game_for_place'),
                    roundParts[0],
                    ci18n(diff > 1 ? 'announcements:to' : 'announcements:and'),
                    roundParts[1],
                ].map(part => part.trim()).join(' ');
            } else if (round.indexOf('-') !== -1) {
                round = ci18n('announcements:intermediate_round');
            } else {
                round = '';
            }
            return round;
        } else {
            return null;
        }
    }
    function eventAnnouncementNameByCode(code) {
        if (code == 'JE') {
            return ci18n('announcements:boys_singles');
        } else if (code == 'JD') {
            return ci18n('announcements:boys_doubles');
        } else if (code == 'ME') {
            return ci18n('announcements:girls_singles');
        } else if (code == 'MD') {
            return ci18n('announcements:girls_doubles');
        } else if (code == 'GD' || code == 'MX') {
            return ci18n('announcements:mixed_doubles');
        } else if (code == 'HE') {
            return ci18n('announcements:men_singles');
        } else if (code == 'HD') {
            return ci18n('announcements:men_doubles');
        } else if (code == 'DE') {
            return ci18n('announcements:women_singles');
        } else if (code == 'DD') {
            return ci18n('announcements:women_doubles');
        } else if (code == 'E') {
            return ci18n('announcements:singles');
        } else if (code == 'D') {
            return ci18n('announcements:doubles');
        }
        return '';
    }

    function createEventAnnouncement(matchSetup) {
        if (curt.annoncement_include_event) {
            var eventParts = matchSetup.event_name.replaceAll('-', ' ').split(' ');
            var eventName = eventAnnouncementNameByCode(eventParts[0]);
            if (eventName == '') {
                eventName = eventAnnouncementNameByCode(eventParts[1]);
                if (eventParts[0]) {
                    eventName = eventName + ' ' + eventParts[0];
                }
            } else {
                if (eventParts[1]) {
                    eventName = eventName + ' ' + eventParts[1];
                }
            }
            return eventName;
        } else {
            return null;
        }
    }

    function createMatchNumberAnnouncement(matchSetup) {
        if (curt.annoncement_include_matchnumber) {
            var number = matchSetup.match_num;
            return ci18n('announcements:match_number') + number + '!';
        } else {
            return null;
        }
    }

    function createFieldAnnouncement(matchSetup) {
        if (matchSetup.court_id) {
            var court = matchSetup.court_id.split('_')[1];
            return ci18n('announcements:on_court') + court + '!';
        } else {
            return '';
        }

    }
    function createFieldPreparationAnnouncement(matchSetup) {
        if (matchSetup.court_id) {
            var court = matchSetup.court_id.split('_')[1];
            return ci18n('announcements:for_court') + court + '!';
        } else {
            return '';
        }

    }

    function resolveSingularPluralAnnouncement(text, usePlural) {
        return (text || '').replace(/\{([^{}/]*)\/([^{}]*)\}/g, function(match, singular, plural) {
            return usePlural ? plural : singular;
        });
    }

    function createPreparationAnnouncement(matchSetup, usePlural) {
        let addition = '';
        if(matchSetup.location_id) {
            const l = utils.find(curt.locations, l => l._id === matchSetup.location_id);
            if(l) {
                addition = ' ' + resolveSingularPluralAnnouncement(l.preparation_addition, usePlural !== false);
            }
        }
        return compose([ci18n('announcements:preparation'), addition]);
    }

    function createMeetingPointAnnouncement(matchSetup, usePlural) {
        let result = ci18n('announcements:meetingpoint');
        if(matchSetup.location_id) {
            const l = utils.find(curt.locations, l => l._id === matchSetup.location_id);
            if(l) {
                result = resolveSingularPluralAnnouncement(l.meetingpoint_announcement, usePlural !== false);
            }
        }

        return result;
    }

    function createPreparationClosingAnnouncement(matchSetup, usePlural) {
        const meeting = curt.preparation_meetingpoint_enabled ? createMeetingPointAnnouncement(matchSetup, usePlural) : '';
        return meeting.trim() ? meeting : ci18n('announcements:match_in_preparation');
    }

    api = { localPlan, localParts, getLocationID, announceNewMatch, announcePreparationMatch, announceNoMatchWin, announceSecondCallTeamOne, announceSecondCallTeamTwo, announceSecondPreparationCallTeamOne, announceSecondPreparationCallTeamTwo, announceSecondCallTabletoperator, announceSecondCallUmpire, announceSecondCallServiceJudge, announceSecondCall, announceSecondPreparationCallTabletoperator, announceSecondPreparationCallUmpire, announceSecondPreparationCallServiceJudge, announceSecondPreparationCall, announceBeginnToPlay, createBeginToPlayAnnouncement, createSecondCallAnnouncement, createSecondPreparationCallAnnouncement, createTeamAnnouncement, createTabletOperator, createUmpire, createServiceJudge, createSingleTeam, normalizeNames, createRoundAnnouncement, eventAnnouncementNameByCode, createEventAnnouncement, createMatchNumberAnnouncement, createFieldAnnouncement, createFieldPreparationAnnouncement, resolveSingularPluralAnnouncement, createPreparationAnnouncement, createMeetingPointAnnouncement, createPreparationClosingAnnouncement };
    for (const [name, fn] of Object.entries(api)) {
        if (!name.startsWith('announce')) continue;
        api[name] = (setup, ...args) => {
            const previous = activeCall;
            activeCall = { name, setup, args };
            try { return fn(setup, ...args); }
            finally { activeCall = previous; }
        };
    }
    return api;
}

// Shared with playback receipts on the server so every game announcement
// keeps the same identity and description from the button to the audio device.
createAnnouncementTexts.calls = Object.freeze({
    announceNewMatch: { kind: 'match_called_on_court', label: 'Spielaufruf' },
    announcePreparationMatch: { kind: 'match_preparation_call', label: 'Vorbereitungsaufruf' },
    announceBeginnToPlay: { kind: 'begin_to_play_call', label: 'Aufforderung zum Spielbeginn' },
    announceSecondCallTeamOne: { kind: 'second_call_team_one', label: 'Nachaufruf Paarung 1' },
    announceSecondCallTeamTwo: { kind: 'second_call_team_two', label: 'Nachaufruf Paarung 2' },
    announceSecondCallTabletoperator: { kind: 'second_call_tabletoperator', label: 'Nachaufruf Tabletbedienung' },
    announceSecondCallUmpire: { kind: 'second_call_umpire', label: 'Nachaufruf Schiedsrichter' },
    announceSecondCallServiceJudge: { kind: 'second_call_servicejudge', label: 'Nachaufruf Aufschlagrichter' },
    announceSecondPreparationCallTeamOne: { kind: 'second_preparation_call_team_one', label: 'Nachaufruf zur Vorbereitung · Paarung 1' },
    announceSecondPreparationCallTeamTwo: { kind: 'second_preparation_call_team_two', label: 'Nachaufruf zur Vorbereitung · Paarung 2' },
    announceSecondPreparationCallTabletoperator: { kind: 'second_preparation_call_tabletoperator', label: 'Nachaufruf zur Vorbereitung · Tabletbedienung' },
    announceSecondPreparationCallUmpire: { kind: 'second_preparation_call_umpire', label: 'Nachaufruf zur Vorbereitung · Schiedsrichter' },
    announceSecondPreparationCallServiceJudge: { kind: 'second_preparation_call_servicejudge', label: 'Nachaufruf zur Vorbereitung · Aufschlagrichter' },
    announceNoMatchWin: { kind: 'match_no_match_announcement', label: 'Bekanntgabe kampfloses Ergebnis' },
});
createAnnouncementTexts.parseClaim = claim => {
    const parts = /^([^:]+):([^:]+):([0-9]+)(?::([a-zA-Z0-9_-]+))?$/.exec(String(claim || ''));
    if (!parts) return null;
    const call = Object.values(createAnnouncementTexts.calls).find(call => call.kind === parts[1]);
    return call ? { ...call, match_id: parts[2], requested_at: Number(parts[3]), id: String(claim) } : null;
};

if (typeof module !== 'undefined' && module.exports) { module.exports = createAnnouncementTexts; }
