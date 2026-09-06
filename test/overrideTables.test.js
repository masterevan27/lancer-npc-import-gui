const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseRequiredTables, overrideTablesFrom, rerollableTraitsFrom, rawRerollableTraitsFrom,
    traitDependentsFrom,
} = require('../lib/overrideTables');

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

/* ---- rerollableTraitsFrom: the --reroll-trait list, derived not restated ---- */

test('rerollableTraitsFrom reads the generator REROLLABLE_TRAITS tuple', () => {
    const source = [
        'REQUIRED_TABLES = [',
        '    "Pronouns", "Hair", "Outfit",',
        ']',
        '',
        'REROLLABLE_TRAITS = (',
        '    "Callsigns", "Hair", "Eyes",',
        '    "Glow placement",',
        ')',
    ].join('\n');
    assert.deepEqual(rerollableTraitsFrom(source),
        ['Callsigns', 'Hair', 'Eyes', 'Glow placement']);
});

test('rerollableTraitsFrom returns an empty list rather than throwing on a miss', () => {
    // Same contract parseRequiredTables has: a reformatted or renamed constant
    // degrades to "offer no reroll buttons", never to a crashed server.
    assert.deepEqual(rerollableTraitsFrom('nothing of interest here'), []);
});

test('rerollableTraitsFrom does not pick up REQUIRED_TABLES by mistake', () => {
    const source = 'REQUIRED_TABLES = [\n    "Pronouns", "Hair",\n]\n';
    assert.deepEqual(rerollableTraitsFrom(source), []);
});

/* ---- rawRerollableTraitsFrom: the list a modern manifest entry gets ---- */

// generate-npc.py chooses between two re-rollable lists per NPC: the eleven
// above for an entry written before it recorded raw bullets, and this one -
// REQUIRED_TABLES minus the two halves of the name and Pronouns - for one that
// did. The shapes here are verbatim copies of both constants, in the order the
// generator declares them, because the anchoring that keeps the two parsers
// off each other's constant is only exercised when both are present.
const TWO_LIST_SOURCE = [
    'REQUIRED_TABLES = [',
    '    "Given names", "Family names", "Callsigns", "Pronouns", "Theme", "Age",',
    '    "Hair", "Role", "Outfit", "Weapon", "Stance",',
    ']',
    '',
    'REROLLABLE_TRAITS = (',
    '    "Callsigns", "Hair",',
    ')',
    '',
    'RAW_REROLLABLE_TRAITS = tuple(',
    '    name for name in REQUIRED_TABLES',
    '    if name not in ("Given names", "Family names", "Pronouns"))',
].join('\n');

test('rawRerollableTraitsFrom is REQUIRED_TABLES minus the generator exclusions', () => {
    assert.deepEqual(rawRerollableTraitsFrom(TWO_LIST_SOURCE), [
        'Callsigns', 'Theme', 'Age', 'Hair', 'Role', 'Outfit', 'Weapon', 'Stance',
    ]);
});

test('rawRerollableTraitsFrom offers Theme, which is the whole point of it', () => {
    // The bug this function exists to fix: Theme joined RAW_REROLLABLE_TRAITS
    // alone when the cascade work landed, the GUI was reading only the older
    // constant, and the most useful re-roll in the generator had no button.
    const raw = rawRerollableTraitsFrom(TWO_LIST_SOURCE);
    assert.ok(raw.includes('Theme'), 'Theme is re-rollable from raw bullets and must be offered');
    assert.ok(!rerollableTraitsFrom(TWO_LIST_SOURCE).includes('Theme'),
        'the legacy list still refuses Theme - the two lists are not the same list');
});

test('rawRerollableTraitsFrom refuses the name halves and Pronouns', () => {
    // Not a taste judgement: the folder and the manifest id are derived from
    // the name, so re-rolling either half is not a change in place, and
    // Pronouns takes every per-pronoun variant table with it.
    const raw = rawRerollableTraitsFrom(TWO_LIST_SOURCE);
    for (const refused of ['Given names', 'Family names', 'Pronouns']) {
        assert.ok(!raw.includes(refused), `${refused} cannot be re-rolled in place`);
    }
});

test('rawRerollableTraitsFrom returns an empty list rather than throwing on a miss', () => {
    // Same contract as every other parser here: a reformatted or renamed
    // constant degrades to "offer no reroll buttons", never to a crash.
    assert.deepEqual(rawRerollableTraitsFrom('nothing of interest here'), []);
    assert.deepEqual(
        rawRerollableTraitsFrom('RAW_REROLLABLE_TRAITS = list(REQUIRED_TABLES)\n'), []);
});

test('rawRerollableTraitsFrom returns nothing when it cannot read the exclusions', () => {
    // The one wrong answer with a plausible shape. A `tuple(...)` whose
    // exclusion tuple this could not read would otherwise hand back the whole
    // of REQUIRED_TABLES - Pronouns and both name halves included - and every
    // one of those is a button the generator refuses.
    const source = [
        'REQUIRED_TABLES = [',
        '    "Pronouns", "Hair",',
        ']',
        '',
        'RAW_REROLLABLE_TRAITS = tuple(',
        '    name for name in REQUIRED_TABLES',
        '    if name not in EXCLUDED_FROM_REROLL)',
    ].join('\n');
    assert.deepEqual(rawRerollableTraitsFrom(source), []);
});

test('the two reroll parsers do not read each other constant', () => {
    // The `^` anchor is the only thing keeping them apart: one name contains
    // the other, so an unanchored search would cross over in whichever
    // direction the file happens to declare first. Both directions, because
    // only one of them is exercised by the real generator's declaration order.
    const rawOnly = [
        'REQUIRED_TABLES = [',
        '    "Pronouns", "Theme", "Hair",',
        ']',
        '',
        'RAW_REROLLABLE_TRAITS = tuple(',
        '    name for name in REQUIRED_TABLES',
        '    if name not in ("Pronouns",))',
    ].join('\n');
    assert.deepEqual(rerollableTraitsFrom(rawOnly), [],
        'the legacy parser read RAW_REROLLABLE_TRAITS and would offer Theme on a lossy entry');

    const legacyOnly = [
        'REQUIRED_TABLES = [',
        '    "Pronouns", "Theme", "Hair",',
        ']',
        '',
        'REROLLABLE_TRAITS = (',
        '    "Hair",',
        ')',
    ].join('\n');
    assert.deepEqual(rawRerollableTraitsFrom(legacyOnly), [],
        'the raw parser answered from a generator that has no raw list at all');
});

/* ---- traitDependentsFrom: how far a single-trait re-roll actually reaches ---- */

// A cut-down TRAIT_DEPENDENTS carrying every shape the real one has: a value
// naming another constant rather than restating it (Theme), tuples written in
// place, a one-element tuple with Python's trailing comma, and prose comments
// between the entries - one of which quotes a phrase in double quotes, which is
// what an entry pattern reading the raw source would take for a key.
const DEPENDENTS_SOURCE = [
    'REQUIRED_TABLES = [',
    '    "Given names", "Pronouns", "Theme", "Age", "Build", "Hair", "Hair colour",',
    '    "Role", "Faction", "Outfit", "Weapon", "Gear", "Stance",',
    ']',
    '',
    'THEMED_TABLES = ("Hair", "Hair colour", "Outfit",',
    '                 "Weapon")',
    '',
    'TRAIT_DEPENDENTS = {',
    '    # Selection by theme rather than a flag read, which is why this single',
    '    # edge points at a whole tuple.',
    '    "Theme": THEMED_TABLES,',
    '',
    "    # All three read Role's 'mil' flag.",
    '    "Role": ("Faction", "Outfit", "Weapon"),',
    '',
    '    "Weapon": ("Gear", "Stance"),',
    '    "Gear": ("Stance",),',
    '    "Hair colour": ("Hair",),',
    '',
    '    # ... which is the "user expected a smaller change" risk the spec names.',
    '    "Age": ("Build", "Hair colour"),',
    '}',
    '',
    'REROLLABLE_TRAITS = (',
    '    "Build", "Hair",',
    ')',
].join('\n');

test('traitDependentsFrom reads the edges the generator declares', () => {
    assert.deepEqual(traitDependentsFrom(DEPENDENTS_SOURCE), {
        Theme: ['Hair', 'Hair colour', 'Outfit', 'Weapon'],
        Role: ['Faction', 'Outfit', 'Weapon'],
        Weapon: ['Gear', 'Stance'],
        Gear: ['Stance'],
        'Hair colour': ['Hair'],
        Age: ['Build', 'Hair colour'],
    });
});

test('traitDependentsFrom resolves a value that names another tuple', () => {
    // "Theme": THEMED_TABLES is not shorthand in the generator - it is how a
    // table tagged for theming next month starts cascading the day it is
    // tagged. Read the name instead of the tuple and Theme, the widest cascade
    // there is, would look like a trait that frees nothing.
    assert.deepEqual(traitDependentsFrom(DEPENDENTS_SOURCE).Theme,
        ['Hair', 'Hair colour', 'Outfit', 'Weapon']);
});

test('traitDependentsFrom is not fooled by a quoted phrase in a comment', () => {
    // Two thirds of that dict is prose, and prose gets rewritten. A parser that
    // made those comments unsafe to edit would be a worse bargain than the
    // hand-maintained copy of the map this file exists to avoid.
    const dependents = traitDependentsFrom(DEPENDENTS_SOURCE);
    assert.ok(!('user expected a smaller change' in dependents));
    assert.equal(Object.keys(dependents).length, 6);
});

test('traitDependentsFrom drops edges naming something outside REQUIRED_TABLES', () => {
    // trait_cascade() filters its own result the same way. A name the roller
    // does not draw is not a trait the GUI can warn about either, and naming one
    // in the dialog would send the user looking down a detail sheet that has no
    // such row.
    const source = [
        'REQUIRED_TABLES = [',
        '    "Theme", "Outfit",',
        ']',
        '',
        'TRAIT_DEPENDENTS = {',
        '    "Theme": ("Outfit", "Retired table"),',
        '    "Retired table": ("Outfit",),',
        '}',
    ].join('\n');
    assert.deepEqual(traitDependentsFrom(source), { Theme: ['Outfit'] });
});

test('traitDependentsFrom returns an empty map rather than throwing on a miss', () => {
    // Degrades the way every parser in this file does, and here the caller's
    // fallback is the point: an empty map puts the page on the coarse
    // over-warning rule rather than on "nothing cascades".
    assert.deepEqual(traitDependentsFrom('nothing of interest here'), {});
    assert.deepEqual(traitDependentsFrom('TRAIT_DEPENDENTS = {\n    "Theme": THEMED,\n}\n'), {},
        'no REQUIRED_TABLES to filter against means no answer worth giving');
});
