'use strict';

const { spellNumbers } = require('./numbers');
const VERSION = 'bts-context-v1';
const V2 = 'bts-context-v2';
const SUPPORTED = [VERSION, V2];
const KINDS = new Set(['source', 'generic', 'game', 'team', 'field_start', 'field_end', 'prep_prefix', 'board_long', 'hall']);

function decode(part, maxText) {
    const version = SUPPORTED.find(value => part.startsWith('~' + value + '~'));
    if (!version) return null;
    const value = JSON.parse(part.slice(version.length + 2));
    if (!value || Object.keys(value).length !== 4 || !KINDS.has(value.kind) ||
        !['before', 'text', 'after'].every(key => typeof value[key] === 'string') || !value.text.trim() ||
        value.kind === 'source' && (value.before || value.after) ||
        spellNumbers(value.before + value.text + value.after).length > maxText) throw new Error('invalid_context_recipe');
    Object.defineProperty(value, 'version', { value: version });
    return value;
}

function sourcePart(recipe) {
    return '~' + (recipe.version || VERSION) + '~' + JSON.stringify({ before: '', text: recipe.before + recipe.text + recipe.after, after: '', kind: 'source' });
}

module.exports = { decode, sourcePart, VERSION, V2, SUPPORTED };
