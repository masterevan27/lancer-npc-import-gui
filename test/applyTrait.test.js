const test = require('node:test');
const assert = require('node:assert');
const applyTrait = require('../lib/applyTrait');

const GOOD = JSON.stringify({
    id: 'npc-x-1',
    traits: { Outfit: 'a kimono', Headgear: 'nothing' },
    rawTraits: { Outfit: 'a kimono || civ notac' },
    artStale: true,
});

test('applyArgs builds the documented re-roll command line', () => {
    assert.deepStrictEqual(
        applyTrait.applyArgs('/g/gen.py', '/g/m.json', 'npc-x-1',
            { op: 'reroll', table: 'Outfit', seed: 7 }),
        ['/g/gen.py', '--regen-manifest', '/g/m.json', '--regen-id', 'npc-x-1',
            '--apply-only', '--new-seed', '7', '--reroll-trait', 'Outfit'],
    );
});

test('applyArgs builds the documented set command line', () => {
    assert.deepStrictEqual(
        applyTrait.applyArgs('/g/gen.py', '/g/m.json', 'npc-x-1',
            { op: 'set', table: 'Outfit', value: 'a kimono || civ notac', seed: 7 }),
        ['/g/gen.py', '--regen-manifest', '/g/m.json', '--regen-id', 'npc-x-1',
            '--apply-only', '--new-seed', '7', '--set-trait', 'Outfit=a kimono || civ notac'],
    );
});

test('applyArgs never asks for a render', () => {
    // The whole point of the flag. --no-portrait/--no-token would be the wrong
    // way to say it too: --apply-only returns before any render decision is
    // read, and the generator refuses those two together.
    const args = applyTrait.applyArgs('/g/gen.py', '/g/m.json', 'npc-x-1',
        { op: 'reroll', table: 'Hair', seed: 1 });
    assert.ok(args.includes('--apply-only'));
    assert.ok(!args.includes('--no-portrait'));
    assert.ok(!args.includes('--no-token'));
});

test('applyArgs appends --release only when something was ticked', () => {
    const withRelease = applyTrait.applyArgs('/g/gen.py', '/g/m.json', 'npc-x-1',
        { op: 'set', table: 'Outfit', value: 'a kimono || civ notac', release: ['Headgear', 'Gear'], seed: 1 });
    assert.ok(withRelease.join(' ').includes('--release Headgear,Gear'));

    for (const release of [[], undefined]) {
        const args = applyTrait.applyArgs('/g/gen.py', '/g/m.json', 'npc-x-1',
            { op: 'set', table: 'Outfit', value: 'a kimono || civ notac', release, seed: 1 });
        assert.ok(!args.includes('--release'),
            'nothing else moves unless it was asked for');
    }
});

test('applyArgs keeps a value\'s flags exactly as they arrived', () => {
    // Same rule the picker's own parser keeps: the bullet is pasted into an
    // image prompt verbatim, flags included, and those flags are what the
    // downstream filters read.
    const args = applyTrait.applyArgs('/g/gen.py', '/g/m.json', 'npc-x-1',
        { op: 'set', table: 'Outfit', value: 'a kimono || civ notac', seed: 1 });
    assert.ok(args.includes('Outfit=a kimono || civ notac'));
});

test('applyArgs refuses an empty npc id', () => {
    assert.throws(() => applyTrait.applyArgs('/g/gen.py', '/g/m.json', '',
        { op: 'reroll', table: 'Outfit', seed: 1 }));
});

test('applyArgs refuses an empty table', () => {
    assert.throws(() => applyTrait.applyArgs('/g/gen.py', '/g/m.json', 'npc-x-1',
        { op: 'reroll', table: '', seed: 1 }));
});

test('applyArgs refuses an op it does not know', () => {
    assert.throws(() => applyTrait.applyArgs('/g/gen.py', '/g/m.json', 'npc-x-1',
        { op: 'delete', table: 'Outfit', seed: 1 }));
});

test('applyArgs refuses a set with no value', () => {
    assert.throws(() => applyTrait.applyArgs('/g/gen.py', '/g/m.json', 'npc-x-1',
        { op: 'set', table: 'Outfit', seed: 1 }));
});

test('applyArgs refuses a seed that is not an integer', () => {
    // Without a real one the generator falls back to the entry's own seed, so
    // re-rolling the same trait twice would draw the same value both times -
    // which reads as "the button does nothing".
    assert.throws(() => applyTrait.applyArgs('/g/gen.py', '/g/m.json', 'npc-x-1',
        { op: 'reroll', table: 'Outfit' }));
});

test('parseApplyOutput accepts the documented shape', () => {
    const got = applyTrait.parseApplyOutput(GOOD);
    assert.strictEqual(got.id, 'npc-x-1');
    assert.strictEqual(got.traits.Outfit, 'a kimono');
    assert.strictEqual(got.artStale, true);
});

test('parseApplyOutput names the flag when stdout is not JSON', () => {
    // The likeliest cause is a diagnostic printed to stdout instead of stderr
    // - the cascade report especially - and that is worth saying out loud
    // rather than swallowing into an empty trait table.
    assert.throws(
        () => applyTrait.parseApplyOutput("re-rolled Outfit: 'a jacket' -> 'a kimono'"),
        /--apply-only/,
    );
});

test('parseApplyOutput rejects a payload with no traits', () => {
    assert.throws(
        () => applyTrait.parseApplyOutput('{"id":"npc-x-1","artStale":true}'),
        /traits/,
    );
});

test('parseApplyOutput rejects traits that are not an object', () => {
    assert.throws(() => applyTrait.parseApplyOutput(
        '{"id":"npc-x-1","traits":["Outfit"],"artStale":true}'));
    assert.throws(() => applyTrait.parseApplyOutput(
        '{"id":"npc-x-1","traits":"Outfit","artStale":true}'));
});
