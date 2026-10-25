'use strict';

// B11 hearing plan only. Browser builders define the words; existing v2 audio supplies names and roles.
const fs = require('fs');
const create = require('../static/js/announcement_text');
const { _translate: translate } = require('../static/js/ci18n');
const { spellNumbers } = require('../bts/speech/numbers');
const { Plan, digest } = require('./tts-context-benchmark-plan');

const lexemes = text => spellNumbers(text).toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ') || '';

function secondCalls(existing, tournament) {
    if (existing.strategy !== 'bts-context-v2-lab-only') throw new Error('A v2 audio catalogue is required');
    const plan = new Plan(existing.pronunciation.normalizations || []);
    if (digest(plan.export().pronunciation) !== digest(existing.pronunciation)) throw new Error('Pronunciation identities must match');
    const newPieces = new Set(), used = new Set(), contexts = [], locations = [];
    const importPiece = part => {
        const source = part && existing.sources.find(s => s.id === part.source);
        if (!source || part.before + part.text + part.after !== source.text) throw new Error('Missing complete cached piece');
        plan.pieces.set(part.id, { ...part }); plan.sources.set(source.id, { ...source }); used.add(part.id);
        return part.id;
    };
    const find = (profile, predicate = () => true) => importPiece(existing.pieces.find(p => p.profile === profile && predicate(p)));
    const contextPiece = (full, text, profile, last = false) => {
        const source = plan.source(full, 'lab-v2/second-call-context');
        const start = last ? full.lastIndexOf(text) : full.indexOf(text);
        if (!text || start < 0) throw new Error('Exact context fragment is required');
        const value = { source, before: full.slice(0, start), text, after: full.slice(start + text.length),
            kind: full === text ? 'game' : 'generic', profile, display: text };
        const id = 'p-' + digest(value).slice(0, 20);
        plan.pieces.set(id, { id, ...value }); newPieces.add(id);
        return id;
    };
    const reference = full => {
        const id = contextPiece(full, full, 'lab-v2/second-call-full-reference');
        if (!contexts.includes(id)) contexts.push(id);
    };
    const text = id => plan.pieces.get(id).text;
    const names = existing.pieces.filter(p => p.profile === 'lab-v2/team-after-gegen');
    const singlePart = names.find(p => p.text === 'Hans Dampf') || names.find(p => !p.text.includes(' und '));
    const doublePart = names.find(p => p.text.includes(' und '));
    const single = importPiece(singlePart), double = importPiece(doublePart);
    const umpire = names.find(p => p.text === 'Max Mustermann') ? importPiece(names.find(p => p.text === 'Max Mustermann')) : single;
    const roles = { umpire: find('lab-v2/B08-role-umpire'), service: find('lab-v2/B08-role-service'),
        tablet: find('lab-v2/B08-role'), board: find('lab-v2/B08-role-board') };
    const fieldStart = find('lab-v2/field_start'), fieldEnd = find('lab-v2/field_end');
    const courtMatch = text(fieldStart).match(/^Auf Spielfeld (.+)!$/);
    if (!courtMatch || text(fieldEnd) !== text(fieldStart)) throw new Error('Matching field positions are required');
    const displayField = existing.pieces.find(p => p.id === fieldStart).display;
    const fieldNumber = displayField?.match(/\d+/)?.[0];
    if (!fieldNumber) throw new Error('The saved field needs its display number');
    let browser;
    const texts = create({ tournament: { ...tournament, normalizations: plan.normalizations },
        translate: (key, data, fallback) => translate('de', key, data, fallback),
        window: { localStorage: { getItem: () => 'true' } }, claim: () => null,
        announce: parts => { browser = parts; } });
    const normalText = texts.createSecondCallAnnouncement(), preparationText = texts.createSecondPreparationCallAnnouncement();
    const cachedNormal = existing.pieces.find(p => p.profile === 'lab-v2/B11-normal' && p.text === normalText);
    let normal;
    if (cachedNormal) {
        normal = importPiece(cachedNormal);
        const whole = existing.pieces.find(p => p.source === cachedNormal.source && !p.before && !p.after);
        if (whole) contexts.push(importPiece(whole));
    } else {
        const full = normalText + text(single) + '. ' + text(fieldStart);
        normal = contextPiece(full, normalText, 'lab-v2/B11-normal'); reference(full);
    }
    // Keep the real members of doubles together in audio, but pass their separate names to the browser builder.
    const people = key => (plan.pieces.get(key).display || text(key)).split(' und ').map(name => ({ name }));
    const add = (id, group, label, method, setup, keys, pauses, location = null) => {
        browser = null; texts[method](setup);
        if (!browser) throw new Error('Browser announcement must exist');
        const spoken = keys.map(text).join(' ');
        if (lexemes(spoken) !== lexemes(browser.join(' '))) throw new Error('Assembly words differ from browser: ' + id);
        plan.cases.push({ id, experiment: group, label, display: browser.join(' '), browser_texts: browser,
            location_id: location, pieces: keys.map((piece, i) => ({ piece, pause_ms: i + 1 === keys.length ? 0 : pauses[i] })),
            subjective_quality: 'not-rated' });
    };
    for (const [form, key] of [['single', single], ['double', double]]) {
        add('D04-' + form, 'D04', 'Team auf das Feld · ' + text(key), 'announceSecondCallTeamOne',
            { court_id: 'default_' + fieldNumber, teams: [{ players: people(key) }] }, [normal, key, fieldEnd], [140, 250]);
    }
    for (const [role, name] of [['umpire', umpire], ['service', single], ['tablet', single], ['tablet', double], ['board', single], ['board', double]]) {
        const form = name === double ? 'double' : 'single', group = role === 'umpire' ? 'D06' : role === 'service' ? 'D07' : 'D08';
        const setup = { court_id: 'default_' + fieldNumber, umpire: { name: text(name) }, service_judge: { name: text(name) }, tabletoperators: people(name) };
        const roleTexts = create({ tournament: { ...tournament, tabletoperator_use_manual_counting_boards_enabled: role === 'board', normalizations: plan.normalizations },
            translate: (key, data, fallback) => translate('de', key, data, fallback), window: { localStorage: { getItem: () => 'true' } },
            announce: parts => { browser = parts; } });
        const method = role === 'umpire' ? 'announceSecondCallUmpire' : role === 'service' ? 'announceSecondCallServiceJudge' : 'announceSecondCallTabletoperator';
        // The role switch belongs to the browser fixture, not to a new audio source.
        texts[method] = roleTexts[method];
        add(`${group}-${role}-${form}`, group, text(roles[role]) + ' · ' + text(name), method, setup,
            [fieldStart, normal, roles[role], name], [250, 140, role === 'board' ? 180 : 80]);
        if (name === (role === 'umpire' ? umpire : single)) add(`${group}-${role}-without-field`, group,
            text(roles[role]) + ' · ohne Feld', method, { ...setup, court_id: null }, [normal, roles[role], name], [140, role === 'board' ? 180 : 80]);
    }
    // One real location context supplies a shared preparation prefix and the whole D11 request.
    let prepPrefix;
    const locationList = tournament.locations?.length ? tournament.locations : [{ _id: null, name: 'Ohne Location' }];
    if (new Set(locationList.map(l => l._id)).size !== locationList.length) throw new Error('Unique location IDs are required');
    const requests = new Map();
    for (const location of locationList) {
        const loc = 'loc-' + digest(location._id).slice(0, 10), setup = { location_id: location._id };
        const info = { id: location._id, name: location.name || 'Ohne Location', addition: location.preparation_addition || '',
            meeting: location.meetingpoint_announcement || '', meeting_enabled: !!tournament.preparation_meetingpoint_enabled };
        locations.push(info);
        const suffixes = {};
        for (const [form, key] of [['single', single], ['double', double]]) {
            browser = null; texts.announceSecondPreparationCallTabletoperator({ ...setup, tabletoperators: people(key) });
            const nameDisplay = texts.createSingleTeam(people(key));
            const suffix = browser[1].slice(nameDisplay.length + 2);
            const full = spellNumbers(browser.join(' ') + (/[.!?]$/.test(browser.at(-1)) ? '' : '.'));
            if (!requests.has(suffix)) {
                if (!prepPrefix) prepPrefix = contextPiece(full, preparationText, 'lab-v2/B11-preparation');
                requests.set(suffix, contextPiece(full, spellNumbers(suffix), 'lab-v2/D11-request', true));
                reference(full);
            }
            suffixes[form] = requests.get(suffix);
            const additionDisplay = texts.resolveSingularPluralAnnouncement(location.preparation_addition, form === 'double');
            const meetingDisplay = tournament.preparation_meetingpoint_enabled ? texts.createMeetingPointAnnouncement(setup, form === 'double') : '';
            const d05 = [prepPrefix, key], gaps = [140];
            browser = null; texts.announceSecondPreparationCallTeamOne({ ...setup, teams: [{ players: people(key) }] });
            const d05Full = spellNumbers(browser.join(' '));
            if (additionDisplay.trim()) {
                d05.push(contextPiece(d05Full, spellNumbers(additionDisplay), 'lab-v2/second-call-hall')); gaps.push(120); reference(d05Full);
            }
            d05.push(key); gaps.push(320);
            if (meetingDisplay.trim()) {
                // Complete location sentences remain directly generated, just like browser TTS.
                const sentence = spellNumbers(meetingDisplay);
                d05.push(contextPiece(sentence, sentence, 'lab-v2/second-call-meeting')); gaps.push(160);
            }
            add(`D05-${loc}-${form}`, 'D05', info.name + ' · ' + text(key), 'announceSecondPreparationCallTeamOne',
                { ...setup, teams: [{ players: people(key) }] }, d05, gaps, location._id);
        }
        for (const [role, key] of [['umpire', umpire], ['service', single], ['tablet', single], ['tablet', double], ['board', single], ['board', double]]) {
            const group = role === 'umpire' ? 'D09' : role === 'service' ? 'D10' : 'D11', form = key === double ? 'double' : 'single';
            const method = role === 'umpire' ? 'announceSecondPreparationCallUmpire' : role === 'service' ? 'announceSecondPreparationCallServiceJudge' : 'announceSecondPreparationCallTabletoperator';
            const roleTexts = create({ tournament: { ...tournament, tabletoperator_use_manual_counting_boards_enabled: role === 'board', normalizations: plan.normalizations },
                translate: (k, data, fallback) => translate('de', k, data, fallback), window: { localStorage: { getItem: () => 'true' } },
                announce: parts => { browser = parts; } });
            texts[method] = roleTexts[method];
            let ending;
            if (group === 'D11') ending = suffixes[form];
            else if (tournament.preparation_meetingpoint_enabled) {
                const sentence = spellNumbers(texts.createMeetingPointAnnouncement(setup, false));
                if (sentence.trim()) ending = contextPiece(sentence, sentence, 'lab-v2/second-call-meeting');
            } else ending = find('lab-v2/B09-opening', p => p.text === 'In Vorbereitung!');
            const keys = [prepPrefix, roles[role], key, key, ...(ending ? [ending] : [])];
            add(`${group}-${loc}-${role}-${form}`, group, info.name + ' · ' + text(roles[role]) + ' · ' + text(key), method,
                { ...setup, umpire: { name: text(key) }, service_judge: { name: text(key) }, tabletoperators: people(key) },
                keys, [140, role === 'board' ? 180 : 80, 320, group === 'D11' ? 160 : 120], location._id);
        }
    }
    for (const key of new Set([normal, prepPrefix, ...newPieces].filter(k => !contexts.includes(k)))) {
        plan.cases.push({ id: 'piece-' + key, experiment: 'piece', label: 'Einzelbaustein · ' + text(key), display: text(key),
            pieces: [{ piece: key, pause_ms: 0 }], subjective_quality: 'not-rated' });
    }
    for (const key of contexts) plan.cases.push({ id: 'context-' + key, experiment: 'reference', label: 'Vollständiger Generierungskontext',
        display: text(key), pieces: [{ piece: key, pause_ms: 0 }], subjective_quality: 'not-rated' });
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only'; result.pause_quality_voices = ['hallensprecher', 'hallensprecherin'];
    result.scope = { purpose: 'B11/D04-D11 hearing trial; production unchanged', locations, browser_texts_unchanged: true,
        new_pieces: [...newPieces], reused_piece_origins: Object.fromEntries([...used].map(k => [k, existing.origins?.[k]])),
        normal_prefix: normal, preparation_prefix: prepPrefix, existing_names_roles_fields_unchanged: true,
        no_new_name_sources: true, meeting_enabled: !!tournament.preparation_meetingpoint_enabled };
    return result;
}

if (require.main === module) process.stdout.write(JSON.stringify(secondCalls(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')),
    JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))), null, 2) + '\n');
module.exports = { secondCalls, lexemes };
