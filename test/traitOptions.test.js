const test = require('node:test');
const assert = require('node:assert/strict');
const { traitOptionsFrom, readableLabel, variantSubjectOf } = require('../lib/traitOptions');

const TABLES = [
    { name: 'Outfit', bullets: [
        { text: 'a heavy work jacket || civ', weight: 1, enabled: true },
        { text: 'nondescript grey work coveralls', weight: 4, enabled: true },
        { text: 'a graffiti-tagged cropped t-shirt || civ', weight: 1, enabled: false },
    ] },
    { name: 'Outfit (she) +', bullets: [
        { text: 'a fitted flight suit', weight: 1, enabled: true },
    ] },
    { name: 'Gear', bullets: [
        { text: 'nothing at all, hands loose and empty', weight: 1, enabled: true },
    ] },
];

test('readableLabel swaps the segment separator for something a dropdown can show', () => {
    assert.equal(
        readableLabel('Harrison Armory || sharply pressed, high collar || mil palette'),
        'Harrison Armory · sharply pressed, high collar · mil palette');
    assert.equal(readableLabel('nondescript grey work coveralls'),
        'nondescript grey work coveralls');
});

test('options are keyed by base table name, with variants folded in', () => {
    const options = traitOptionsFrom(TABLES);
    assert.deepEqual(Object.keys(options).sort(), ['Gear', 'Outfit']);
    assert.equal(options.Outfit.length, 4);
    assert.equal(options.Gear.length, 1);
});

test('an option carries the raw bullet text, flags included, as its value', () => {
    // The whole point. --set-trait is documented as taking the bullet
    // verbatim - `--set-trait Outfit="an elaborate floral kimono ... || civ
    // notac"` - and the flags are what gate Weapon and Gear downstream. A
    // dropdown offering only the prose would silently drop them.
    const { Outfit } = traitOptionsFrom(TABLES);
    const jacket = Outfit.find((o) => o.label.startsWith('a heavy work jacket'));
    assert.equal(jacket.value, 'a heavy work jacket || civ');
});

test('the weight prefix is not part of the value', () => {
    // splitWeight() has already removed it upstream; this pins that the
    // option does not reintroduce it, since 'x4 ...' is not a bullet the
    // generator would match.
    const { Outfit } = traitOptionsFrom(TABLES);
    const coveralls = Outfit.find((o) => o.value.includes('coveralls'));
    assert.equal(coveralls.value, 'nondescript grey work coveralls');
    assert.equal(coveralls.weight, 4);
});

test('a variant option names the heading it came from and is marked as one', () => {
    const { Outfit } = traitOptionsFrom(TABLES);
    const flight = Outfit.find((o) => o.value === 'a fitted flight suit');
    assert.equal(flight.heading, 'Outfit (she) +');
    assert.equal(flight.isVariant, true);

    const base = Outfit.find((o) => o.value === 'a heavy work jacket || civ');
    assert.equal(base.heading, 'Outfit');
    assert.equal(base.isVariant, false);
});

test('disabled bullets are offered too, flagged rather than dropped', () => {
    // --set-trait bypasses the roll pool entirely, so a bullet disabled on the
    // Tables tab is still a legitimate thing to force. It is marked so the
    // choice is informed rather than hidden.
    const { Outfit } = traitOptionsFrom(TABLES);
    const tee = Outfit.find((o) => o.value.includes('graffiti-tagged'));
    assert.equal(tee.enabled, false);
    assert.ok(Outfit.every((o) => typeof o.enabled === 'boolean'));
});

test('base-table options come before variant ones', () => {
    const { Outfit } = traitOptionsFrom(TABLES);
    const firstVariant = Outfit.findIndex((o) => o.isVariant);
    const lastBase = Outfit.map((o) => o.isVariant).lastIndexOf(false);
    assert.ok(firstVariant > lastBase, 'variants must sort after the base table');
});

test('both documented variant forms report their pronoun subject', () => {
    // '(she) +' adds to the base table and '(she)' replaces it - a difference
    // that decides the generator's roll and changes nothing here, since either
    // way the bullet is reachable by that pronoun alone.
    assert.equal(variantSubjectOf('Outfit (she) +'), 'she');
    assert.equal(variantSubjectOf('Hair (he) +'), 'he');
    assert.equal(variantSubjectOf('Build (she)'), 'she');
    assert.equal(variantSubjectOf('Height (they)'), 'they');
});

test('a base table has no pronoun subject', () => {
    assert.equal(variantSubjectOf('Outfit'), null);
    assert.equal(variantSubjectOf('Given names'), null);
});

test('a parenthesis that is not a pronoun is not read as one', () => {
    // The tables file documents no such heading today, and nothing stops one
    // being added. Guessing 'she' from any parenthesis would hide a neutral
    // option from every man - failing in the same direction as the bug the
    // field exists to fix, only against options nobody meant to gate.
    assert.equal(variantSubjectOf('Backdrop (interior)'), null);
    assert.equal(variantSubjectOf('Weapon (melee) +'), null);
});

test('an option carries the pronoun subject of its own heading', () => {
    const { Outfit, Gear } = traitOptionsFrom(TABLES);
    const flight = Outfit.find((o) => o.value === 'a fitted flight suit');
    assert.equal(flight.variantSubject, 'she');

    const jacket = Outfit.find((o) => o.value === 'a heavy work jacket || civ');
    assert.equal(jacket.variantSubject, null);
    assert.equal(Gear[0].variantSubject, null);

    // What the client gates on: with Pronouns set to 'he', everything left is
    // neutral, and the woman-only flight suit is not among it.
    const forHim = Outfit.filter((o) => o.variantSubject === null || o.variantSubject === 'he');
    assert.ok(!forHim.some((o) => o.value === 'a fitted flight suit'));
    assert.equal(forHim.length, 3);
});

test('a table with no bullets contributes no key', () => {
    assert.deepEqual(traitOptionsFrom([{ name: 'Empty', bullets: [] }]), {});
});

test('a reference is expanded into its group\'s members, and the group is not a key of its own', () => {
    const tables = [
        { name: 'Outfit', references: ['Flight suits'], bullets: [
            { text: 'a jacket || civ', weight: 1, enabled: true },
            { text: '=> Flight suits', weight: 2, enabled: true },
        ] },
        { name: 'Outfit (she) +', references: [], bullets: [{ text: 'a fitted top', weight: 1, enabled: true }] },
        { name: 'Flight suits', references: [], bullets: [{ text: 'a flight suit || mil', weight: 1, enabled: true }] },
        { name: 'Flight suits (she) +', references: [], bullets: [{ text: 'a tailored flight suit', weight: 1, enabled: false }] },
    ];
    const options = traitOptionsFrom(tables);
    assert.deepEqual(Object.keys(options), ['Outfit']);
    // Variant headings sort alphabetically, so a group's she-variant
    // ('Flight suits (she) +') lands before the parent's own she-variant
    // ('Outfit (she) +') when its name sorts earlier.
    assert.deepEqual(options.Outfit.map((o) => [o.value, o.heading, o.group, o.variantSubject, o.enabled]), [
        ['a jacket || civ', 'Outfit', null, null, true],
        ['a flight suit || mil', 'Flight suits', 'Flight suits', null, true],
        ['a tailored flight suit', 'Flight suits (she) +', 'Flight suits', 'she', false],
        ['a fitted top', 'Outfit (she) +', null, 'she', true],
    ]);
    assert.ok(!options.Outfit.some((o) => o.value.startsWith('=>')), 'the reference itself is never a value');
});
