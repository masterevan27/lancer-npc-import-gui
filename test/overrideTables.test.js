const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRequiredTables, overrideTablesFrom } = require('../lib/overrideTables');

// A verbatim excerpt of generate-npc.py's REQUIRED_TABLES, wrapped in enough
// surrounding source that the parser has to actually find it rather than
// matching the whole file.
const SOURCE = [
    'TOKEN_LIMIT = 512',
    '',
    'REQUIRED_TABLES = [',
    '    "Given names", "Family names", "Callsigns", "Pronouns", "Theme", "Age",',
    '    "Build", "Height", "Skin", "Hair", "Hair colour", "Eyes", "Feature",',
    '    "Demeanor", "Role",',
    '    "Faction", "Outfit", "Headgear", "Weapon", "Gear", "Glow colour", "Backdrop",',
    '    "Weather", "Stance",',
    ']',
    '',
    'THEMED_TABLES = ["Outfit"]',
    '',
].join('\n');

test('parseRequiredTables reads every name out of the list', () => {
    const tables = parseRequiredTables(SOURCE);
    assert.equal(tables.length, 24);
    assert.equal(tables[0], 'Given names');
    assert.equal(tables.at(-1), 'Stance');
});

test('parseRequiredTables stops at the closing bracket, not a later list', () => {
    // THEMED_TABLES follows in the source and also contains "Outfit". A greedy
    // match would pick it up a second time.
    const tables = parseRequiredTables(SOURCE);
    assert.equal(tables.filter((name) => name === 'Outfit').length, 1);
    assert.ok(!tables.includes('THEMED_TABLES'));
});

test('overrideTablesFrom drops Pronouns, which has its own field in the GUI', () => {
    const tables = overrideTablesFrom(SOURCE);
    assert.ok(!tables.includes('Pronouns'));
    assert.equal(tables.length, 23);
});

test('overrideTablesFrom offers the tables that had drifted out of the list', () => {
    // Weapon was split out of Gear, Theme was added, and Height and Hair
    // colour were never there - all four were unreachable from the trait
    // override dropdown.
    const tables = overrideTablesFrom(SOURCE);
    for (const name of ['Weapon', 'Theme', 'Height', 'Hair colour']) {
        assert.ok(tables.includes(name), `${name} missing from the override list`);
    }
});

test('overrideTablesFrom offers Glow colour and not the old Accent name', () => {
    const tables = overrideTablesFrom(SOURCE);
    assert.ok(tables.includes('Glow colour'));
    assert.ok(!tables.includes('Accent'));
});

test('parseRequiredTables returns an empty list when the constant is absent', () => {
    // A generator too old or too new to have it must not crash the server.
    assert.deepEqual(parseRequiredTables('x = 1\n'), []);
});
