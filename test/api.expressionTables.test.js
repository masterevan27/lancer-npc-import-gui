const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5253;
const NPC_TABLES = '## Role\n- dockworker\n';
const EXPRESSION_TABLES = ['## Joy', '- a bright grin', '', '## Anger', '- a hard glare', ''].join('\n');

async function withServer(t, extra = {}) {
    const server = await startTestServer({
        tablesText: NPC_TABLES,
        expressionTablesText: EXPRESSION_TABLES,
        port: PORT,
        ...extra,
    });
    t.after(() => server.stop());
    return server;
}

test('installed expression tables are available only to Tables, without a generator or Import category', async (t) => {
    const server = await withServer(t);
    const categories = await (await fetch(`${server.baseUrl}/api/categories`)).json();
    assert.ok(categories.kinds.includes('expression'));
    assert.ok(!categories.kinds.includes('npc'), 'a missing NPC script remains unavailable');
    assert.ok(!categories.categories.some((category) => category.id === 'expression'));

    const tables = await fetch(`${server.baseUrl}/api/table-bullets?kind=expression`);
    assert.equal(tables.status, 200);
    const body = await tables.json();
    assert.deepEqual(body.groups.flatMap((group) => group.rows.map((row) => row.table.name)), ['Joy', 'Anger']);
    assert.equal(body.capabilities.odds, false);
});

test('expression table edits and presets stay in their own file and preset directory', async (t) => {
    const server = await withServer(t);
    const npcBefore = fs.readFileSync(server.tablesPath, 'utf8');
    const expressionBefore = fs.readFileSync(server.expressionTablesPath, 'utf8');
    const toggle = await fetch(`${server.baseUrl}/api/table-bullets/toggle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'expression', table: 'Joy', text: 'a bright grin', enabled: false }),
    });
    assert.equal(toggle.status, 200);
    assert.equal(fs.readFileSync(server.tablesPath, 'utf8'), npcBefore);
    assert.notEqual(fs.readFileSync(server.expressionTablesPath, 'utf8'), expressionBefore);

    const saved = await fetch(`${server.baseUrl}/api/presets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'expression', name: 'Expression Set' }),
    });
    assert.equal(saved.status, 200);
    assert.ok(fs.existsSync(path.join(server.expressionPresetsDir, 'expression-set.json')));
    const listed = await (await fetch(`${server.baseUrl}/api/presets?kind=expression`)).json();
    assert.equal(listed.presets[0].slug, 'expression-set');
});

test('expression rejects odds, create helpers, and staging before any absent path is read', async (t) => {
    const server = await withServer(t);
    for (const request of [
        ['/api/table-odds?kind=expression', {}],
        ['/api/npc-tables?kind=expression', {}],
        ['/api/trait-options?kind=expression', {}],
        ['/api/pronouns?kind=expression', {}],
        ['/api/create-presets?kind=expression', {}],
        ['/api/trait-candidates?kind=expression', {}],
        ['/api/trait-image?kind=expression&file=x&id=y', {}],
        ['/api/trait-candidates/import', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'expression', items: [] }),
        }],
        ['/api/create', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'expression' }),
        }],
    ]) {
        const response = await fetch(`${server.baseUrl}${request[0]}`, request[1]);
        assert.equal(response.status, 400, `${request[0]} must refuse a tables-only kind`);
    }
});

test('a malformed expression manifest row cannot become an Import item or Foundry job', async (t) => {
    const server = await withServer(t);
    const source = path.join(server.dir, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'portrait.png'), 'image');
    fs.writeFileSync(server.manifestPath, JSON.stringify({
        [source]: { id: 'expression-row', kind: 'expression', name: 'Not an NPC', files: ['portrait.png'] },
    }));

    const categories = await (await fetch(`${server.baseUrl}/api/categories`)).json();
    assert.ok(!categories.categories.some((category) => category.id === 'expression'));
    assert.equal((await fetch(`${server.baseUrl}/api/items?category=expression`)).status, 400);
    const imported = await (await fetch(`${server.baseUrl}/api/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['expression-row'] }),
    })).json();
    assert.deepEqual(imported.results, [{ id: 'expression-row', queued: false, reason: 'kind cannot be imported' }]);
});
