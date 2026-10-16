'use strict';

const { spellNumbers } = require('./numbers');
const PREFIX = '~bts-context-v1~';
const VERSION = 'bts-context-v1';
const KINDS = new Set(['source', 'generic', 'game', 'team', 'field_start', 'field_end', 'prep_prefix', 'board_long', 'hall']);

function decode(part, maxText) {
    if (!part.startsWith(PREFIX)) return null;
    const value = JSON.parse(part.slice(PREFIX.length));
    if (!value || Object.keys(value).length !== 4 || !KINDS.has(value.kind) ||
        !['before', 'text', 'after'].every(key => typeof value[key] === 'string') || !value.text.trim() ||
        value.kind === 'source' && (value.before || value.after) ||
        spellNumbers(value.before + value.text + value.after).length > maxText) throw new Error('invalid_context_recipe');
    return value;
}

function sourcePart(recipe) {
    return PREFIX + JSON.stringify({ before: '', text: recipe.before + recipe.text + recipe.after, after: '', kind: 'source' });
}

module.exports = { decode, sourcePart, VERSION };
