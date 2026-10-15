'use strict';

const assert = require('assert');
const { spellNumbers } = require('../bts/speech/numbers');

describe('German numbers for the local speech server', function() {
    it('spells small numbers and the irregular German forms', function() {
        assert.strictEqual(spellNumbers('0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19'),
            'null eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf dreizehn vierzehn fünfzehn sechzehn siebzehn achtzehn neunzehn');
        assert.strictEqual(spellNumbers('20 21 30 31 60 61 70 71 99'),
            'zwanzig einundzwanzig dreißig einunddreißig sechzig einundsechzig siebzig einundsiebzig neunundneunzig');
    });

    it('joins hundreds and thousands without extra word pauses', function() {
        for (const [source, expected] of [
            ['100', 'einhundert'], ['101', 'einhunderteins'], ['186', 'einhundertsechsundachtzig'],
            ['600', 'sechshundert'], ['700', 'siebenhundert'], ['999', 'neunhundertneunundneunzig'],
            ['1000', 'eintausend'], ['1001', 'eintausendeins'], ['1100', 'eintausendeinhundert'],
            ['2026', 'zweitausendsechsundzwanzig'], ['21000', 'einundzwanzigtausend'],
            ['100001', 'einhunderttausendeins'],
        ]) assert.strictEqual(spellNumbers(source), expected, source);
    });

    it('uses German singular and plural scales without losing integer precision', function() {
        for (const [source, expected] of [
            ['1000000', 'eine Million'], ['2000000', 'zwei Millionen'], ['1001001', 'eine Million eintausendeins'],
            ['1000000000', 'eine Milliarde'], ['2000000000', 'zwei Milliarden'],
            ['1000000000000', 'eine Billion'], ['1000000000000000', 'eine Billiarde'],
            ['1000000000000000000', 'eine Trillion'],
            ['9007199254740993', 'neun Billiarden sieben Billionen einhundertneunundneunzig Milliarden ' +
                'zweihundertvierundfünfzig Millionen siebenhundertvierzigtausendneunhundertdreiundneunzig'],
        ]) assert.strictEqual(spellNumbers(source), expected, source);
    });

    it('separates embedded digits from age groups, units and names while keeping the surrounding text', function() {
        assert.strictEqual(spellNumbers('  Jungeneinzel U17! Ü35, O19: 2x21\nHalle 8a, FC2026.  '),
            '  Jungeneinzel U siebzehn! Ü fünfunddreißig, O neunzehn: zwei x einundzwanzig\nHalle acht a, FC zweitausendsechsundzwanzig.  ');
        assert.strictEqual(spellNumbers('Auf Spielfeld 8! Spiel Nummer 186!'),
            'Auf Spielfeld acht! Spiel Nummer einhundertsechsundachtzig!');
    });

    it('reads German thousands and decimal commas, preserving every fractional digit', function() {
        assert.strictEqual(spellNumbers('1.234 1.000.001 1.234,50 0,005 -12,30 +4'),
            'eintausendzweihundertvierunddreißig eine Million eins eintausendzweihundertvierunddreißig Komma fünf null ' +
            'null Komma null null fünf minus zwölf Komma drei null plus vier');
    });

    it('keeps range, score and date separators without interpreting them as signed numbers', function() {
        assert.strictEqual(spellNumbers('U-17, Plätze 1-4, 21:19, 3/4, 3. Satz, 15.10.2026'),
            'U-siebzehn, Plätze eins-vier, einundzwanzig:neunzehn, drei/vier, drei. Satz, fünfzehn. zehn. zweitausendsechsundzwanzig');
    });

    it('reads leading-zero identifiers and arbitrarily large numbers digit by digit', function() {
        assert.strictEqual(spellNumbers('0042'), 'null null vier zwei');
        assert.strictEqual(spellNumbers('1' + '0'.repeat(80)), 'eins' + ' null'.repeat(80));
    });

    it('keeps texts without digits exact and never converts a spoken number twice', function() {
        const original = '  Guten Morgen! Änne Müller gegen Nina K.\nBitte mit dem Spielen beginnen!';
        assert.strictEqual(spellNumbers(original), original);
        const spoken = spellNumbers('U17 auf Spielfeld 8: Spiel 186, 21:19.');
        assert(!/\d/.test(spoken));
        assert.strictEqual(spellNumbers(spoken), spoken);
    });
});
