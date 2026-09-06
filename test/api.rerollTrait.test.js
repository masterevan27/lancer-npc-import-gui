/**
 * POST /api/reroll-trait - re-roll one trait of an already-generated NPC.
 *
 * The route's own job is validation and refusal; the actual re-roll is
 * generate-npc.py's --reroll-trait. The refusals matter, and which ones apply
 * is a property of the NPC rather than of the server. An entry written before
 * the generator recorded raw bullets stores them with their flags stripped, so
 * a trait whose filters need another trait's flags cannot be re-rolled from it
 * - offering it anyway would produce a civilian in a service uniform rather
 * than an error. An entry that did record its raw bullets has those flags back
 * and re-rolls everything but the two halves of its name and Pronouns, Theme
 * included. generate-npc.py picks between the two lists per NPC and this route
 * has to pick the same way, or a button the page offered answers 400.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5202;

const TABLES_FIXTURE = [
    '## Role',
    '- a dockworker',
    '',
    '## Hair',
    '- a short {colour} crop',
    '',
].join('\n');

// A stub standing in for generate-npc.py, so the route can be exercised
// without a Python interpreter or a ComfyUI server. It only has to exist and
// exit; nothing here asserts on a rendered image.
// The constants are read out of this file by regex (see lib/overrideTables.js),
// so the stub carries a realistic set of them in a comment. Without them the
// derived lists are empty and every "does not offer X" assertion below passes
// on an empty array - true, but checking nothing. RAW_REROLLABLE_TRAITS is
// spelled as the comprehension the generator actually writes rather than as a
// literal tuple, because that shape is exactly what the parser has to cope
// with: there is no list of names in it to read, only an exclusion.
// TRAIT_DEPENDENTS is here for the same reason and reaches the client the same
// way: the page cannot tell a cascading re-roll from a lone one without it, and
// an empty map read from a stub missing it would let the route's shape pass
// while saying nothing.
const STUB = [
    '/*',
    'REQUIRED_TABLES = [',
    '    "Given names", "Family names", "Pronouns", "Theme", "Age", "Hair", "Eyes",',
    '    "Role", "Faction", "Outfit", "Weapon", "Gear", "Stance",',
    ']',
    'THEMED_TABLES = ("Hair", "Outfit", "Weapon")',
    'TRAIT_DEPENDENTS = {',
    '    "Theme": THEMED_TABLES,',
    '    "Role": ("Faction", "Outfit", "Weapon"),',
    '    "Outfit": ("Weapon", "Gear"),',
    '    "Weapon": ("Gear", "Stance"),',
    '}',
    'REROLLABLE_TRAITS = (',
    '    "Hair", "Eyes",',
    ')',
    'RAW_REROLLABLE_TRAITS = tuple(',
    '    name for name in REQUIRED_TABLES',
    '    if name not in ("Given names", "Family names", "Pronouns"))',
    '*/',
    'process.exit(0);',
].join('\n');

/**
 * A two-NPC manifest keyed the way generate-npc.py writes it, by absolute
 * folder path. Vela recorded her raw bullets and so re-rolls the wide list;
 * Rook predates rawTraits and gets the eleven. `kind: 'npc'` matters -
 * startRegenJob refuses anything else before it ever looks at the trait.
 */
function manifestFor(dir) {
    const entry = (name, extra) => [
        path.join(dir, 'output', 'Pilots', name),
        {
            id: `npc-${name.replace(/ /g, '-')}-1`,
            kind: 'npc',
            name,
            when: '2026-09-05 09:00:00',
            seed: 12345,
            traits: { Theme: 'rust and neon', Hair: 'a short crop' },
            ...extra,
        },
    ];
    return Object.fromEntries([
        entry('Vela Ostrom', { rawTraits: { Theme: 'rust and neon @theme', Hair: 'a short {colour} crop' } }),
        entry('Old Rook', {}),
    ]);
}

const RAW_ID = 'npc-Vela-Ostrom-1';
const LEGACY_ID = 'npc-Old-Rook-1';

/**
 * Written after the server is up, which works because loadManifest() re-reads
 * the file on every request. The seen store's one-time seed is the only thing
 * that cares about the manifest at startup, and nothing here asserts on it.
 */
function writeManifest(server, manifest) {
    fs.writeFileSync(server.manifestPath, JSON.stringify(manifest || manifestFor(server.dir)));
}

function rerollTrait(server, id, table) {
    return fetch(`${server.baseUrl}/api/reroll-trait`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, table }),
    });
}

test('an unknown item id is a 404', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/reroll-trait`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'npc-nobody-1', table: 'Hair' }),
    });
    assert.equal(res.status, 404);
});

test('a missing table is a 400', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/reroll-trait`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'npc-nobody-1' }),
    });
    // The id check runs first, so this is still a 404 for an unknown item -
    // what matters is that it is not a 202 and not a crash.
    assert.ok(res.status === 400 || res.status === 404, `got ${res.status}`);
});

test('malformed JSON is a 400 rather than a throw', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/reroll-trait`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: '{not json',
    });
    assert.equal(res.status, 400);
});

test('GET /api/npc-tables reports which traits can be re-rolled', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/npc-tables`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.tables));
    assert.deepEqual(body.rerollable, ['Hair', 'Eyes'],
        'the client needs this to decide which traits get a reroll button');
    // Both lists, because the client cannot know which applies until it has an
    // item in front of it. `rerollable` keeps its old name and its old meaning.
    assert.deepEqual(
        body.rawRerollable,
        ['Theme', 'Age', 'Hair', 'Eyes', 'Role', 'Faction', 'Outfit', 'Weapon', 'Gear', 'Stance'],
        'an entry with raw bullets re-rolls everything but the name halves and Pronouns');
});

test('GET /api/npc-tables reports how far each re-roll reaches', async (t) => {
    // The third thing the detail sheet needs, and the one the two lists above
    // cannot supply. Inferring a cascade from them - treating anything outside
    // the legacy eleven as one - warns on Faction, Weather and Stance, which
    // are keys in nothing, so each would raise a dialog about a change that
    // cannot happen and then name no trait it carries.
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const { dependents } = await (await fetch(`${server.baseUrl}/api/npc-tables`)).json();
    assert.deepEqual(dependents, {
        Theme: ['Hair', 'Outfit', 'Weapon'],
        Role: ['Faction', 'Outfit', 'Weapon'],
        Outfit: ['Weapon', 'Gear'],
        Weapon: ['Gear', 'Stance'],
    });
    // The edges, not a closure of them: the client walks it, and a flattening
    // sent from here could only ever be a second copy of that walk to drift
    // from. Theme reaches Gear and Stance through Outfit and Weapon.
    assert.ok(!dependents.Theme.includes('Gear'));
    assert.ok(!('Faction' in dependents), 'a trait that frees nothing has no entry at all');
});

test('the legacy list never offers a trait whose gates need stripped flags', async (t) => {
    // Read through the API rather than from the generator directly, so this
    // fails if the derivation ever starts handing the UI something the
    // generator would refuse.
    //
    // Scoped to `rerollable` on purpose. This is the guard that stopped the GUI
    // offering Outfit on an entry that cannot support it, and it is still true
    // of exactly that entry - but it is no longer true of every NPC, which is
    // what the counterpart below pins.
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const { rerollable } = await (await fetch(`${server.baseUrl}/api/npc-tables`)).json();
    assert.ok(rerollable.length, 'an empty list would pass every assertion below');
    for (const gated of ['Theme', 'Outfit', 'Weapon', 'Gear', 'Stance', 'Faction', 'Age', 'Role']) {
        assert.ok(!rerollable.includes(gated),
            `${gated} is gated by another trait's flags and must not be offered`);
    }
});

test('the raw list offers exactly the traits the stripped-flags rule refuses', async (t) => {
    // The counterpart. Those flags are in the entry, so the reason for the
    // refusal above is gone and the buttons have to appear - Theme most of all,
    // which is the re-roll the whole visual world of an NPC hangs off.
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const { rawRerollable } = await (await fetch(`${server.baseUrl}/api/npc-tables`)).json();
    assert.ok(rawRerollable.length, 'an empty list would pass every assertion below');
    for (const gated of ['Theme', 'Outfit', 'Weapon', 'Gear', 'Stance', 'Faction', 'Age', 'Role']) {
        assert.ok(rawRerollable.includes(gated),
            `${gated} is re-rollable from raw bullets and must be offered`);
    }
    for (const refused of ['Given names', 'Family names', 'Pronouns']) {
        assert.ok(!rawRerollable.includes(refused),
            `${refused} cannot be re-rolled in place, whatever the entry recorded`);
    }
});

test('Theme re-rolls on an entry with raw bullets and is refused on one without', async (t) => {
    // The bug this all comes from, end to end: Theme is re-rollable in the
    // generator and the GUI refused it for every NPC, because it read the
    // eleven-name list and Theme joined the other one.
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());
    writeManifest(server);

    assert.equal((await rerollTrait(server, RAW_ID, 'Theme')).status, 202,
        'an NPC that recorded its raw bullets can re-roll its Theme');

    const refused = await rerollTrait(server, LEGACY_ID, 'Theme');
    assert.equal(refused.status, 400, 'an entry without raw bullets cannot re-roll Theme');
    const { error } = await refused.json();
    // The set that applies to THIS entry, not the longer one. Printing the
    // twenty-two to the owner of an eleven-trait entry is the same lie in the
    // other direction, and generate-npc.py's matching refusal tells neither.
    assert.match(error, /Hair, Eyes/, 'the refusal must name the list this NPC actually has');
    assert.ok(!error.includes('Outfit'),
        'the refusal named the raw list to an NPC that cannot use it');
});

test('a recorded-but-empty rawTraits takes the legacy path', async (t) => {
    // Deliberate, and copied from generate-npc.py: an empty dict is not "raw
    // bullets, all of them nothing". Pinning nothing would re-roll the entire
    // NPC under the name of one trait, so the generator reads it as no raw
    // bullets at all and this must agree, or the button offered here meets a
    // refusal there.
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());
    const manifest = manifestFor(server.dir);
    manifest[path.join(server.dir, 'output', 'Pilots', 'Vela Ostrom')].rawTraits = {};
    writeManifest(server, manifest);

    assert.equal((await rerollTrait(server, RAW_ID, 'Theme')).status, 400);
    assert.equal((await rerollTrait(server, RAW_ID, 'Hair')).status, 202,
        'the eleven still re-roll on the legacy path');
});

test('/api/items reports which list each NPC gets', async (t) => {
    // The client needs this per item; the bullets themselves stay server-side,
    // since they run to kilobytes an entry and the grid polls every two
    // seconds.
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());
    writeManifest(server);

    const { items } = await (await fetch(`${server.baseUrl}/api/items?category=npc`)).json();
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    assert.equal(byId[RAW_ID].hasRawTraits, true);
    assert.equal(byId[LEGACY_ID].hasRawTraits, false);
    assert.ok(!('rawTraits' in byId[RAW_ID]), 'the raw bullets must not reach the client');
});
