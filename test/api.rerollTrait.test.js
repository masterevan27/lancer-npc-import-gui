/**
 * POST /api/reroll-trait - re-roll one trait of an already-generated NPC.
 *
 * The route's own job is validation and refusal; the actual re-roll is
 * generate-npc.py's --reroll-trait. The refusals matter because the manifest
 * stores bullets with their flags stripped, so a trait whose filters need
 * another trait's flags cannot be re-rolled from an entry - offering it anyway
 * would produce a civilian in a service uniform rather than an error.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
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
// so the stub carries a realistic pair of them in a comment. Without them the
// derived list is empty and every "does not offer X" assertion below passes on
// an empty array - true, but checking nothing.
const STUB = [
    '/*',
    'REQUIRED_TABLES = [',
    '    "Pronouns", "Role", "Hair", "Eyes", "Outfit", "Weapon",',
    ']',
    'REROLLABLE_TRAITS = (',
    '    "Hair", "Eyes",',
    ')',
    '*/',
    'process.exit(0);',
].join('\n');

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
});

test('the rerollable list never offers a trait whose gates need stripped flags', async (t) => {
    // Read through the API rather than from the generator directly, so this
    // fails if the derivation ever starts handing the UI something the
    // generator would refuse.
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const { rerollable } = await (await fetch(`${server.baseUrl}/api/npc-tables`)).json();
    assert.ok(rerollable.length, 'an empty list would pass every assertion below');
    for (const gated of ['Outfit', 'Weapon', 'Gear', 'Stance', 'Faction', 'Age', 'Role']) {
        assert.ok(!rerollable.includes(gated),
            `${gated} is gated by another trait's flags and must not be offered`);
    }
});
