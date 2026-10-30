'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const context = { localStorage: { getItem: () => null } };
vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/cleitstand'), 'utf8'), context);
const stages = people => JSON.parse(JSON.stringify(context.cleitstand.nameStages(people)));
const person = (firstname, lastname, extra = {}) => ({ firstname, lastname, ...extra });

describe('Tournament board name abbreviation', function() {
    it('removes middle names before abbreviating either first name, starting with the longer name', function() {
        assert.deepStrictEqual(stages([person('Alexander Maximilian', 'Weber'), person('Nina Maria', 'Hansen')]), [
            ['Alexander Maximilian Weber', 'Nina Maria Hansen'],
            ['Alexander Weber', 'Nina Maria Hansen'],
            ['Alexander Weber', 'Nina Hansen'],
            ['A. Weber', 'Nina Hansen'],
            ['A. Weber', 'N. Hansen'],
        ]);
    });

    it('starts with the second player when their full name has more letters', function() {
        assert.deepStrictEqual(stages([person('Nina Maria', 'Hansen'), person('Alexander Maximilian', 'Weber')])[1],
            ['Nina Maria Hansen', 'Alexander Weber']);
    });

    it('compares the names again after removing middle names', function() {
        assert.deepStrictEqual(stages([person('Al Maximilian Alexander', 'Li'), person('Christopher', 'Schmidt')]), [
            ['Al Maximilian Alexander Li', 'Christopher Schmidt'],
            ['Al Li', 'Christopher Schmidt'],
            ['Al Li', 'C. Schmidt'],
            ['A. Li', 'C. Schmidt'],
        ]);
    });

    it('skips absent middle names and preserves every part of a compound surname', function() {
        assert.deepStrictEqual(stages([person('Budhsa', 'Keo Boun Khoune'), person('Nina', 'Keo Boun Khoune')]), [
            ['Budhsa Keo Boun Khoune', 'Nina Keo Boun Khoune'],
            ['B. Keo Boun Khoune', 'Nina Keo Boun Khoune'],
            ['B. Keo Boun Khoune', 'N. Keo Boun Khoune'],
        ]);
    });

    it('counts Unicode letters rather than punctuation or the rendered width', function() {
        assert.deepStrictEqual(stages([person('Amy', 'D\'----X'), person('李华明', 'Müller')])[1],
            ['Amy D\'----X', '李. Müller']);
    });

    it('keeps both initials of a hyphenated first name', function() {
        assert.deepStrictEqual(stages([person('Jean-Luc', 'Müller')]), [
            ['Jean-Luc Müller'], ['J.-L. Müller'],
        ]);
    });

    it('handles a separate middle-name field without duplicating it', function() {
        assert.deepStrictEqual(stages([person('Max', 'Mustermann', { middlename: 'Emil' })]), [
            ['Max Emil Mustermann'], ['Max Mustermann'], ['M. Mustermann'],
        ]);
        assert.deepStrictEqual(stages([person('Max Emil', 'Mustermann', { middlename: 'Emil' })]), [
            ['Max Emil Mustermann'], ['Max Mustermann'], ['M. Mustermann'],
        ]);
    });

    it('recognizes middle names in the full name using the supplied surname boundary', function() {
        assert.deepStrictEqual(stages([person('Max', 'van der Meer', { name: 'Max Emil van der Meer' })]), [
            ['Max Emil van der Meer'], ['Max van der Meer'], ['M. van der Meer'],
        ]);
    });

    it('supports official surnames and already abbreviated names', function() {
        assert.deepStrictEqual(stages([{ firstname: 'Álvaro José', surname: 'García López' }]), [
            ['Álvaro José García López'], ['Álvaro García López'], ['Á. García López'],
        ]);
        assert.deepStrictEqual(stages([person('A.', 'Weber')]), [['A. Weber']]);
    });

    it('preserves an unstructured name rather than guessing which words are surnames', function() {
        assert.deepStrictEqual(stages([{ name: 'Budhsa Keo Boun Khoune' }]), [['Budhsa Keo Boun Khoune']]);
        assert.deepStrictEqual(stages([{}]), [['']]);
    });

    it('uses the first player to break equal-length ties and does not change tournament data', function() {
        const people = [person('Anna', 'Meier'), person('Lena', 'Weber')];
        const original = JSON.stringify(people);
        assert.deepStrictEqual(stages(people)[1], ['A. Meier', 'Lena Weber']);
        assert.strictEqual(JSON.stringify(people), original);
    });
});
