const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '- he/him/his/man',
    '',
    '## Gear',
    '- a battered data-slate',
    '',
].join('\n');

test('GET /api/pronouns returns the subjects from the tables file', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5195 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/pronouns`);
    assert.equal(res.status, 200);
    const { subjects } = await res.json();
    assert.deepEqual(subjects, ['she', 'he']);
});

test('POST /api/create-npc rejects a pronoun the tables file does not offer', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5195 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/create-npc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1, pronouns: 'they', dryRun: true }),
    });
    assert.equal(res.status, 400);
    const { error } = await res.json();
    assert.match(error, /pronoun/i);
});

test('POST /api/create-npc accepts a pronoun the tables file does offer', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5195 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/create-npc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1, pronouns: 'she', dryRun: true }),
    });
    // 202 when the generator script is present, 409 when it is not - either
    // way the pronoun passed validation, which is what this asserts.
    assert.notEqual(res.status, 400);
});
