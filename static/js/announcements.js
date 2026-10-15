/* global createAnnouncementTexts, btsSpeechService */
function announcementTexts() {
    return createAnnouncementTexts({
        tournament: curt, translate: ci18n, announce, window,
        claim: buildAnnouncementClaimKey,
    });
}

function getLocationID(...args) { return announcementTexts().getLocationID(...args); }
function announceNewMatch(...args) { return announcementTexts().announceNewMatch(...args); }
function announcePreparationMatch(...args) { return announcementTexts().announcePreparationMatch(...args); }
function announceNoMatchWin(...args) { return announcementTexts().announceNoMatchWin(...args); }
function announceSecondCallTeamOne(...args) { return announcementTexts().announceSecondCallTeamOne(...args); }
function announceSecondCallTeamTwo(...args) { return announcementTexts().announceSecondCallTeamTwo(...args); }
function announceSecondPreparationCallTeamOne(...args) { return announcementTexts().announceSecondPreparationCallTeamOne(...args); }
function announceSecondPreparationCallTeamTwo(...args) { return announcementTexts().announceSecondPreparationCallTeamTwo(...args); }
function announceSecondCallTabletoperator(...args) { return announcementTexts().announceSecondCallTabletoperator(...args); }
function announceSecondCallUmpire(...args) { return announcementTexts().announceSecondCallUmpire(...args); }
function announceSecondCallServiceJudge(...args) { return announcementTexts().announceSecondCallServiceJudge(...args); }
function announceSecondCall(...args) { return announcementTexts().announceSecondCall(...args); }
function announceSecondPreparationCallTabletoperator(...args) { return announcementTexts().announceSecondPreparationCallTabletoperator(...args); }
function announceSecondPreparationCallUmpire(...args) { return announcementTexts().announceSecondPreparationCallUmpire(...args); }
function announceSecondPreparationCallServiceJudge(...args) { return announcementTexts().announceSecondPreparationCallServiceJudge(...args); }
function announceSecondPreparationCall(...args) { return announcementTexts().announceSecondPreparationCall(...args); }
function announceBeginnToPlay(...args) { return announcementTexts().announceBeginnToPlay(...args); }
function createSecondCallAnnouncement(...args) { return announcementTexts().createSecondCallAnnouncement(...args); }
function createSecondPreparationCallAnnouncement(...args) { return announcementTexts().createSecondPreparationCallAnnouncement(...args); }
function createTeamAnnouncement(...args) { return announcementTexts().createTeamAnnouncement(...args); }
function createTabletOperator(...args) { return announcementTexts().createTabletOperator(...args); }
function createUmpire(...args) { return announcementTexts().createUmpire(...args); }
function createServiceJudge(...args) { return announcementTexts().createServiceJudge(...args); }
function createSingleTeam(...args) { return announcementTexts().createSingleTeam(...args); }
function normalizeNames(...args) { return announcementTexts().normalizeNames(...args); }
function createRoundAnnouncement(...args) { return announcementTexts().createRoundAnnouncement(...args); }
function eventAnnouncementNameByCode(...args) { return announcementTexts().eventAnnouncementNameByCode(...args); }
function createEventAnnouncement(...args) { return announcementTexts().createEventAnnouncement(...args); }
function createMatchNumberAnnouncement(...args) { return announcementTexts().createMatchNumberAnnouncement(...args); }
function createFieldAnnouncement(...args) { return announcementTexts().createFieldAnnouncement(...args); }
function createFieldPreparationAnnouncement(...args) { return announcementTexts().createFieldPreparationAnnouncement(...args); }
function resolveSingularPluralAnnouncement(...args) { return announcementTexts().resolveSingularPluralAnnouncement(...args); }
function createPreparationAnnouncement(...args) { return announcementTexts().createPreparationAnnouncement(...args); }
function createMeetingPointAnnouncement(...args) { return announcementTexts().createMeetingPointAnnouncement(...args); }

// Keep the existing public browser entry points for other BTS modules.
Object.assign(window, {
    getLocationID,
    announceNewMatch,
    announcePreparationMatch,
    announceNoMatchWin,
    announceSecondCallTeamOne,
    announceSecondCallTeamTwo,
    announceSecondPreparationCallTeamOne,
    announceSecondPreparationCallTeamTwo,
    announceSecondCallTabletoperator,
    announceSecondCallUmpire,
    announceSecondCallServiceJudge,
    announceSecondCall,
    announceSecondPreparationCallTabletoperator,
    announceSecondPreparationCallUmpire,
    announceSecondPreparationCallServiceJudge,
    announceSecondPreparationCall,
    announceBeginnToPlay,
    createSecondCallAnnouncement,
    createSecondPreparationCallAnnouncement,
    createTeamAnnouncement,
    createTabletOperator,
    createUmpire,
    createServiceJudge,
    createSingleTeam,
    normalizeNames,
    createRoundAnnouncement,
    eventAnnouncementNameByCode,
    createEventAnnouncement,
    createMatchNumberAnnouncement,
    createFieldAnnouncement,
    createFieldPreparationAnnouncement,
    resolveSingularPluralAnnouncement,
    createPreparationAnnouncement,
    createMeetingPointAnnouncement,
});

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
let announcementPlaybackGeneration = 0;
let announcementPlaybackSequence = 0;
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

function runBrowserAnnouncementSpeechCheck() {
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

function playAnnouncementBatch(parts, voice, done, claimKey, signal) {
    const filteredParts = (parts || []).filter((part) => !!part);
    let index = 0;
    let batchStarted = false;
    let batchStatus = 'ok';
    let finished = false;
    const finish = (status) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', cancel);
        done(status, { started: batchStarted });
    };
    const cancel = () => finish('cancelled');
    signal?.addEventListener('abort', cancel, { once: true });
    const playNext = () => {
        if (finished) return;
        if (signal?.aborted) { finish('cancelled'); return; }
        if (index >= filteredParts.length) {
            finish(batchStarted ? batchStatus : 'suspicious');
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
        localParts: batch.localParts,
        localPauses: batch.localPauses,
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
        localParts: request.localParts,
        localPauses: request.localPauses,
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

function browserAnnouncementBatch(parts, signal, claimKey) {
    return getAnnouncementVoices().then((voices) => new Promise((resolve) => {
        playAnnouncementBatch(parts, findAnnouncementVoice(voices),
            (status, metadata) => resolve({ status, ...metadata }), claimKey, signal);
    }));
}

function cancelAnnouncementPlayback() {
    announcementPlaybackGeneration += 1;
    announcementPlaybackQueue.length = 0;
    announcementPlaybackActive = false;
    btsSpeechService.cancel();
}

function runAnnouncementSpeechCheck() {
    cancelAnnouncementPlayback();
    if (btsSpeechService.settings().mode === 'browser') return runBrowserAnnouncementSpeechCheck();
    return btsSpeechService.unlock().then(() => btsSpeechService.speak(
        [ci18n('announcements:speechcheck:text')], btsSpeechService.testId(),
        (parts, signal) => browserAnnouncementBatch(parts, signal, null)
    )).then((result) => setAnnouncementSpeechCheckState(
        result.status === 'ok' ? 'active' : 'error',
        result.status === 'ok'
            ? btsSpeechService.describeResult(result)
            : btsSpeechService.describeResult(result) + ' Audio aktivieren und erneut testen.'
    )).catch(() => setAnnouncementSpeechCheckState('error', ci18n('announcements:speechcheck:error')));
}

function processAnnouncementPlaybackQueue() {
    if (announcementPlaybackActive) return;
    const nextBatch = announcementPlaybackQueue.shift();
    if (!nextBatch) return;
    announcementPlaybackActive = true;
    const generation = announcementPlaybackGeneration;
    const finish = (result) => {
        if (generation !== announcementPlaybackGeneration) return;
        if (result.status === 'ok') {
            setAnnouncementSpeechCheckState('active', btsSpeechService.describeResult(result));
        } else if (result.status === 'suspicious') {
            setAnnouncementSpeechCheckState('suspicious', ci18n('announcements:speechcheck:suspicious'));
        } else if (['error', 'unavailable'].includes(result.status)) {
            setAnnouncementSpeechCheckState('error', btsSpeechService.describeResult(result));
        }
        if (result.allowRetry && nextBatch.allowRetry !== false) {
            releaseAnnouncementPlaybackClaim(nextBatch.callArray, nextBatch.claimKey);
            releaseAnnouncementLeaderForFailover();
            requestAnnouncementRetry(nextBatch);
        }
        const pauseMs = curt.announcement_pause_time_ms ? (curt.announcement_pause_time_ms * 1000) : 2000;
        setTimeout(() => {
            if (generation !== announcementPlaybackGeneration) return;
            announcementPlaybackActive = false;
            processAnnouncementPlaybackQueue();
        }, pauseMs);
    };
    btsSpeechService.speak(nextBatch.callArray, nextBatch.playbackId,
        (parts, signal) => browserAnnouncementBatch(parts, signal, nextBatch.claimKey), nextBatch.localParts, nextBatch.localPauses)
        .then(finish, () => finish({ status: 'error', started: false, allowRetry: false }));
}

function announce(callArray, local, claimKey, options) {
    const enqueue = (enqueueOptions) => {
        const resolvedOptions = enqueueOptions || {};
        announcementPlaybackQueue.push({
            callArray,
            localParts: resolvedOptions.localParts,
            localPauses: resolvedOptions.localPauses,
            claimKey,
            playbackId: claimKey || ANNOUNCEMENT_TAB_ID + ":" + (++announcementPlaybackSequence),
            retryCount: resolvedOptions.retryCount || 0,
            allowRetry: resolvedOptions.allowRetry !== false,
        });
        if (!local) {
            announcementDebugLog(`[bts] announcement played ${claimKey}`);
        }
        processAnnouncementPlaybackQueue();
    };

    if (local) {
        enqueue(options);
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
