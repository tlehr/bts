'use strict';

const DIGITS = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
const SMALL = [...DIGITS, 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn',
    'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
const SCALES = [null, null, ['Million', 'Millionen'], ['Milliarde', 'Milliarden'],
    ['Billion', 'Billionen'], ['Billiarde', 'Billiarden'], ['Trillion', 'Trillionen']];

const digits = value => [...value].map(digit => DIGITS[Number(digit)]).join(' ');

function belowThousand(value) {
    if (value >= 100) return (value < 200 ? 'ein' : DIGITS[Math.floor(value / 100)]) + 'hundert' +
        (value % 100 ? belowThousand(value % 100) : '');
    if (value < 20) return SMALL[value];
    const unit = value % 10;
    return (unit ? (unit === 1 ? 'ein' : DIGITS[unit]) + 'und' : '') + TENS[Math.floor(value / 10)];
}

function integer(value) {
    // Keep leading-zero identifiers and numbers beyond the supported scales
    // exact, without ever rounding them through JavaScript's Number type.
    if (value.length > SCALES.length * 3 || /^0\d/.test(value)) return digits(value);
    const groups = value.match(/\d{1,3}(?=(?:\d{3})*$)/g);
    const words = [];
    let remainder = '';
    for (const [index, group] of groups.entries()) {
        const amount = Number(group);
        const scale = groups.length - index - 1;
        if (!amount) continue;
        if (scale >= 2) words.push(amount === 1 ? 'eine ' + SCALES[scale][0] :
            belowThousand(amount) + ' ' + SCALES[scale][1]);
        else if (scale === 1) remainder += (amount === 1 ? 'ein' : belowThousand(amount)) + 'tausend';
        else remainder += belowThousand(amount);
    }
    if (remainder) words.push(remainder);
    return words.join(' ') || 'null';
}

function number(value) {
    // German thousands separators and decimal commas. Other notation (dates,
    // scores, ranges) keeps its separators rather than guessing its meaning.
    if (/^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?$/.test(value)) value = value.replace(/\./g, '');
    if (/^\d+(?:,\d+)?$/.test(value)) {
        const [whole, fraction] = value.split(',');
        return integer(whole) + (fraction === undefined ? '' : ' Komma ' + digits(fraction));
    }
    return value.replace(/\d+/g, integer).replace(/([.,])/g, '$1 ');
}

function spellNumbers(text) {
    return text.replace(/([+-]?)(\d+(?:[.,]\d+)*)/g, (_match, sign, value, offset) => {
        const before = text[offset - 1] || '';
        const after = text[offset + sign.length + value.length] || '';
        const unary = sign && !/[\p{L}\p{N}]/u.test(before);
        const prefix = unary ? (sign === '-' ? 'minus ' : 'plus ') : sign;
        return (!sign && /\p{L}/u.test(before) ? ' ' : '') + prefix + number(value) +
            (/\p{L}/u.test(after) ? ' ' : '');
    });
}

module.exports = { spellNumbers, VERSION: 'de-numbers-v1' };
