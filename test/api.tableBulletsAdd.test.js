const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5261;
const NPC_TABLES = ['## Backdrop', '- A character portrait || on a rooftop', '', '## Eyes', '- pale grey eyes', ''].join('\n');
const SHIP_TABLES = ['## Backdrop', '- A ship || moored in a dock || dock', ''].join('\n');
const EXPRESSION_TABLES = ['## joy', '- x3 joy, a bright grin', ''].join('\n');
// Just enough of a generator for kinds.available() to offer the ship kind.
const SHIP_STUB = 'process.exit(0);\n';

async function withServer(t) {
    const server = await startTestServer({
        tablesText: NPC_TABLES,
        spaceshipTablesText: SHIP_TABLES,
        spaceshipGeneratorSource: SHIP_STUB,
        expressionTablesText: EXPRESSION_TABLES,
        port: PORT,
    });
    t.after(() => server.stop());
    return server;
}

function add(server, body) {
    return fetch(`${server.baseUrl}/api/table-bullets/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

async function bulletsOf(server, kind, table) {
    const res = await fetch(`${server.baseUrl}/api/table-bullets?kind=${kind}`);
    const { groups } = await res.json();
    return groups.flatMap((g) => g.rows.map((r) => r.table)).find((t) => t.name === table).bullets;
}

test('POST /api/table-bullets/add appends a custom value for every kind, into that kind\'s own file', async (t) => {
    const server = await withServer(t);
    const npcBefore = fs.readFileSync(server.tablesPath, 'utf8');
    const shipBefore = fs.readFileSync(server.spaceshipTablesPath, 'utf8');

    // A ship Backdrop shares its heading with the NPC one; it must not leak.
    let res = await add(server, { kind: 'spaceship', table: 'Backdrop', text: '  A ship || drifting past a moon || planetlight ', weight: 2 });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
        ok: true,
        bullet: { text: 'A ship || drifting past a moon || planetlight', weight: 2, enabled: true },
    });
    assert.equal(fs.readFileSync(server.tablesPath, 'utf8'), npcBefore);
    assert.deepEqual((await bulletsOf(server, 'spaceship', 'Backdrop')).at(-1),
        { text: 'A ship || drifting past a moon || planetlight', weight: 2, enabled: true });

    res = await add(server, { kind: 'expression', table: 'joy', text: 'joy, laughing with eyes shut' });
    assert.equal(res.status, 200);
    assert.deepEqual((await bulletsOf(server, 'expression', 'joy')).at(-1),
        { text: 'joy, laughing with eyes shut', weight: 1, enabled: true });
    assert.equal(fs.readFileSync(server.spaceshipTablesPath, 'utf8').includes('laughing'), false);

    res = await add(server, { kind: 'npc', table: 'Eyes', text: 'amber eyes' });
    assert.equal(res.status, 200);
    assert.deepEqual((await bulletsOf(server, 'npc', 'Eyes')).map((b) => b.text), ['pale grey eyes', 'amber eyes']);
    assert.notEqual(fs.readFileSync(server.spaceshipTablesPath, 'utf8'), shipBefore);
});

test('POST /api/table-bullets/add refuses duplicates, bad bodies and unknown tables with 400', async (t) => {
    const server = await withServer(t);
    const before = fs.readFileSync(server.tablesPath, 'utf8');
    for (const body of [
        { kind: 'npc', table: 'Eyes', text: 'pale grey eyes' },
        { kind: 'npc', table: 'Eyes', text: '' },
        { kind: 'npc', table: 'Eyes', text: 'new', weight: 0 },
        { kind: 'npc', table: 'Eyes' },
        { kind: 'npc', table: 'Nope', text: 'new' },
        { kind: 'nope', table: 'Eyes', text: 'new' },
    ]) {
        const res = await add(server, body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.ok((await res.json()).error, JSON.stringify(body));
    }
    assert.equal(fs.readFileSync(server.tablesPath, 'utf8'), before);
});
