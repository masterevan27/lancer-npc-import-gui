const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5219;

function flatten(groups) {
    return groups.flatMap((g) => g.rows.map((r) => r.table));
}

function bulletsOf(tables, name) {
    return tables.find((t) => t.name === name).bullets;
}

const TABLES_FIXTURE = [
    '## Hair',
    '- a high, tight {colour} topknot || updo',
    '- x4 a short {colour} crop',
    '',
    '## Headgear',
    '- {Subject} {wear} a wide woven sedge hat.',
    '- {Subject} {wear} a sealed flight helmet. || hardtech helmet',
    '',
    '## Backdrop',
    '- A character portrait || {Subject} {is_are} on a rooftop at dusk || weather',
    '',
].join('\n');

async function setFlag(server, body) {
    return fetch(`${server.baseUrl}/api/table-bullets/set-flag`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

test('GET /api/table-bullets ships the flag vocabulary alongside the tables', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/table-bullets`);
    assert.equal(res.status, 200);
    const { groups, flags } = await res.json();
    assert.ok(groups, 'the grouped tables are still there');
    // One payload rather than two endpoints: the client needs the tables and
    // the vocabulary to draw a single row, and two fetches would let the
    // checkboxes render against a table list they do not match.
    assert.ok(flags.Headgear.crown, 'Headgear has no crown flag in the vocabulary');
    assert.ok(flags.Hair.updo);
    assert.equal(flags.Eyes, undefined, 'a table with no flags should have no entry');
});

test('POST set-flag adds a flag, reflected on the next GET', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const res = await setFlag(server, {
        table: 'Headgear',
        text: '{Subject} {wear} a wide woven sedge hat.',
        flag: 'crown',
        on: true,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    // The new text comes back because a flag edit changes the bullet's id -
    // a client still holding the old string would fail its next toggle.
    assert.equal(body.text, '{Subject} {wear} a wide woven sedge hat. || crown');

    const after = flatten((await (await fetch(`${server.baseUrl}/api/table-bullets`)).json()).groups);
    assert.ok(bulletsOf(after, 'Headgear').some(
        (b) => b.text === '{Subject} {wear} a wide woven sedge hat. || crown'));
});

test('POST set-flag clears a flag', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const res = await setFlag(server, {
        table: 'Hair', text: 'a high, tight {colour} topknot || updo', flag: 'updo', on: false,
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).text, 'a high, tight {colour} topknot');

    const after = flatten((await (await fetch(`${server.baseUrl}/api/table-bullets`)).json()).groups);
    assert.ok(bulletsOf(after, 'Hair').some((b) => b.text === 'a high, tight {colour} topknot'));
});

test('a flag edit through the API preserves weight and enabled state', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    await setFlag(server, {
        table: 'Hair', text: 'a short {colour} crop', flag: 'updo', on: true,
    });
    const after = flatten((await (await fetch(`${server.baseUrl}/api/table-bullets`)).json()).groups);
    const bullet = bulletsOf(after, 'Hair').find((b) => b.text.startsWith('a short'));
    assert.equal(bullet.weight, 4, 'the x4 prefix was lost');
    assert.equal(bullet.enabled, true);
});

test('a Backdrop flag edit through the API keeps the scene sentence', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const res = await setFlag(server, {
        table: 'Backdrop',
        text: 'A character portrait || {Subject} {is_are} on a rooftop at dusk || weather',
        flag: 'nogear',
        on: true,
    });
    assert.equal(res.status, 200);
    const { text } = await res.json();
    assert.match(text, /\{Subject\} \{is_are\} on a rooftop at dusk/);
    assert.equal(text.split('||').length, 3);
});

test('POST set-flag rejects a flag the table does not read', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const res = await setFlag(server, {
        table: 'Hair', text: 'a short {colour} crop', flag: 'helmet', on: true,
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /not a flag the Hair table reads/);
});

test('POST set-flag rejects a malformed body', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    for (const body of [
        {},
        { table: 'Hair', text: 'a short {colour} crop' },
        { table: 'Hair', text: 'a short {colour} crop', flag: 'updo' },
        { table: 'Hair', text: 'a short {colour} crop', flag: 'updo', on: 'yes' },
        { table: '', text: 'x', flag: 'updo', on: true },
    ]) {
        const res = await setFlag(server, body);
        assert.equal(res.status, 400, JSON.stringify(body));
    }
});

test('POST set-flag reports a bullet it cannot find', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const res = await setFlag(server, {
        table: 'Hair', text: 'no such bullet', flag: 'updo', on: true,
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /no bullet matching that text/);
});
