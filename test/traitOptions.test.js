const test = require('node:test');
const assert = require('node:assert/strict');
const { traitOptionsFrom, readableLabel } = require('../lib/traitOptions');

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

test('a table with no bullets contributes no key', () => {
    assert.deepEqual(traitOptionsFrom([{ name: 'Empty', bullets: [] }]), {});
});
