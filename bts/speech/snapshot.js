'use strict';

// Background speech consumes committed revisions, never ordered database reads
// or tournament locks. It may lag a change; notifications invalidate its plan.
const COLLECTIONS = ['tournaments', 'locations', 'courts', 'matches', 'normalizations', 'tabletoperators', 'umpires'];
const FIELDS = ['_id', 'key', 'name', 'language', 'events', 'annoncement_include_event', 'annoncement_include_round',
    'annoncement_include_matchnumber', 'preparation_meetingpoint_enabled', 'tabletoperator_enabled',
    'tabletoperator_split_doubles', 'tabletoperator_with_state_enabled', 'tabletoperator_with_state_from_match_enabled',
    'tabletoperator_use_manual_counting_boards_enabled', 'registration_open_events', 'registration_completed_events',
    'registration_player_statuses', 'announcement_speech_mode', 'announcement_speech_voice', 'announcement_speech_warm_other_voice'];
const WINDOW_FIELDS = ['preparation_call_time_limit_before_scheduled_enabled', 'preparation_call_time_limit_before_scheduled_minutes',
    'preparation_call_block_ahead_limit_enabled', 'preparation_call_block_ahead_limit',
    'preparation_call_time_ahead_of_frontier_enabled', 'preparation_call_time_ahead_of_frontier_minutes',
    'preparation_call_matches_ahead_of_frontier_enabled', 'preparation_call_matches_ahead_of_frontier_limit',
    'preparation_call_no_player_waiting_as_tabletoperator_enabled', 'preparation_call_no_player_active_as_tabletoperator_enabled',
    'preparation_call_player_pause_expired_enabled', 'preparation_call_participant_readiness_mode',
    'preparation_call_technical_officials_available_enabled', 'official_rotation_mode', 'technical_official_auto_assignment_mode'];
const pick = (value, fields) => Object.fromEntries(fields.filter(field => value[field] !== undefined).map(field => [field, value[field]]));
const settings = tournament => pick(tournament, ['key', 'announcement_speech_mode', 'announcement_speech_voice', 'announcement_speech_warm_other_voice']);
const match = value => pick(value, ['_id', 'tournament_key', 'setup', 'team1_won', 'score_status',
    'match_order', 'btp_match_ids', 'no_match_losing_team']);

function revisions(app, key) {
    // Collect revision references in one turn. NeDB replaces committed
    // documents; subsequent cooperative delivery cannot mutate this snapshot.
    const tournament = app.db.model?.tournament(key);
    return COLLECTIONS.map(collection => {
        const store = app.db[collection];
        const documents = collection !== 'normalizations' && tournament ?
            [...tournament.collection(collection).values()].filter(entity => entity.present).map(entity => entity.data) :
            store.getAllData().filter(document => collection === 'normalizations' || document[collection === 'tournaments' ? 'key' : 'tournament_key'] === key);
        return collection === 'tournaments' ? documents.slice(0, 1) : documents;
    });
}

const project = (document, collection) => collection === 0 ? { ...pick(document, [...FIELDS, ...WINDOW_FIELDS]),
    ...(document.btp_settings ? { btp_settings: pick(document.btp_settings, ['pause_duration_ms']) } : {}) } : collection === 3 ? match(document) : document;
function capture(app, key) { return revisions(app, key).map((documents, collection) => documents.map(document => project(document, collection))); }

async function deliver(app, key, send, state = {}) {
    await require('../foreground_work').idle();
    const traces = require('../performance/traces'), collect = traces.begin('speech_snapshot_collect', 'phase');
    let snapshot;
    try { snapshot = revisions(app, key); traces.end(collect, null, { copied_records: snapshot.reduce((n, rows) => n + rows.length, 0) }); }
    catch (error) { traces.end(collect, error); throw error; }
    const next = [];
    const chunk = async value => {
        await new Promise(resolve => setImmediate(resolve));
        await require('../foreground_work').idle();
        return send(value) !== false;
    };
    for (let collection = 0; collection < snapshot.length; collection++) {
        const documents = snapshot[collection];
        const previous = state.collections?.[collection] || new Map();
        // Weak references detect unchanged revisions without retaining old
        // complete match documents (including their large score histories).
        const current = new Map(documents.map(document => [document._id, new WeakRef(document)]));
        next.push(current);
        const removed = [...previous.keys()].filter(id => !current.has(id));
        for (let offset = 0; offset < removed.length; offset += 16) {
            if (!await chunk({ collection, documents: [], removed: removed.slice(offset, offset + 16) })) return;
        }
        const changed = documents.filter(document => previous.get(document._id)?.deref() !== document);
        for (let offset = 0; offset < changed.length; offset += 16) {
            if (!await chunk({ collection, documents: changed.slice(offset, offset + 16).map(document => project(document, collection)) })) return;
        }
    }
    if (send({ done: true, ...(app.clock ? { now_ts: app.clock.now_ms() } : {}) }) !== false) state.collections = next;
}

module.exports = { capture, deliver, settings, match, COLLECTIONS };
