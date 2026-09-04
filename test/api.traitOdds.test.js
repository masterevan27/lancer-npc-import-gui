const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

/*
 * GET /api/table-odds - the route, its cache, and its failure modes.
 *
 * Every generator here is a Node stub, not Python, and that is a hard
 * requirement rather than a convenience: CI runs ubuntu-latest, which ships
 * python3 but not reliably a bare `python`. startTestServer repoints
 * pythonExecutable at process.execPath so the stub runs as a real subprocess -
 * the server's spawning, streaming and exit handling are all genuinely
 * exercised, just without needing an interpreter.
 *
 * The stub records every invocation in spawns.log beside itself, which is how
 * the cache tests tell "served from cache" from "ran again".
 */

const PORT = 5203;

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '',
    '## Gear',
    '- a battered data-slate',
    '- x3 a canvas tool roll at the hip',
    '',
].join('\n');

/** A stub generator that logs its argv and prints a fixed odds report. */
const STUB = `
const fs = require('node:fs');
const path = require('node:path');
fs.appendFileSync(path.join(__dirname, 'spawns.log'), process.argv.slice(2).join(' ') + '\\n');
process.stdout.write(JSON.stringify({
    samples: 20000,
    tables: { Gear: { 'a battered data-slate': 0.25, 'a canvas tool roll at the hip': 0.75 } },
}));
`;

function spawnLog(server) {
    const file = path.join(server.dir, 'spawns.log');
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

const odds = (server) => fetch(`${server.baseUrl}/api/table-odds`).then((r) =>
    r.json().then((body) => ({ status: r.status, body })));

test('it returns the generator\'s odds', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const { status, body } = await odds(server);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.samples, 20000);
    assert.equal(body.tables.Gear['a canvas tool roll at the hip'], 0.75);
});

test('a second request with the tables file untouched does not run it again', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());

    await odds(server);
    await odds(server);
    assert.equal(spawnLog(server).length, 1);
});

test('editing the tables file runs it again', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());

    await odds(server);
    // Through the server's own write path, which is how every real change
    // reaches the odds - this is the whole of the reactivity story.
    await fetch(`${server.baseUrl}/api/table-bullets/set-weight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: 'Gear', text: 'a battered data-slate', weight: 5 }),
    });
    await odds(server);
    assert.equal(spawnLog(server).length, 2);
});

test('concurrent requests share one run', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const all = await Promise.all([odds(server), odds(server), odds(server)]);
    for (const { body } of all) assert.equal(body.ok, true);
    assert.equal(spawnLog(server).length, 1);
});

test('traitOddsSamples from config reaches the command line', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
        extraConfig: { traitOddsSamples: 1234 },
    });
    t.after(() => server.stop());

    await odds(server);
    assert.match(spawnLog(server)[0], /--trait-odds 1234$/);
});

test('a generator that exits non-zero is a reason, not a 500', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE,
        port: PORT,
        generatorSource: 'console.error("no module named x"); process.exit(1);\n',
    });
    t.after(() => server.stop());

    const { status, body } = await odds(server);
    assert.equal(status, 200);
    assert.equal(body.ok, false);
    assert.match(body.reason, /no module named x/);
});

test('a generator printing garbage is a reason, not a 500', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT,
        generatorSource: 'console.log("Traceback (most recent call last):");\n',
    });
    t.after(() => server.stop());

    const { status, body } = await odds(server);
    assert.equal(status, 200);
    assert.equal(body.ok, false);
    assert.match(body.reason, /Traceback/);
});

test('a missing generator names the path it looked in', async (t) => {
    // No generatorSource, so config.generateNpcScript is derived and the file
    // is not there. Someone reviewing staged imports has no reason to own a
    // copy of generate-npc.py, and must still get a working Tables page.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const { status, body } = await odds(server);
    assert.equal(status, 200);
    assert.equal(body.ok, false);
    assert.match(body.reason, /generate-npc\.py not found/);
});

test('a failed run is not cached, so fixing the cause is enough', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
    });
    t.after(() => server.stop());

    // Take the generator away, ask, then put it back and ask again with the
    // tables file untouched throughout. A cached failure would still be served
    // the second time - and the cause of a failure here is almost always
    // something fixed outside that file, so the fix would appear not to work.
    const script = path.join(server.dir, 'generate-npc.js');
    const source = fs.readFileSync(script, 'utf8');
    fs.rmSync(script);
    assert.equal((await odds(server)).body.ok, false);

    fs.writeFileSync(script, source);
    assert.equal((await odds(server)).body.ok, true);
});
