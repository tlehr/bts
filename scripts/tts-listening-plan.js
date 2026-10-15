'use strict';

const fs = require('fs');
const { spellNumbers } = require('../bts/speech/numbers');
const compactWav = require('../bts/speech/playback');

const source = 'Auf Spielfeld 8! Spiel 189.  Mädcheneinzel U19.  Achtelfinale! Nina Keo Boun Khoune gegen LeandraGalowicz. Auf Spielfeld 8!';
const phrases = ['Auf Spielfeld 8!', 'Spiel 189.', 'Mädcheneinzel U19.', 'Achtelfinale!',
    'Nina Keo Boun Khoune', 'gegen', 'LeandraGalowicz', 'Auf Spielfeld 8!'];
const gameBlock = source.slice(phrases[0].length + 1, -phrases[7].length - 1);

function plan() {
    const current = phrases.map(text => text.replace(/[.!?]+$/, ''));
    const punctuated = [...phrases];
    // One neutral continuation form per name, regardless of its later position.
    punctuated[4] += ',';
    punctuated[6] += ',';
    const grouped = [...phrases.slice(0, 4), phrases.slice(4, 7).join(' ') + '.', phrases[7]];
    const make = (id, label, texts, boundaries, preserve = []) => ({ id, label,
        parts: texts.map((text, i) => ({ text: spellNumbers(text), boundary: boundaries[i],
            preserve_inner_pauses: preserve.includes(i) })),
    });
    return { source, spoken: spellNumbers(source), cases: [
        make('01-am-stueck', 'Am Stück · Referenz', [source], ['none'], [0]),
        make('02-bisherige-bausteine', 'Bisherige Bausteine', current,
            ['sentence', 'sentence', 'sentence', 'sentence', 'join', 'join', 'sentence', 'none']),
        make('03-mit-satzzeichen', 'Bausteine mit Satzzeichen · Namen mit Komma', punctuated,
            ['sentence', 'sentence', 'sentence', 'sentence', 'join', 'join', 'sentence', 'none']),
        make('04-namen-zusammen', 'Satzzeichen · beide Namen mit „gegen“ zusammen', grouped,
            ['sentence', 'sentence', 'sentence', 'sentence', 'sentence', 'none'], [4]),
        make('05-spielblock', 'Langer Spielblock · Spielfeld wiederverwendet', [phrases[0], gameBlock, phrases[7]],
            ['sentence', 'sentence', 'none'], [1]),
    ] };
}

if (require.main === module) {
    if (process.argv.includes('--compact')) process.stdout.write(compactWav(fs.readFileSync(0), process.argv.includes('--internal')));
    else process.stdout.write(JSON.stringify(plan()));
}

module.exports = plan;
