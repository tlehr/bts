'use strict';

// Experimental plans only. No browser/API strategy imports this file.
const fs = require('fs');
const crypto = require('crypto');
const create = require('../static/js/announcement_text');
const contextPlan = require('../static/js/speech_context');
const context = require('../bts/speech/context');
const { _translate: translate } = require('../static/js/ci18n');
const { spellNumbers } = require('../bts/speech/numbers');
const { Plan, digest } = require('./tts-context-benchmark-plan');

function textsFor(tournament) {
    return create({ tournament, translate: (key, data, fallback) => translate('de', key, data, fallback),
        window: { localStorage: { getItem: () => 'true' } }, claim: () => null, announce: () => {} });
}

function cut(plan, source, text, profile, { last = false, kind = 'team', offset = null } = {}) {
    const full = plan.sources.get(source).text;
    const start = offset ?? (last ? full.lastIndexOf(text) : full.indexOf(text));
    if (start < 0 || full.slice(start, start + text.length) !== text) throw new Error('Missing exact experimental substring');
    const item = { source, before: full.slice(0, start), text, after: full.slice(start + text.length), kind, profile, display: text };
    const id = 'p-' + digest(item).slice(0, 20);
    plan.pieces.set(id, { id, ...item });
    return id;
}

function dual(plan, text, display, group, id) {
    const source = plan.source(`${text} gegen ${text}.`, 'lab-v2/' + group + '-dual-position', `${display} gegen ${display}.`);
    return { source,
        full: cut(plan, source, plan.sources.get(source).text, 'lab-v2/' + group + '-whole', { kind: 'game' }),
        first: cut(plan, source, text, 'lab-v2/' + group + '-before-gegen'),
        against: cut(plan, source, 'gegen', 'lab-v2/' + group + '-connector', { kind: 'generic' }),
        second: cut(plan, source, text, 'lab-v2/' + group + '-after-gegen', { last: true }),
        first_with_against: cut(plan, source, text + ' gegen', 'lab-v2/' + group + '-before-with-gegen'),
        id, text, display };
}

function game(texts, tournament, setup) {
    return context.decode(contextPlan(texts, tournament, 'prepareGame', setup).parts[0], 1200).text;
}

function inventory(tournament) {
    const texts = textsFor(tournament), v1 = new Set(), heads = new Set(), teams = new Set();
    let known = 0, unknown = 0;
    for (const match of tournament.matches || []) {
        const setup = match.setup;
        if (!setup || setup.is_match === false) continue;
        if (setup.teams?.length < 2 || !setup.teams?.slice(0, 2).every(team => team.players?.length && team.players.every(player => player.name?.trim()))) {
            unknown++; continue;
        }
        try {
            const block = game(texts, tournament, setup);
            v1.add(spellNumbers(block)); known++;
            const reference = { ...setup, teams: [{ players: [{ name: 'Max Mustermann' }] }, { players: [{ name: 'Hans Dampf' }] }] };
            heads.add(spellNumbers(game(texts, tournament, reference)));
            for (const team of setup.teams.slice(0, 2)) {
                const value = texts.createSingleTeam(team.players);
                teams.add(spellNumbers(`${value} gegen ${value}.`));
            }
        } catch (_) { unknown++; }
    }
    const sum = values => [...values].reduce((count, value) => count + [...value].length, 0);
    return { scenario: 'Actual saved tournament, known games; hypothetical v2 header-source plus dual-team-source policy.',
        known_games: known, unknown_or_unusable_games: unknown, unique_v1_sources: v1.size,
        unique_v2_header_sources: heads.size, unique_v2_team_sources: teams.size,
        hypothetical_v2_sources: heads.size + teams.size, v1_input_characters: sum(v1),
        hypothetical_v2_input_characters: sum(heads) + sum(teams),
        warm_unchanged_new_sources: { v1: 0, v2: 0 },
        cold_inference_seconds: null, ready_after_seconds: null,
        warning: 'Counts and literal text lengths only. No measured full-tournament runtime or quality claim. Unknown teams are not invented.',
        source_texts: { v1: [...v1], v2_headers: [...heads], v2_dual_teams: [...teams] } };
}

function experiments(tournament, baseline) {
    const normalizations = tournament.normalizations || [];
    const plan = new Plan(normalizations);
    for (const source of baseline.sources) plan.sources.set(source.id, source);
    for (const piece of baseline.pieces) plan.pieces.set(piece.id, piece);
    const texts = textsFor(tournament);
    const add = (id, label, ids, experiment, variant, pauses = []) => plan.cases.push({ id, label, experiment, variant,
        display: ids.map(key => plan.pieces.get(key).text).join(' '),
        pieces: ids.map((piece, index) => ({ piece, pause_ms: index === ids.length - 1 ? 0 : pauses[index] ?? 60 })),
        subjective_quality: 'not-rated' });

    // A: clearly fictional example names; existing pronunciation rules still apply.
    const names = [
        ['long', 'Max Emil Mustermann'], ['short', 'Erika Musterfrau'], ['difficult', 'Max Mustermann'],
    ].map(([id, name]) => dual(plan, texts.normalizeNames(name), name, 'name', id));
    for (const value of names) {
        add('A-' + value.id + '-dual', value.display + ' · zweimal im Kontext', [value.full], 'A', 'context-reference');
        for (const [slot, label] of [['first', 'vor gegen'], ['against', 'gegen'], ['second', 'nach gegen']]) {
            add('A-' + value.id + '-' + slot, value.display + ' · ' + label, [value[slot]], 'A', 'position-excerpt');
        }
        value.isolated = plan.whole(value.text + '.', 'lab-v2/isolated-name');
        add('A-' + value.id + '-isolated', value.display + ' · isoliert erzeugt', [value.isolated], 'A', 'isolated-reference');
    }
    for (let index = 0; index < names.length; index++) {
        const left = names[index], right = names[(index + 1) % names.length];
        const id = 'A-mix-' + index;
        add(id + '-three', 'Neue Begegnung · drei Kontextstücke', [left.first, left.against, right.second], 'A', 'three-piece');
        add(id + '-two', 'Neue Begegnung · Name und gegen zusammen', [left.first_with_against, right.second], 'A', 'two-piece');
        add(id + '-isolated', 'Neue Begegnung · isolierte Namen', [left.isolated, left.against, right.isolated], 'A', 'isolated-assembly');
        const full = plan.whole(`${left.text} gegen ${right.text}.`, 'lab-v2/full-encounter-reference');
        add(id + '-full', 'Neue Begegnung · vollständig erzeugt', [full], 'A', 'full-reference');
        const reference_source = plan.pieces.get(full).source;
        add(id + '-full-first', 'Name vor gegen · aus vollständig erzeugter Begegnung',
            [cut(plan, reference_source, left.text, 'lab-v2/reference-before-gegen')], 'A', 'reference-excerpt');
        add(id + '-full-second', 'Name nach gegen · aus vollständig erzeugter Begegnung',
            [cut(plan, reference_source, right.text, 'lab-v2/reference-after-gegen', { last: true })], 'A', 'reference-excerpt');
    }

    // B: never invent partnerships or enumerate combinations. Use both teams
    // of one actual saved doubles game, preserving player order and "und".
    const doubles = (tournament.matches || []).find(match => match.setup?.is_match !== false &&
        match.setup?.teams?.length >= 2 && match.setup.teams.slice(0, 2).every(team =>
            team.players?.length === 2 && team.players.every(player => player.name?.trim())));
    if (doubles) {
        const teams = doubles.setup.teams.slice(0, 2).map((team, index) => {
            const value = texts.createSingleTeam(team.players);
            return dual(plan, value, team.players.map(player => player.name).join(' und '), 'team', String(index));
        });
        teams.forEach((value, index) => {
            add('B-team-' + index + '-dual', 'Reales Team · beide Positionen', [value.full], 'B', 'context-reference');
            add('B-team-' + index + '-first', 'Ganzes Team vor gegen', [value.first], 'B', 'position-excerpt');
            add('B-team-' + index + '-second', 'Ganzes Team nach gegen', [value.second], 'B', 'position-excerpt');
        });
        add('B-assembly-three', 'Tatsächliche Doppelbegegnung · drei Stücke', [teams[0].first, teams[0].against, teams[1].second], 'B', 'three-piece');
        add('B-assembly-two', 'Tatsächliche Doppelbegegnung · zwei Stücke', [teams[0].first_with_against, teams[1].second], 'B', 'two-piece');
        add('B-full', 'Tatsächliche Doppelbegegnung · vollständig',
            [plan.whole(`${teams[0].text} gegen ${teams[1].text}.`, 'lab-v2/full-doubles-reference')], 'B', 'full-reference');
    }

    // C: first reuse the already measured v1 game source, then one actual
    // singles game of another discipline with the same round if available.
    const game_piece = baseline.pieces.find(piece => piece.profile === 'bts-context-v1/game');
    const donors = [{ source: game_piece.source, piece: game_piece.id, label: 'bekannte Beispielquelle', real_match: null }];
    const actual = (tournament.matches || []).find(match => match.setup?.is_match !== false && match.setup?.match_name === 'R16' &&
        !String(match.setup.event_name).startsWith('ME') && match.setup.teams?.length >= 2 &&
        match.setup.teams.slice(0, 2).every(team => team.players?.length === 1 && team.players.every(player => player.name?.trim())));
    if (actual) {
        const piece = plan.piece({ before: '', text: game(texts, tournament, actual.setup), after: '', kind: 'game' });
        donors.push({ source: plan.pieces.get(piece).source, piece, label: 'reales Spiel', real_match: actual._id });
    }
    let round;
    for (const [index, donor] of donors.entries()) {
        const full = plan.sources.get(donor.source).text;
        const punctuation = [...full.matchAll(/[.!]/g)].slice(0, 3).map(match => match.index + 1);
        if (punctuation.length !== 3) throw new Error('Fixture game header has no three known boundaries');
        const [a, b, c] = punctuation;
        const number = cut(plan, donor.source, full.slice(0, a), 'lab-v2/B03', { kind: 'generic' });
        const event = cut(plan, donor.source, full.slice(a, b).trim(), 'lab-v2/B04', { kind: 'generic' });
        const own_round = cut(plan, donor.source, full.slice(b, c).trim(), 'lab-v2/B05', { kind: 'generic' });
        const bundle = cut(plan, donor.source, full.slice(a, c).trim(), 'lab-v2/B04+B05', { kind: 'generic' });
        const encounter = cut(plan, donor.source, full.slice(c).trim(), 'lab-v2/encounter', { kind: 'generic' });
        const connector = full.indexOf(' gegen ', c);
        if (connector < 0) throw new Error('No exact encounter connector');
        const first_team = full.slice(c, connector).trim();
        const second_team = full.slice(connector + 7).replace(/\.$/, '').trim();
        const first = cut(plan, donor.source, first_team, 'lab-v2/C-team-before-gegen', { offset: full.indexOf(first_team, c) });
        const against = cut(plan, donor.source, 'gegen', 'lab-v2/C-connector', { kind: 'generic', offset: connector + 1 });
        const second = cut(plan, donor.source, second_team, 'lab-v2/C-team-after-gegen', { last: true });
        add('C-' + index + '-v1', 'Spielblock · vollständige v1-Referenz', [donor.piece], 'C', 'full-reference');
        add('C-' + index + '-split', 'B03, B04, B05 und Begegnung getrennt', [number, event, own_round, encounter], 'C', 'split-header', [250, 250, 250]);
        add('C-' + index + '-bundle', 'B03 und B04+B05 gebündelt', [number, bundle, encounter], 'C', 'bundled-header', [250, 250]);
        add('C-' + index + '-teams', 'B03, B04+B05 und vorhandene einzelne Teampositionen',
            [number, bundle, first, against, second], 'C', 'bundled-header-split-teams', [250, 250, 60, 60]);
        if (round && plan.pieces.get(round).text === plan.pieces.get(own_round).text) {
            add('C-' + index + '-reused-round', 'Runde aus anderem Spielkontext wiederverwendet', [number, event, round, encounter], 'C', 'reused-round', [250, 250, 250]);
        }
        round ||= own_round;
    }
    const result = plan.export();
    result.strategy = 'bts-context-v2-lab-only';
    result.generator_sha256 = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    result.scope = { A: 'three named examples, exact current pronunciation substitutions',
        B: doubles ? { real_match: doubles._id, no_individual_name_splits: true } : 'skipped: no actual doubles game',
        C: donors.map(value => ({ source: value.source, label: value.label, real_match: value.real_match })),
        D: 'read-only inventory and existing source/cut audit; no speculative synthesis' };
    result.inventory = inventory(tournament);
    return result;
}

function warmChange(existing) {
    const plan = new Plan(existing.pronunciation.normalizations);
    for (const item of existing.sources) plan.sources.set(item.id, item);
    for (const item of existing.pieces) plan.pieces.set(item.id, item);
    const find = id => existing.cases.find(item => item.id === id).pieces.map(row => row.piece);
    if (!existing.cases.some(item => item.id === 'C-1-bundle')) throw new Error('Warm comparison requires the recorded actual game-header donor');
    const [number, bundle] = find('C-1-bundle');
    const [first] = find('A-long-first'), [against] = find('A-long-against');
    const [last] = find('A-difficult-second'), [together] = find('A-mix-0-two');
    const add = (id, label, keys, pauses) => plan.cases.push({ id, label, experiment: 'warm-change',
        display: keys.map(key => plan.pieces.get(key).text).join(' '),
        pieces: keys.map((piece, index) => ({ piece, pause_ms: pauses[index] || 0 })), subjective_quality: 'not-rated' });
    add('warm-v2-three', 'Geänderte Teams · vorhandene Kontextpositionen', [number, bundle, first, against, last], [250, 250, 60, 60]);
    add('warm-v2-two', 'Geänderte Teams · Name mit gegen zusammen', [number, bundle, together, last], [250, 250, 60]);
    const text = [plan.pieces.get(number).text, plan.pieces.get(bundle).text,
        plan.pieces.get(first).text + ' gegen ' + plan.pieces.get(last).text + '.'].join(' ');
    add('warm-full-v1', 'Geänderte Teams · neuer vollständiger v1-Spielblock',
        [plan.whole(text, 'lab-v2/warm-game-full-v1-control')], [0]);
    return { ...plan.export(), strategy: 'bts-context-v2-lab-only',
        scenario: 'Representative change of teams in the recorded actual game header. Not a real tournament change.',
        expected_new_source_counts_when_primed: { v2_assembly: 0, full_v1_control: 1 } };
}

if (require.main === module) {
    const option = name => process.argv[process.argv.indexOf(name) + 1];
    if (process.argv.includes('--warm-change')) {
        process.stdout.write(JSON.stringify(warmChange(JSON.parse(fs.readFileSync(option('--warm-change')))), null, 2) + '\n');
        process.exit(0);
    }
    if (!process.argv.includes('--tournament') || !process.argv.includes('--baseline')) throw new Error('--tournament and --baseline are required');
    process.stdout.write(JSON.stringify(experiments(JSON.parse(fs.readFileSync(option('--tournament'))),
        JSON.parse(fs.readFileSync(option('--baseline')))), null, 2) + '\n');
}
module.exports = { experiments, inventory, warmChange };
