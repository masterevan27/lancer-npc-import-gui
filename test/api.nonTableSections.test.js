const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

const TABLES_FIXTURE = [
    '## How the script reads this file',
    '',
    'Every `## Heading` starts a table.',
    '',
    '- **Age** and **Build** bullets carry a paired flag.',
    '',
    '## Gear',
    '- a battered data-slate',
    '- a canvas tool roll at the hip',
    '',
].join('\n');

test('GET /api/table-bullets does not serve the documentation section', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5194 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/table-bullets`);
    const { groups } = await res.json();
    assert.deepEqual(groups.flatMap((g) => g.rows.map((r) => r.table.name)), ['Gear']);
});

test('POST /api/table-bullets/toggle rejects a write to the documentation section', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5194 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/table-bullets/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            table: 'How the script reads this file',
            text: '**Age** and **Build** bullets carry a paired flag.',
            enabled: false,
        }),
    });
    assert.equal(res.status, 400);
});

test('POST /api/table-bullets/set-weight rejects a write to the documentation section', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5194 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/table-bullets/set-weight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            table: 'How the script reads this file',
            text: '**Age** and **Build** bullets carry a paired flag.',
            weight: 2,
        }),
    });
    assert.equal(res.status, 400);
});

test('an ordinary roll table is still editable', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5194 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/table-bullets/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: 'Gear', text: 'a battered data-slate', enabled: false }),
    });
    assert.equal(res.status, 200);
});
