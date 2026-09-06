const test = require('node:test');
const assert = require('node:assert');
const traitChoices = require('../lib/traitChoices');

const GOOD = JSON.stringify({
    trait: 'Outfit',
    current: 'a work jacket || civ',
    dependents: ['Headgear', 'Weapon', 'Gear'],
    choices: [
        {
            value: 'a work jacket || civ', heading: 'Outfit', allowed: true,
            current: true, conflicts: [], releases: [],
        },
        {
            value: 'a kimono || civ notac', heading: 'Outfit', allowed: true,
            current: false, conflicts: ['Headgear'], releases: ['Headgear'],
        },
    ],
});

test('choicesArgs builds the documented command line', () => {
    assert.deepStrictEqual(
        traitChoices.choicesArgs('/g/gen.py', '/g/m.json', 'npc-x-1', 'Outfit'),
        ['/g/gen.py', '--regen-manifest', '/g/m.json', '--regen-id', 'npc-x-1',
            '--trait-choices', 'Outfit'],
    );
});

test('choicesArgs refuses an empty trait', () => {
    assert.throws(() => traitChoices.choicesArgs('/g/gen.py', '/g/m.json', 'x', ''));
});

test('choicesArgs refuses an empty npc id', () => {
    assert.throws(() => traitChoices.choicesArgs('/g/gen.py', '/g/m.json', '', 'Outfit'));
});

test('parseChoicesOutput accepts the documented shape', () => {
    const got = traitChoices.parseChoicesOutput(GOOD);
    assert.strictEqual(got.trait, 'Outfit');
    assert.strictEqual(got.choices.length, 2);
    assert.deepStrictEqual(got.choices[1].conflicts, ['Headgear']);
});

test('parseChoicesOutput keeps a value\'s flags exactly as they arrived', () => {
    // The value is posted back and pasted into a prompt verbatim, so anything
    // on this path that tidies '|| civ notac' away is a real bug.
    const got = traitChoices.parseChoicesOutput(GOOD);
    assert.strictEqual(got.choices[1].value, 'a kimono || civ notac');
});

test('parseChoicesOutput rejects a truncated body', () => {
    assert.throws(() => traitChoices.parseChoicesOutput(GOOD.slice(0, 40)));
});

test('parseChoicesOutput rejects a body that is not the right shape', () => {
    assert.throws(() => traitChoices.parseChoicesOutput('{"trait":"Outfit"}'));
});

test('parseChoicesOutput rejects a choice missing a key', () => {
    // A generator that dropped `releases` would render a checkbox promising to
    // re-roll an empty set. Better a visible error than a dialog that lies.
    const bad = JSON.stringify({
        trait: 'Outfit',
        current: 'x',
        dependents: [],
        choices: [{ value: 'x', heading: 'Outfit', allowed: true }],
    });
    assert.throws(() => traitChoices.parseChoicesOutput(bad));
});

test('cacheKeyFor changes with the tables file', () => {
    const item = { id: 'npc-x-1', rawTraits: { Outfit: 'a || civ' } };
    const a = traitChoices.cacheKeyFor({ mtimeMs: 1, size: 2 }, item, 'Outfit');
    const b = traitChoices.cacheKeyFor({ mtimeMs: 9, size: 2 }, item, 'Outfit');
    assert.notStrictEqual(a, b);
});

test('cacheKeyFor changes when the NPC re-rolls', () => {
    // A regen rewrites the entry's bullets without touching the tables file,
    // so a key over the file alone would serve the previous NPC's legal values
    // - stale in exactly the situation the picker is most likely opened in.
    const stat = { mtimeMs: 1, size: 2 };
    const before = { id: 'npc-x-1', rawTraits: { Outfit: 'a || civ' } };
    const after = { id: 'npc-x-1', rawTraits: { Outfit: 'b || mil' } };
    assert.notStrictEqual(
        traitChoices.cacheKeyFor(stat, before, 'Outfit'),
        traitChoices.cacheKeyFor(stat, after, 'Outfit'),
    );
});

test('cacheKeyFor changes with the trait', () => {
    const stat = { mtimeMs: 1, size: 2 };
    const item = { id: 'npc-x-1', rawTraits: { Outfit: 'a || civ' } };
    assert.notStrictEqual(
        traitChoices.cacheKeyFor(stat, item, 'Outfit'),
        traitChoices.cacheKeyFor(stat, item, 'Hair'),
    );
});

test('cacheKeyFor changes with the NPC', () => {
    const stat = { mtimeMs: 1, size: 2 };
    const raw = { Outfit: 'a || civ' };
    assert.notStrictEqual(
        traitChoices.cacheKeyFor(stat, { id: 'npc-x-1', rawTraits: raw }, 'Outfit'),
        traitChoices.cacheKeyFor(stat, { id: 'npc-x-2', rawTraits: raw }, 'Outfit'),
    );
});

test('cacheKeyFor does not care what order the bullets were serialised in', () => {
    const stat = { mtimeMs: 1, size: 2 };
    const item = { id: 'npc-x-1', rawTraits: { Outfit: 'a || civ', Hair: 'b' } };
    const reordered = { id: 'npc-x-1', rawTraits: { Hair: 'b', Outfit: 'a || civ' } };
    assert.strictEqual(
        traitChoices.cacheKeyFor(stat, item, 'Outfit'),
        traitChoices.cacheKeyFor(stat, reordered, 'Outfit'),
    );
});

test('cacheKeyFor tolerates an entry with no raw bullets', () => {
    // The route refuses such an entry, but it computes the key first.
    const stat = { mtimeMs: 1, size: 2 };
    assert.doesNotThrow(
        () => traitChoices.cacheKeyFor(stat, { id: 'npc-x-1' }, 'Outfit'));
});
