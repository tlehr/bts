'use strict';

const assert = require('assert');
const { candidates, token, replacement, completed, history } = require('../static/js/announcement_editor');

describe('Free announcement text editing', function() {
    const mia = { name: 'Mia Göker', club: 'PSV Musterstadt', state: 'Nordrhein-Westfalen', association: 'DBV' };
    const finn = { firstname: 'Finn', lastname: 'Sommer', club: 'BC Teststadt', state: 'Niedersachsen' };
    const tournament = {
        events: { events: [{ stages: [{ entries: [{ team: { players: [mia, finn] } }, { team: { players: [{ name: 'Noch ohne Spiel', club: 'Dritter Verein' }] } }] }] }] },
        matches: [{ setup: { teams: [{ players: [mia, finn] }, { players: [finn, mia] }, { players: [{ name: 'Nur im Spiel' }] }] } }],
    };

    it('includes registration and match players, known pairs, clubs and state federations without duplicates', function() {
        const rows = candidates(tournament), of = kind => rows.filter(row => row.kind === kind);
        assert.deepStrictEqual(of('player').map(row => row.label), ['Finn Sommer', 'Mia Göker', 'Noch ohne Spiel', 'Nur im Spiel']);
        assert.strictEqual(of('pair').length, 1);
        assert.strictEqual(of('pair')[0].label, 'Mia Göker / Finn Sommer');
        assert.strictEqual(of('pair')[0].value, 'Mia Göker und Finn Sommer');
        assert.strictEqual(of('club').length, 3);
        assert.deepStrictEqual(of('state').map(row => row.label), ['Niedersachsen', 'Nordrhein-Westfalen']);
        assert(!rows.some(row => row.label === 'DBV'), 'the national association is not the state federation');
    });

    it('omits unknown players and incomplete pairs while keeping known teammates and their metadata', function() {
        const rows = candidates({ matches: [{ setup: { teams: [{ players: [mia, null, {}] }] } }, {}] });
        assert.strictEqual(rows.filter(row => row.kind === 'player').length, 1);
        assert(!rows.some(row => row.kind === 'pair'));
        assert(rows.some(row => row.kind === 'club' && row.label === 'PSV Musterstadt'));
        assert.deepStrictEqual(candidates(), []);
    });

    it('finds the related clubs, players and cross-state pairs when searching for a state federation', function() {
        const rows = candidates(tournament), north = rows.filter(row => row.search.includes('nordrhein-westfalen'));
        assert.deepStrictEqual(north.filter(row => row.kind === 'club').map(row => row.label), ['PSV Musterstadt']);
        assert.deepStrictEqual(north.filter(row => row.kind === 'player').map(row => row.label), ['Mia Göker']);
        assert.strictEqual(north.filter(row => row.kind === 'pair').length, 1);
        const shared = candidates({ matches: [{ setup: { teams: [{ players: [
            { name: 'Ohne Landesverband', club: 'Gemeinsamer Verein' },
            { ...mia, club: 'Gemeinsamer Verein' }, { ...finn, club: 'Gemeinsamer Verein' },
        ] }] } }] }).find(row => row.kind === 'club');
        assert(shared.search.includes('nordrhein-westfalen') && shared.search.includes('niedersachsen'));
        assert.strictEqual(shared.detail, 'Niedersachsen · Nordrhein-Westfalen');
    });

    it('finds a slash query at the cursor across full names and lines without treating URLs or ordinary slashes as commands', function() {
        for (const value of ['/', 'Bitte /Mia Gö', 'Erste Zeile\n(/Finn']) {
            const range = token(value, value.length);
            assert(range);assert.strictEqual(value.slice(range.start, range.end), '/' + range.query);
        }
        for (const value of ['https://example.com', 'und/oder', 'Nur normaler Text']) {
            assert.strictEqual(token(value, value.length), null);
        }
        const next = 'Mia / Finn /';assert.strictEqual(token(next, next.length).query, '');
        assert.strictEqual(token('/Mia', 0, 4), null);
    });

    it('replaces just the slash query, preserving the sentence suffix and the cursor position', function() {
        const value = 'Bitte /Mia, zur Turnierleitung.';
        const range = token(value, value.indexOf('ia') + 1);
        const result = replacement(value, range, 'Mia Göker');
        assert.strictEqual(result.value, 'Bitte Mia Göker, zur Turnierleitung.');
        assert.strictEqual(result.caret, 'Bitte Mia Göker'.length);
        assert.strictEqual(replacement('Bitte /', token('Bitte /', 7), 'Mia Göker').value, 'Bitte Mia Göker ');
        assert.strictEqual(replacement('/Mi bitte kommen', token('/Mi bitte kommen', 3), 'Mia Göker').value, 'Mia Göker bitte kommen');
    });

    it('rejects an overlong completion instead of truncating a name', function() {
        const range = token('/Mi', 3);
        assert.strictEqual(replacement('/Mi', range, 'Mia Göker', 8), null);
        assert.strictEqual(replacement('/Mi', range, 'Mia Göker', 10).value, 'Mia Göker ');
    });

    it('finishes a fully written state before normal sentence text and removes the slash', function() {
        const text = 'Ein Vertreter vom Landesverband /Niedersachsen bitte zur Turnierleitung!';
        const result = completed(text, token(text, text.length), candidates(tournament));
        assert.strictEqual(result.value, 'Ein Vertreter vom Landesverband Niedersachsen bitte zur Turnierleitung!');
        assert.strictEqual(result.inserted, 'Niedersachsen');
        assert.strictEqual(token(result.value, result.value.length), null);
        const space = '/Niedersachsen ';
        assert.strictEqual(completed(space, token(space, space.length), candidates(tournament)).value, 'Niedersachsen ');
    });

    it('keeps longer names and a doubles partner searchable instead of prematurely finishing a prefix', function() {
        const rows = candidates(tournament);
        for (const text of ['/Mia Göker ', '/Mia Göker und ', '/Mia Göker / ']) {
            assert.strictEqual(completed(text, token(text, text.length), rows), null);
        }
        const text = '/Mia Göker bitte kommen';
        assert.strictEqual(completed(text, token(text, text.length), rows).value, 'Mia Göker bitte kommen');
    });

    it('finds doubles by both partner names joined with und or a slash and replaces the complete expression', function() {
        const pair = candidates(tournament).find(row => row.kind === 'pair');
        assert(pair.search.includes('mia goker und finn sommer'));
        for (const text of ['/Mia Göker / Finn Sommer', '/Mia Göker und Finn Sommer']) {
            const range = token(text, text.length);
            assert.strictEqual(range.start, 0);assert.strictEqual(range.query, text.slice(1));
            assert.strictEqual(replacement(text, range, pair.value).value, 'Mia Göker und Finn Sommer ');
        }
    });

    it('keeps doubles from registration and games even when the other source is empty', function() {
        for (const current of [{ events: tournament.events }, { matches: tournament.matches }]) {
            assert.strictEqual(candidates(current).filter(row => row.kind === 'pair').length, 1);
        }
    });

    it('does not partially finish a double when the full replacement exceeds the text limit', function() {
        const text = '/Mia Göker / Finn Sommer bitte kommen';
        assert.strictEqual(completed(text, token(text, text.length), candidates(tournament), text.length), null);
    });
});

describe('Sent free announcement history', function() {
    it('walks newest first and restores the exact unfinished draft including whitespace and newlines', function() {
        const h = history();h.remember('Erster Aufruf');h.remember('Zweiter Aufruf');
        assert.deepStrictEqual(h.move(-1, '  Mein\nEntwurf  '), { value: 'Zweiter Aufruf', draft: false });
        assert.deepStrictEqual(h.move(-1, 'ignored'), { value: 'Erster Aufruf', draft: false });
        assert.deepStrictEqual(h.move(-1, 'ignored'), { value: 'Erster Aufruf', draft: false });
        assert.strictEqual(h.move(1, '').value, 'Zweiter Aufruf');
        assert.deepStrictEqual(h.move(1, ''), { value: '  Mein\nEntwurf  ', draft: true });
        assert.strictEqual(h.move(1, ''), null);
    });

    it('persists the last 50 sent texts and ignores consecutive duplicates and blank texts', function() {
        let stored;
        const h = history({ write: entries => { stored = entries; } });
        for (let i = 0; i < 55; i++) h.remember('Aufruf ' + i);
        h.remember('Aufruf 54');h.remember('  ');
        assert.strictEqual(stored.length, 50);assert.strictEqual(stored[0], 'Aufruf 5');
        assert.strictEqual(history({ read: () => stored }).move(-1, '').value, 'Aufruf 54');
    });

    it('treats an edited recalled text as the new draft without modifying past announcements', function() {
        const h = history();h.remember('Gesendeter Text');h.move(-1, 'Alter Entwurf');h.reset();
        assert.strictEqual(h.move(-1, 'Bearbeiteter Entwurf').value, 'Gesendeter Text');
        assert.strictEqual(h.move(1, '').value, 'Bearbeiteter Entwurf');
    });

    it('continues in memory when storage is denied or malformed', function() {
        const h = history({ read: () => { throw new Error('denied'); }, write: () => { throw new Error('full'); } });
        h.remember('Im Speicher');assert.strictEqual(h.move(-1, '').value, 'Im Speicher');
        assert.strictEqual(history({ read: () => ({ invalid: true }) }).move(-1, ''), null);
        assert.strictEqual(history({ read: () => [null, 123, '', 'Gültig'] }).move(-1, '').value, 'Gültig');
    });
});
