/**
 * The kind registry, unit-tested the way lib/paths.js is: no port, no fs.
 *
 * Every variation point in the server used to read a module-level constant.
 * This registry is the one new abstraction the spaceship work introduces, and
 * the table-driven completeness test below is what stops a third kind (Mechs,
 * which CATEGORY_LABELS already anticipates) being added with a field missing.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { derivePaths } = require('../lib/paths.js');
const kindsLib = require('../lib/kinds.js');

const CONFIG = {
    npcManifestPath: path.join('G:', 'gen', '.generated-npcs.json'),
    foundryNpcSubdir: 'LancerNPCs',
    foundrySpaceshipSubdir: 'LancerSpaceships',
    foundryNpcActorType: 'npc',
    foundrySpaceshipActorType: 'deployable',
};
const KINDS = kindsLib.buildKinds(derivePaths(CONFIG), CONFIG);

const REQUIRED_FIELDS = ['id', 'label', 'subject', 'script', 'tables',
    'presetsDir', 'createPresetsDir', 'createPresetDiscriminator',
    'stagedImportsDir', 'stagedRefsDir', 'foundrySubdir', 'supports',
    'createArgs', 'regenArgs'];

test('both kinds resolve and an unknown one does not', () => {
    assert.ok(kindsLib.kindFor(KINDS, 'npc'));
    assert.ok(kindsLib.kindFor(KINDS, 'spaceship'));
    assert.equal(kindsLib.kindFor(KINDS, 'mech'), null);
});

test('an entry with no kind falls back to npc', () => {
    // A manifest entry written by an older generator carries no `kind`. It
    // must not crash a route; it is an NPC, which is all there was.
    assert.equal(kindsLib.kindOf(KINDS, { kind: undefined }).id, 'npc');
    assert.equal(kindsLib.kindOf(KINDS, {}).id, 'npc');
    assert.equal(kindsLib.kindOf(KINDS, { kind: 'spaceship' }).id, 'spaceship');
});

test('requestKind prefers the body, then the query, then npc', () => {
    const url = new URL('http://x/api/items?kind=spaceship');
    assert.equal(kindsLib.requestKind(url, { kind: 'npc' }), 'npc');
    assert.equal(kindsLib.requestKind(url, {}), 'spaceship');
    assert.equal(kindsLib.requestKind(new URL('http://x/api/items'), {}), 'npc');
    assert.equal(kindsLib.requestKind(new URL('http://x/api/items'), null), 'npc');
});

test('every registry entry carries every field', () => {
    for (const [id, entry] of Object.entries(KINDS)) {
        for (const field of REQUIRED_FIELDS) {
            assert.ok(entry[field] !== undefined,
                `kind ${id} is missing ${field}`);
        }
    }
});

test('3D models are an NPC capability only, for now', () => {
    assert.equal(KINDS.npc.supports.model3d, true);
    assert.equal(KINDS.spaceship.supports.model3d, false);
});

test('animated portraits are an NPC capability only: the prompts describe a person', () => {
    assert.equal(KINDS.npc.supports.animate, true);
    assert.equal(KINDS.spaceship.supports.animate, false);
});

test('the ship create argv passes --manifest and never a person flag', () => {
    const argv = KINDS.spaceship.createArgs({
        count: 2, seed: 7, manifestPath: CONFIG.npcManifestPath,
        overrides: [{ table: 'Ship type', value: 'a blunt-nosed bulk hauler' }],
    });
    assert.ok(argv.includes('--manifest'));
    assert.ok(argv.includes('--set-trait'));
    assert.ok(argv.includes('Ship type=a blunt-nosed bulk hauler'));
    assert.ok(!argv.includes('--pronouns'));
    assert.ok(!argv.includes('--unarmed'));
});

test('--out-root is emitted only when configured', () => {
    const base = { count: 1, manifestPath: CONFIG.npcManifestPath, overrides: [] };
    assert.ok(!KINDS.spaceship.createArgs(base).includes('--out-root'));
    const withRoot = KINDS.spaceship.createArgs({ ...base, outputRoot: 'D:/ships' });
    assert.ok(withRoot.includes('--out-root'));
    assert.ok(withRoot.includes('D:/ships'));
});

test('the two kinds use different create-preset discriminators', () => {
    // So a ship preset dropped on the NPC tab's Import button is refused by the
    // check that already exists, rather than half-applied.
    assert.notEqual(KINDS.npc.createPresetDiscriminator,
        KINDS.spaceship.createPresetDiscriminator);
});

test('the ship regen argv is the NPC one with the script swapped', () => {
    const opts = { manifestPath: 'M', id: 'ship-x-1', newSeed: 99, which: 'both' };
    const argv = KINDS.spaceship.regenArgs(opts);
    assert.ok(argv.includes('--regen-manifest'));
    assert.ok(argv.includes('--regen-id'));
    assert.ok(argv.includes('ship-x-1'));
    assert.ok(argv.includes('--new-seed'));
    assert.ok(!argv.includes('--no-token'));
    assert.ok(KINDS.spaceship.regenArgs({ ...opts, which: 'portrait' })
        .includes('--no-token'));
    assert.ok(KINDS.spaceship.regenArgs({ ...opts, which: 'token' })
        .includes('--no-portrait'));
});
