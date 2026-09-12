const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify, snapshotSelected, diffPresetAgainstTables } = require('../lib/presets');

test('slugify lowercases, hyphenates, and strips punctuation', () => {
    assert.equal(slugify('Grittier Frontier!'), 'grittier-frontier');
    assert.equal(slugify('  Leading/trailing spaces  '), 'leading-trailing-spaces');
});

test('snapshotSelected captures every table, listing only enabled bullets with their weight', () => {
    const parsed = [
        { name: 'Outfit', bullets: [
            { text: 'a jacket', weight: 1, enabled: true },
            { text: 'a graffiti tee', weight: 2, enabled: false },
        ] },
        { name: 'Gear', bullets: [
            { text: 'nothing at all', weight: 1, enabled: true },
        ] },
        { name: 'Headgear', bullets: [
            { text: 'a helmet', weight: 1, enabled: false },
        ] },
    ];
    assert.deepEqual(snapshotSelected(parsed), {
        Outfit: [{ text: 'a jacket', weight: 1 }],
        Gear: [{ text: 'nothing at all', weight: 1 }],
        Headgear: [], // every bullet disabled - the table still gets a key, so it stays covered
    });
});

test('diffPresetAgainstTables enables a selected bullet that is currently disabled, at its recorded weight', () => {
    const parsed = [{ name: 'Outfit', bullets: [
        { text: 'a graffiti tee', weight: 1, enabled: false },
    ] }];
    const preset = { Outfit: [{ text: 'a graffiti tee', weight: 3 }] };
    const diff = diffPresetAgainstTables(preset, parsed);
    assert.deepEqual(diff.willEnable, [{ table: 'Outfit', text: 'a graffiti tee', weight: 3 }]);
    assert.deepEqual(diff.willDisable, []);
    assert.deepEqual(diff.willReweight, []);
});

test('diffPresetAgainstTables reweights a selected bullet that is already enabled at a different weight', () => {
    const parsed = [{ name: 'Outfit', bullets: [
        { text: 'a jacket', weight: 1, enabled: true },
    ] }];
    const preset = { Outfit: [{ text: 'a jacket', weight: 4 }] };
    const diff = diffPresetAgainstTables(preset, parsed);
    assert.deepEqual(diff.willReweight, [{ table: 'Outfit', text: 'a jacket', weight: 4 }]);
    assert.deepEqual(diff.willEnable, []);
});

test('diffPresetAgainstTables disables an enabled bullet in a covered table that the preset does not select', () => {
    const parsed = [{ name: 'Outfit', bullets: [
        { text: 'a jacket', weight: 1, enabled: true },
        { text: 'a hat', weight: 1, enabled: true },
    ] }];
    const preset = { Outfit: [{ text: 'a jacket', weight: 1 }] };
    const diff = diffPresetAgainstTables(preset, parsed);
    assert.deepEqual(diff.willDisable, [{ table: 'Outfit', text: 'a hat' }]);
});

test('diffPresetAgainstTables treats a matching bullet, and an already-unselected disabled one, as alreadyMatching', () => {
    const parsed = [{ name: 'Outfit', bullets: [
        { text: 'a jacket', weight: 1, enabled: true },
        { text: 'a hat', weight: 1, enabled: false },
    ] }];
    const preset = { Outfit: [{ text: 'a jacket', weight: 1 }] };
    const diff = diffPresetAgainstTables(preset, parsed);
    assert.deepEqual(diff.alreadyMatching, [
        { table: 'Outfit', text: 'a jacket' },
        { table: 'Outfit', text: 'a hat' },
    ]);
});

test('diffPresetAgainstTables reports a selected bullet as notFound when its text no longer exists locally', () => {
    const parsed = [{ name: 'Outfit', bullets: [] }];
    const preset = { Outfit: [{ text: 'a bullet that got removed', weight: 1 }] };
    const diff = diffPresetAgainstTables(preset, parsed);
    assert.deepEqual(diff.notFound, [{ table: 'Outfit', text: 'a bullet that got removed' }]);
});

test('diffPresetAgainstTables reports every entry notFound, and touches nothing, when the whole table is missing locally', () => {
    const diff = diffPresetAgainstTables({ Headgear: [{ text: 'a helmet', weight: 1 }] }, [{ name: 'Outfit', bullets: [] }]);
    assert.deepEqual(diff.notFound, [{ table: 'Headgear', text: 'a helmet' }]);
    assert.deepEqual(diff.willDisable, []);
});

test('diffPresetAgainstTables treats a selected entry with a missing weight as weight 1, not as unselected', () => {
    const parsed = [{ name: 'Outfit', bullets: [
        { text: 'a jacket', weight: 1, enabled: true },
    ] }];
    const preset = { Outfit: [{ text: 'a jacket' }] }; // no weight field at all
    const diff = diffPresetAgainstTables(preset, parsed);
    assert.deepEqual(diff.alreadyMatching, [{ table: 'Outfit', text: 'a jacket' }]);
    assert.deepEqual(diff.willDisable, []);
});

test('diffPresetAgainstTables leaves a table with no key in the preset completely untouched', () => {
    const parsed = [
        { name: 'Outfit', bullets: [{ text: 'a jacket', weight: 1, enabled: true }] },
        { name: 'Cybernetics', bullets: [{ text: 'a chrome arm', weight: 1, enabled: true }] },
    ];
    // preset was saved before "Cybernetics" existed - it has no key for it at all
    const preset = { Outfit: [{ text: 'a jacket', weight: 1 }] };
    const diff = diffPresetAgainstTables(preset, parsed);
    assert.deepEqual(diff.willDisable, []);
    assert.deepEqual(diff.alreadyMatching, [{ table: 'Outfit', text: 'a jacket' }]);
});

/* ---- known-issues 2: a duplicated bullet text made the diff overpromise ---- */

test('a bullet text repeated in one table is diffed once, not once per copy', () => {
    // The writers in lib/tableBullets.js resolve a bullet to its FIRST
    // matching line, so a table carrying the same text twice can only ever
    // have one of them changed. The diff walked every copy, so a preview
    // promised two changes where the apply performs one - and the second
    // apply call found the first line already in the requested state and
    // returned early, changing nothing.
    const parsed = [
        { name: 'Outfit', bullets: [
            { text: 'a jacket', weight: 1, enabled: true },
            { text: 'a jacket', weight: 1, enabled: true },
        ] },
    ];
    const diff = diffPresetAgainstTables({ Outfit: [] }, parsed);
    assert.deepEqual(diff.willDisable, [{ table: 'Outfit', text: 'a jacket' }]);
});

test('the first copy of a duplicated bullet decides, matching the writers', () => {
    // Enabled copy first, disabled copy second. The writers would flip the
    // enabled one, so the diff must describe that and not the other.
    const parsed = [
        { name: 'Outfit', bullets: [
            { text: 'a jacket', weight: 1, enabled: true },
            { text: 'a jacket', weight: 1, enabled: false },
        ] },
    ];
    const diff = diffPresetAgainstTables({ Outfit: [] }, parsed);
    assert.deepEqual(diff.willDisable, [{ table: 'Outfit', text: 'a jacket' }]);
    assert.deepEqual(diff.alreadyMatching, []);
});

test('a duplicated bullet the preset does select is counted once as matching', () => {
    const parsed = [
        { name: 'Outfit', bullets: [
            { text: 'a jacket', weight: 1, enabled: true },
            { text: 'a jacket', weight: 1, enabled: true },
        ] },
    ];
    const diff = diffPresetAgainstTables({ Outfit: [{ text: 'a jacket', weight: 1 }] }, parsed);
    assert.deepEqual(diff.alreadyMatching, [{ table: 'Outfit', text: 'a jacket' }]);
    assert.deepEqual(diff.willReweight, []);
});

test('a reference whose group the preset never saw is left alone rather than disabled', () => {
    const parsed = [
        { name: 'Outfit', bullets: [
            { text: 'a jacket', weight: 1, enabled: true },
            { text: '=> Flight suits', weight: 1, enabled: true },
        ] },
        { name: 'Flight suits', bullets: [{ text: 'a flight suit', weight: 1, enabled: true }] },
    ];
    // Saved before the group existed: the flight suit was an Outfit bullet then.
    const old = { Outfit: [{ text: 'a jacket', weight: 1 }, { text: 'a flight suit', weight: 1 }] };
    const diff = diffPresetAgainstTables(old, parsed);
    assert.deepEqual(diff.willDisable, []);
    assert.deepEqual(diff.notFound, [{ table: 'Outfit', text: 'a flight suit' }]);
    assert.deepEqual(diff.alreadyMatching,
        [{ table: 'Outfit', text: 'a jacket' }, { table: 'Outfit', text: '=> Flight suits' }]);

    // A preset that DOES know the group and omits the reference means it.
    const knowing = { Outfit: [{ text: 'a jacket', weight: 1 }], 'Flight suits': [{ text: 'a flight suit', weight: 1 }] };
    assert.deepEqual(diffPresetAgainstTables(knowing, parsed).willDisable,
        [{ table: 'Outfit', text: '=> Flight suits' }]);
});
