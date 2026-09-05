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
        buildAnnouncementClaimKey(matchSetup, 'match_called_on_court')
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
    var lastPart = preparation;
    if (curt.preparation_meetingpoint_enabled) {
        lastPart = createMeetingPointAnnouncement(matchSetup, true);
    }
    announce(
        [preparation, field, matchNumber, eventName, round, teams, umpire, serviceJudge, tabletOperator, lastPart],
        false,
        buildAnnouncementClaimKey(matchSetup, 'match_preparation_call')
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
    const intro = introParts.length > 0 ? introParts.join(', ') + '!' : '';
    const teamsPart = ci18n('announcements:no_match_win:teams', {
        team1,
        team2,
        winner,
    });
    announce(
        [intro, teamsPart],
        false,
        buildAnnouncementClaimKey(matchSetup, 'match_no_match_announcement')
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
        const call = createFieldAnnouncement(matchSetup) + createSecondCallAnnouncement() + tabletOperatorCall;
         announce([call]);
    }
}
function announceSecondCallUmpire(matchSetup) {
    if (!(window.localStorage.getItem('enable_announcement_calls_' + getLocationID(matchSetup)) === 'true')) {
        return;
    }
    const umpireCall = createUmpire(matchSetup);;
    if (umpireCall != null) {
        const call = createFieldAnnouncement(matchSetup) + createSecondCallAnnouncement() + umpireCall;
        announce([call]);
    }
}
function announceSecondCallServiceJudge(matchSetup) {
    if (!(window.localStorage.getItem('enable_announcement_calls_' + getLocationID(matchSetup)) === 'true')) {
        return;
    }
    const servicejudgeCall = createServiceJudge(matchSetup);;
    if (servicejudgeCall != null) {
        const call = createFieldAnnouncement(matchSetup) + createSecondCallAnnouncement() + servicejudgeCall;
        announce([call]);
    }
}


function announceSecondCall(matchSetup, team) {
    if(!(window.localStorage.getItem('enable_announcement_calls_' + getLocationID(matchSetup)) === 'true')) {
        return;
    }
    var secondCall = createSecondCallAnnouncement() + createSingleTeam(team.players);
    var field = createFieldAnnouncement(matchSetup);
    announce([secondCall, field]);
}


function announceSecondPreparationCallTabletoperator(matchSetup) {
    if(!(window.localStorage.getItem('enable_announcement_preparations_' + getLocationID(matchSetup)) === 'true')) {
        return;
    }
    const tabletOperatorCall = createTabletOperator(matchSetup);
    if (tabletOperatorCall != null) { 
        var secondCall = createSecondPreparationCallAnnouncement() + tabletOperatorCall + '!';
        
        
        var callUs = createSingleTeam(matchSetup.tabletoperators) + ', ' + ci18n('announcements:please_as_tablet_service');
        if (curt.preparation_meetingpoint_enabled) {
            var meetingPoint = createMeetingPointAnnouncement(matchSetup, !matchSetup.tabletoperators || matchSetup.tabletoperators.length !== 1);
            meetingPoint = meetingPoint.replace("bitte meldet euch ", "");
            meetingPoint = meetingPoint.replace("Bitte meldet euch ", "");
            meetingPoint = meetingPoint.replace("!", "");
            callUs += ' ' + meetingPoint + 'melden!';
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
        var secondCall = createSecondPreparationCallAnnouncement() + umpireCall + '!';
        
        
        var callUs = normalizeNames(matchSetup.umpire.name);
        if (curt.preparation_meetingpoint_enabled) {
            var meetingPoint = createMeetingPointAnnouncement(matchSetup, false);
            callUs += ' ' + meetingPoint;
        } else {
            callUs += ' ' + ci18n('announcements:preparation') + '!';
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
        var secondCall = createSecondPreparationCallAnnouncement() + servicejudgeCall + '!';
        
        
        var callUs = normalizeNames(matchSetup.service_judge.name);
        if (curt.preparation_meetingpoint_enabled) {
            var meetingPoint = createMeetingPointAnnouncement(matchSetup, false);
            callUs += ' ' + meetingPoint;
        } else {
            callUs += ' ' + ci18n('announcements:preparation') + '!';
        }
        announce([secondCall, callUs]);
    }
}


function announceSecondPreparationCall(matchSetup, team) {
    if(!(window.localStorage.getItem('enable_announcement_preparations_' + getLocationID(matchSetup)) === 'true')) {
        return;
    }
    var secondCall = createSecondPreparationCallAnnouncement() + createSingleTeam(team.players);
    const usePlural = team.players.length !== 1;
    if(matchSetup.location_id) {
        const l = utils.find(curt.locations, l => l._id === matchSetup.location_id);
        if(l) {
            secondCall += ' ' + resolveSingularPluralAnnouncement(l.preparation_addition, usePlural);
        }
    }
    secondCall += "!";
    var callUs = createSingleTeam(team.players);
    if (curt.preparation_meetingpoint_enabled) {
        var meetingPoint = createMeetingPointAnnouncement(matchSetup, usePlural);
        
        callUs += ' ' + meetingPoint;
    }
    announce([secondCall, callUs]);
}

function announceBeginnToPlay(matchSetup, team) {
    if(!(window.localStorage.getItem('enable_announcement_calls_' + getLocationID(matchSetup)) === 'true')) {
        return;
    }
    announce([createFieldAnnouncement(matchSetup) + ci18n('announcements:begin_to_play')]);
}

function createSecondCallAnnouncement() {
    return ci18n('announcements:second_call') + ' ' + ci18n('announcements:second_call_for') + ':';
}

function createSecondPreparationCallAnnouncement() {
    return ci18n('announcements:second_call') + ' ' + ci18n('announcements:preparation')+ ' ' + ci18n('announcements:second_call_for') + ':';
}

function createTeamAnnouncement(matchSetup) {
    var teams = createSingleTeam(matchSetup.teams[0].players) + "," + ci18n('announcements:vs') + createSingleTeam(matchSetup.teams[1].players);
    return teams;
}

function createTabletOperator(matchSetup) {
    if (matchSetup.tabletoperators && matchSetup.tabletoperators != null) {
        return (curt.tabletoperator_use_manual_counting_boards_enabled ? ci18n('announcements:counting_board_service') : ci18n('announcements:table_service')) + createSingleTeam(matchSetup.tabletoperators);
    } 
    return null;
}

function createUmpire(matchSetup) {
    if (matchSetup.umpire && matchSetup.umpire.name && matchSetup.umpire.name != null) {
        return ci18n('announcements:umpire') + normalizeNames(matchSetup.umpire.name);
    }
    return null;
}

function createServiceJudge(matchSetup) {
    if (matchSetup.service_judge && matchSetup.service_judge.name && matchSetup.service_judge.name != null) {
        return ci18n('announcements:service_judge') + normalizeNames(matchSetup.service_judge.name);
    }
    return null;
}

function createSingleTeam(playersSetup) {
    var team = normalizeNames(playersSetup[0].name);
    if (playersSetup.length == 2) {
        team = team + ci18n('announcements:and') + normalizeNames(playersSetup[1].name)
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
    return name;
}

function createRoundAnnouncement(matchSetup) {
    if (curt.annoncement_include_round) {
        var round = matchSetup.match_name;
        if (round == "R16") {
            round = ci18n('announcements:round_16');
        } else if (round == "VF") {
            round = ci18n('announcements:quaterfinal');
        } else if (round == "HF") {
            round = ci18n('announcements:semifinal');
        } else if (round == "Finale") {
            round = ci18n('announcements:final');
        } else if (round.indexOf('/') !== -1) {
            var roundParts = round.split("/")
            var diff = roundParts[1] - roundParts[0];
            if (diff > 1) {
                round = ci18n('announcements:round_for_places') + roundParts[0] + ci18n('announcements:to') + roundParts[1];
            } else {
                round = ci18n('announcements:game_for_place') + roundParts[0] + ci18n('announcements:and') + roundParts[1];
            }
        } else if (round.indexOf('-') !== -1) {
            round = ci18n('announcements:intermediate_round');
        } else {
            round = "";
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
    return "";
}

function createEventAnnouncement(matchSetup) {
    if (curt.annoncement_include_event) {
        var eventParts = matchSetup.event_name.replaceAll("-", " ").split(" ");
        var eventName = eventAnnouncementNameByCode(eventParts[0]);
        if (eventName == "") {
            eventName = eventAnnouncementNameByCode(eventParts[1]);
            if (eventParts[0]) {
                eventName = eventName + " " + eventParts[0];
            }
        } else {
            if (eventParts[1]) {
                eventName = eventName + " " + eventParts[1];
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
        return ci18n('announcements:match_number') + number + "!";
    } else {
        return null;
    }
}

function createFieldAnnouncement(matchSetup) {
    if (matchSetup.court_id) {
        var court = matchSetup.court_id.split("_")[1];
        return ci18n('announcements:on_court') + court + "!";
    } else {
        return "";
    }

}
function createFieldPreparationAnnouncement(matchSetup) {
    if (matchSetup.court_id) {
        var court = matchSetup.court_id.split("_")[1];
        return ci18n('announcements:for_court') + court + "!";
    } else {
        return "";
    }

}

function resolveSingularPluralAnnouncement(text, usePlural) {
    return (text || '').replace(/\{([^{}\/]*)\/([^{}]*)\}/g, function(match, singular, plural) {
        return usePlural ? plural : singular;
    });
}

function createPreparationAnnouncement(matchSetup, usePlural) {
    let addition = "";
    if(matchSetup.location_id) {
        const l = utils.find(curt.locations, l => l._id === matchSetup.location_id);
        if(l) {
            addition = ' ' + resolveSingularPluralAnnouncement(l.preparation_addition, usePlural !== false);
        }
    }
    return ci18n('announcements:preparation') + addition;
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

let emergencyInterval = null;
let emergencyAudio = null;
const ANNOUNCEMENT_DEDUP_TTL_MS = 2500;
const ANNOUNCEMENT_TAB_ID = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const ANNOUNCEMENT_LEADER_KEY = 'bts_announcement_leader';
const ANNOUNCEMENT_LEADER_LEASE_MS = 500;
const ANNOUNCEMENT_LEADER_HEARTBEAT_MS = 200;
const ANNOUNCEMENT_RETRY_BROADCAST_KEY = 'bts_announcement_retry_request';
const ANNOUNCEMENT_SPEECH_CHECK_STATE_KEY = 'bts_announcement_speech_check_state';
const ANNOUNCEMENT_RETRY_TTL_MS = 5000;
const ANNOUNCEMENT_LEADER_FAILOVER_SUPPRESS_MS = 1500;
const announcementPlaybackQueue = [];
let announcementPlaybackActive = false;
let announcementVoicesPromise = null;
let announcementLeaderHeartbeat = null;
let announcementLeaderLockHeld = false;
let announcementLeaderLockAcquire = null;
let releaseAnnouncementLeaderLock = null;
let announcementLeaderSuppressUntil = 0;
const processedAnnouncementRetryIds = new Set();
let announcementSpeechCheckState = {
    status: 'untested',
    detail: '',
    updated_at: null,
};

function announcementDebugLog(...args) {
    if (curt && curt.bts_debug_output_enabled === true) {
        console.log(...args);
    }
}

function readAnnouncementSpeechCheckStateStorage() {
    try {
        const raw = window.localStorage.getItem(ANNOUNCEMENT_SPEECH_CHECK_STATE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function writeAnnouncementSpeechCheckStateStorage(state) {
    try {
        window.localStorage.setItem(ANNOUNCEMENT_SPEECH_CHECK_STATE_KEY, JSON.stringify(state));
    } catch (e) {
        // ignore
    }
}

function readAnnouncementLeaderState() {
    try {
        return JSON.parse(window.localStorage.getItem(ANNOUNCEMENT_LEADER_KEY) || 'null');
    } catch (e) {
        return null;
    }
}

function writeAnnouncementLeaderState(owner) {
    try {
        window.localStorage.setItem(ANNOUNCEMENT_LEADER_KEY, JSON.stringify({
            owner,
            expires_at: Date.now() + ANNOUNCEMENT_LEADER_LEASE_MS,
        }));
    } catch (e) {
        // ignore
    }
}

function releaseAnnouncementLeaderIfOwned() {
    const current = readAnnouncementLeaderState();
    if (current && current.owner === ANNOUNCEMENT_TAB_ID) {
        try {
            window.localStorage.removeItem(ANNOUNCEMENT_LEADER_KEY);
        } catch (e) {
            // ignore
        }
    }
}

function refreshAnnouncementLeader() {
    if (announcementLeaderSuppressUntil > Date.now()) {
        releaseAnnouncementLeaderIfOwned();
        return false;
    }
    const current = readAnnouncementLeaderState();
    const now = Date.now();
    if (!current || !current.owner || !current.expires_at || current.expires_at <= now || current.owner === ANNOUNCEMENT_TAB_ID) {
        writeAnnouncementLeaderState(ANNOUNCEMENT_TAB_ID);
        return true;
    }
    return current.owner === ANNOUNCEMENT_TAB_ID;
}

function isAnnouncementLeader() {
    const current = readAnnouncementLeaderState();
    return !!current && current.owner === ANNOUNCEMENT_TAB_ID && current.expires_at > Date.now();
}

function startAnnouncementLeaderHeartbeat() {
    if (announcementLeaderHeartbeat != null) {
        return;
    }
    refreshAnnouncementLeader();
    announcementLeaderHeartbeat = window.setInterval(() => {
        refreshAnnouncementLeader();
    }, ANNOUNCEMENT_LEADER_HEARTBEAT_MS);
    window.addEventListener('visibilitychange', () => {
        refreshAnnouncementLeader();
    });
    window.addEventListener('beforeunload', () => {
        releaseAnnouncementLeaderIfOwned();
        if (releaseAnnouncementLeaderLock) {
            releaseAnnouncementLeaderLock();
        }
    });
}

function ensureAnnouncementLeaderLock() {
    if (announcementLeaderSuppressUntil > Date.now()) {
        return Promise.resolve(false);
    }
    if (!(navigator && navigator.locks && typeof navigator.locks.request === 'function')) {
        return Promise.resolve(isAnnouncementLeader() || refreshAnnouncementLeader());
    }
    if (announcementLeaderLockHeld) {
        return Promise.resolve(true);
    }
    if (announcementLeaderLockAcquire) {
        return announcementLeaderLockAcquire;
    }

    announcementLeaderLockAcquire = new Promise((resolve) => {
        let resolved = false;
        navigator.locks.request('bts-announcement-leader', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
            if (!lock) {
                resolved = true;
                resolve(false);
                return false;
            }

            announcementLeaderLockHeld = true;
            resolved = true;
            resolve(true);

            await new Promise((release) => {
                releaseAnnouncementLeaderLock = () => {
                    releaseAnnouncementLeaderLock = null;
                    announcementLeaderLockHeld = false;
                    release();
                };
            });

            return true;
        }).catch(() => {
            if (!resolved) {
                resolve(false);
            }
        }).finally(() => {
            announcementLeaderLockAcquire = null;
        });
    });

    return announcementLeaderLockAcquire;
}

function buildAnnouncementClaimKey(matchSetup, kind) {
    const explicit = matchSetup && matchSetup._announcement_claim_key;
    if (explicit) {
        return explicit;
    }
    const matchId = matchSetup && (matchSetup._match_id || matchSetup.match_id || matchSetup.id || matchSetup.btp_id);
    return matchId ? `${kind}:${matchId}` : null;
}

function announcementFingerprint(callArray) {
    let hash = 0;
    const input = JSON.stringify(callArray || []);
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash) + input.charCodeAt(i);
        hash |= 0;
    }
    return String(hash);
}

function claimAnnouncementPlaybackSync(callArray, claimKey) {
    const now = Date.now();
    const key = `announcement_claim_${claimKey || announcementFingerprint(callArray)}`;
    try {
        if (!isAnnouncementLeader() && !refreshAnnouncementLeader()) {
            return false;
        }
        const raw = window.localStorage.getItem(key);
        if (raw) {
            const current = JSON.parse(raw);
            if (current && current.expires_at && current.expires_at > now) {
                return false;
            }
        }
        const claim = JSON.stringify({
            owner: ANNOUNCEMENT_TAB_ID,
            expires_at: now + ANNOUNCEMENT_DEDUP_TTL_MS
        });
        window.localStorage.setItem(key, claim);
        const confirmed = JSON.parse(window.localStorage.getItem(key) || 'null');
        return !!confirmed && confirmed.owner === ANNOUNCEMENT_TAB_ID;
    } catch (e) {
        return true;
    }
}

function releaseAnnouncementPlaybackClaim(callArray, claimKey) {
    const key = `announcement_claim_${claimKey || announcementFingerprint(callArray)}`;
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) {
            return;
        }
        const current = JSON.parse(raw);
        if (current && current.owner === ANNOUNCEMENT_TAB_ID) {
            window.localStorage.removeItem(key);
        }
    } catch (e) {
        // ignore
    }
}

function claimAnnouncementPlayback(callArray, claimKey) {
    const lockName = `bts-announcement-claim:${claimKey || announcementFingerprint(callArray)}`;
    if (!(navigator && navigator.locks && typeof navigator.locks.request === 'function')) {
        return Promise.resolve(claimAnnouncementPlaybackSync(callArray, claimKey));
    }
    return navigator.locks.request(lockName, { mode: 'exclusive' }, () => {
        return claimAnnouncementPlaybackSync(callArray, claimKey);
    });
}

function emergency_announce(enable) {


    if (enable) {
        // Verhindert mehrfaches Starten
        if (emergencyInterval !== null) {
            return;
        }

        emergencyAudio = new Audio('/static/audio/evakuierung.mp3');

        // Sofort abspielen
        emergencyAudio.play();

        // Wiederholung alle 30 Sekunden
        emergencyInterval = setInterval(() => {
            emergencyAudio.currentTime = 0;
            emergencyAudio.play();
        }, 20_000);

    } else {
        // Timer stoppen
        if (emergencyInterval !== null) {
            clearInterval(emergencyInterval);
            emergencyInterval = null;
        }

        // Audio stoppen
        if (emergencyAudio) {
            emergencyAudio.pause();
            emergencyAudio.currentTime = 0;
            emergencyAudio = null;
        }
    }
}

function getAnnouncementVoices() {
    if (announcementVoicesPromise) {
        return announcementVoicesPromise;
    }
    announcementVoicesPromise = new Promise(function (resolve) {
        let voices = window.speechSynthesis.getVoices();
        if (voices.length !== 0) {
            resolve(voices);
            return;
        }
        const onVoicesChanged = function () {
            window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
            voices = window.speechSynthesis.getVoices();
            resolve(voices);
        };
        window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    });
    return announcementVoicesPromise;
}

function findAnnouncementVoice(voices) {
    for (let i = 0; i < voices.length; i++) {
        if (voices[i].voiceURI == ci18n('announcements:voice')) {
            return voices[i];
        }
    }
    return null;
}

function setAnnouncementSpeechCheckState(status, detail) {
    announcementSpeechCheckState = {
        status,
        detail: detail || '',
        updated_at: Date.now(),
    };
    writeAnnouncementSpeechCheckStateStorage(announcementSpeechCheckState);
    window.dispatchEvent(new CustomEvent('announcement-speech-check-state-changed', {
        detail: getAnnouncementSpeechCheckState(),
    }));
    return announcementSpeechCheckState;
}

function getAnnouncementSpeechCheckState() {
    const storedState = readAnnouncementSpeechCheckStateStorage();
    if (storedState && (!announcementSpeechCheckState.updated_at || (storedState.updated_at || 0) > (announcementSpeechCheckState.updated_at || 0))) {
        announcementSpeechCheckState = storedState;
    }
    return { ...announcementSpeechCheckState };
}

function runAnnouncementSpeechCheck() {
    if (!(window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function')) {
        return Promise.resolve(setAnnouncementSpeechCheckState('unsupported', ci18n('announcements:speechcheck:unsupported')));
    }

    return getAnnouncementVoices().then((voices) => {
        const voice = findAnnouncementVoice(voices);
        return new Promise((resolve) => {
            let done = false;
            let started = false;
            const startedAt = Date.now();
            const finish = (status, detail) => {
                if (done) {
                    return;
                }
                done = true;
                resolve(setAnnouncementSpeechCheckState(status, detail));
            };

            const words = new SpeechSynthesisUtterance(ci18n('announcements:speechcheck:text'));
            words.lang = ci18n('announcements:lang');
            words.rate = curt.announcement_speed ? curt.announcement_speed : 1.05;
            words.pitch = 0;
            words.volume = 1;
            words.voice = voice;

            const timeout = window.setTimeout(() => {
                finish('timeout', ci18n('announcements:speechcheck:timeout'));
            }, 4000);

            const wrappedFinish = (status, detail) => {
                window.clearTimeout(timeout);
                finish(status, detail);
            };
            words.onstart = function () {
                started = true;
            };
            words.onend = function () {
                const elapsed = Date.now() - startedAt;
                if (!started || elapsed < 300) {
                    wrappedFinish('suspicious', ci18n('announcements:speechcheck:suspicious'));
                    return;
                }
                wrappedFinish('active', ci18n('announcements:speechcheck:ok'));
            };
            words.onerror = function (event) {
                const suffix = event && event.error ? ` (${event.error})` : '';
                wrappedFinish('error', ci18n('announcements:speechcheck:error') + suffix);
            };

            try {
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(words);
            } catch (e) {
                window.clearTimeout(timeout);
                finish('error', ci18n('announcements:speechcheck:error'));
            }
        });
    }).catch(() => {
        return setAnnouncementSpeechCheckState('error', ci18n('announcements:speechcheck:error'));
    });
}

function playAnnouncementBatch(parts, voice, done, claimKey) {
    const filteredParts = (parts || []).filter((part) => !!part);
    let index = 0;
    let batchStarted = false;
    let batchStatus = 'ok';
    const playNext = () => {
        if (index >= filteredParts.length) {
            done(batchStarted ? batchStatus : 'suspicious');
            return;
        }
        let utteranceStarted = false;
        let utteranceStartedAt = 0;
        const words = new SpeechSynthesisUtterance(filteredParts[index]);
        words.lang = ci18n('announcements:lang');
        words.rate = curt.announcement_speed ? curt.announcement_speed : 1.05;
        words.pitch = 0;
        words.volume = 1;
        words.voice = voice;
        words.onstart = function () {
            batchStarted = true;
            utteranceStarted = true;
            utteranceStartedAt = Date.now();
            announcementDebugLog('[bts] announcement utterance start', {
                claimKey: claimKey || null,
                index,
                part: filteredParts[index],
                visibilityState: document.visibilityState,
            });
        };
        words.onend = function () {
            const elapsed = utteranceStartedAt ? (Date.now() - utteranceStartedAt) : 0;
            if (!utteranceStarted || elapsed < 300) {
                if (batchStatus !== 'error') {
                    batchStatus = 'suspicious';
                }
            }
            announcementDebugLog('[bts] announcement utterance end', {
                claimKey: claimKey || null,
                index,
                part: filteredParts[index],
                visibilityState: document.visibilityState,
            });
            index += 1;
            playNext();
        };
        words.onerror = function (event) {
            batchStatus = 'error';
            announcementDebugLog('[bts] announcement utterance error', {
                claimKey: claimKey || null,
                index,
                part: filteredParts[index],
                error: event && event.error ? event.error : null,
                visibilityState: document.visibilityState,
            });
            index += 1;
            playNext();
        };
        window.speechSynthesis.speak(words);
    };
    playNext();
}

function releaseAnnouncementLeaderForFailover() {
    announcementLeaderSuppressUntil = Date.now() + ANNOUNCEMENT_LEADER_FAILOVER_SUPPRESS_MS;
    releaseAnnouncementLeaderIfOwned();
    if (releaseAnnouncementLeaderLock) {
        releaseAnnouncementLeaderLock();
    }
}

function requestAnnouncementRetry(batch) {
    if (!batch || !batch.claimKey || (batch.retryCount || 0) >= 1) {
        return;
    }
    const request = {
        id: `${batch.claimKey}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        claimKey: batch.claimKey,
        callArray: batch.callArray,
        excludeTabId: ANNOUNCEMENT_TAB_ID,
        retryCount: (batch.retryCount || 0) + 1,
        expiresAt: Date.now() + ANNOUNCEMENT_RETRY_TTL_MS,
    };
    try {
        window.localStorage.setItem(ANNOUNCEMENT_RETRY_BROADCAST_KEY, JSON.stringify(request));
    } catch (e) {
        // ignore
    }
}

function handleAnnouncementRetryRequest(request) {
    if (!request || !request.id || processedAnnouncementRetryIds.has(request.id)) {
        return;
    }
    processedAnnouncementRetryIds.add(request.id);
    if (request.excludeTabId === ANNOUNCEMENT_TAB_ID) {
        return;
    }
    if (request.expiresAt && request.expiresAt < Date.now()) {
        return;
    }
    announce(request.callArray || [], false, request.claimKey, {
        retryCount: request.retryCount || 0,
        allowRetry: false,
    });
}

window.addEventListener('storage', function(event) {
    if (event.key === ANNOUNCEMENT_SPEECH_CHECK_STATE_KEY && event.newValue) {
        try {
            const state = JSON.parse(event.newValue);
            if (state && (!announcementSpeechCheckState.updated_at || (state.updated_at || 0) >= (announcementSpeechCheckState.updated_at || 0))) {
                announcementSpeechCheckState = state;
                window.dispatchEvent(new CustomEvent('announcement-speech-check-state-changed', {
                    detail: getAnnouncementSpeechCheckState(),
                }));
            }
        } catch (e) {
            // ignore
        }
        return;
    }
    if (event.key !== ANNOUNCEMENT_RETRY_BROADCAST_KEY || !event.newValue) {
        return;
    }
    try {
        handleAnnouncementRetryRequest(JSON.parse(event.newValue));
    } catch (e) {
        // ignore
    }
});

function processAnnouncementPlaybackQueue() {
    if (announcementPlaybackActive) {
        return;
    }
    const nextBatch = announcementPlaybackQueue.shift();
    if (!nextBatch) {
        return;
    }
    announcementPlaybackActive = true;
    getAnnouncementVoices().then((voices) => {
        const voice = findAnnouncementVoice(voices);
        announcementDebugLog('[bts] announcement batch start', {
            claimKey: nextBatch.claimKey || null,
            parts: (nextBatch.callArray || []).filter(Boolean),
        });
        playAnnouncementBatch(nextBatch.callArray, voice, (status) => {
            announcementDebugLog('[bts] announcement batch end', {
                claimKey: nextBatch.claimKey || null,
            });
            if (status === 'ok' || status === 'active') {
                setAnnouncementSpeechCheckState('active', ci18n('announcements:speechcheck:ok'));
            } else if (status === 'suspicious') {
                setAnnouncementSpeechCheckState('suspicious', ci18n('announcements:speechcheck:suspicious'));
            } else if (status === 'error') {
                setAnnouncementSpeechCheckState('error', ci18n('announcements:speechcheck:error'));
            }
            if ((status === 'suspicious' || status === 'error') && nextBatch.allowRetry !== false) {
                releaseAnnouncementPlaybackClaim(nextBatch.callArray, nextBatch.claimKey);
                releaseAnnouncementLeaderForFailover();
                requestAnnouncementRetry(nextBatch);
            }
            const pauseMs = curt.announcement_pause_time_ms ? (curt.announcement_pause_time_ms * 1000) : 2000;
            setTimeout(() => {
                announcementPlaybackActive = false;
                processAnnouncementPlaybackQueue();
            }, pauseMs);
        }, nextBatch.claimKey);
    }).catch(() => {
        announcementDebugLog('[bts] announcement batch end', {
            claimKey: nextBatch.claimKey || null,
            error: true,
        });
        announcementPlaybackActive = false;
        processAnnouncementPlaybackQueue();
    });
}

function announce(callArray, local, claimKey, options) {
    const enqueue = (enqueueOptions) => {
        const resolvedOptions = enqueueOptions || {};
        announcementPlaybackQueue.push({
            callArray,
            claimKey,
            retryCount: resolvedOptions.retryCount || 0,
            allowRetry: resolvedOptions.allowRetry !== false,
        });
        if (!local) {
            announcementDebugLog(`[bts] announcement played ${claimKey}`);
        }
        processAnnouncementPlaybackQueue();
    };

    if (local) {
        enqueue({});
        return;
    }

    Promise.resolve(ensureAnnouncementLeaderLock()).then((isLeader) => {
        if (!isLeader) {
            announcementDebugLog(`[bts] announcement skipped ${claimKey}`);
            return;
        }
        return Promise.resolve(claimAnnouncementPlayback(callArray, claimKey)).then((claimed) => {
            if (!claimed) {
                announcementDebugLog(`[bts] announcement skipped ${claimKey}`);
                return;
            }
            enqueue(options || {});
        });
    }).catch(() => {
        announcementDebugLog(`[bts] announcement skipped ${claimKey}`);
    });
}
