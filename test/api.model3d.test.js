/**
 * The three routes behind the detail overlay's 3D panel.
 *
 *   GET  /api/model-3d        - what has already been built for one NPC
 *   POST /api/model-3d        - start a build
 *   GET  /api/model-3d-image  - serve one turnaround PNG
 *
 * The listing is a separate route rather than a field on /api/items on
 * purpose: itemView runs for every NPC on every poll, and a readdir of each
 * NPC's 3d/ folder there would cost one directory read per NPC per poll
 * across the whole catalogue. Only the overlay needs the file list, and only
 * when it is open, so only the overlay asks. /api/items carries one boolean.
 *
 * /api/model-3d-image is the first route in this server that takes a
 * caller-supplied filename - /api/image picks the name off the manifest entry
 * - so the traversal tests below are guarding something new rather than
 * restating an existing guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5205;

const TABLES_FIXTURE = [
    '## Role',
    '- a dockworker',
    '',
].join('\n');

// Stands in for generate-3d.py. Plain Node, run through process.execPath, so
// the route's argv building can be asserted on with no Python interpreter -
// the same trick api.createArgs.test.js uses for generate-npc.py.
const STUB_3D = [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'fs.writeFileSync(path.join(__dirname, "argv.json"), JSON.stringify(process.argv.slice(2)));',
    'process.exit(0);',
].join('\n');

// Exits non-zero after printing, so the route's failure path can be asserted on.
const STUB_3D_FAILS = [
    'process.stdout.write("    assembling ...\\n");',
    'process.stderr.write("Blender not found\\n");',
    'process.exit(3);',
].join('\n');

const NPC_NAME = 'Jules Sokolova';
const NPC_ID = 'npc-Jules-Sokolova-3958386534';

/**
 * Writes an NPC into the fixture manifest and returns its folder. The server
 * re-reads the manifest on every request (see loadManifest), so this works
 * after the server is already up.
 */
function seedNpc(server, { withModel = false, extraFiles = [] } = {}) {
    const folder = path.join(server.dir, 'output', 'Pilots', NPC_NAME);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${NPC_NAME} Portrait.png`), 'png');
    fs.writeFileSync(path.join(server.dir, '.generated-npcs.json'), JSON.stringify({
        [folder]: {
            id: NPC_ID,
            kind: 'npc',
            name: NPC_NAME,
            callsign: 'Legal',
            seed: 3958386534,
            when: '2026-09-05T01-33-00',
            traits: { Role: 'a dockworker' },
            portrait: `${NPC_NAME} Portrait.png`,
            files: [`${NPC_NAME} Portrait.png`],
        },
    }));
    if (withModel) {
        const dir = path.join(folder, '3d');
        fs.mkdirSync(dir, { recursive: true });
        for (const file of [
            `${NPC_NAME} Shell.glb`,
            `${NPC_NAME} Print.stl`,
            `${NPC_NAME} Turnaround_000.png`,
            `${NPC_NAME} Turnaround_090.png`,
            `${NPC_NAME} Turnaround_180.png`,
            `${NPC_NAME} Turnaround_270.png`,
            '_shell.glb',
            'apose.png',
            ...extraFiles,
        ]) fs.writeFileSync(path.join(dir, file), file);
    }
    return folder;
}

function startWith() {
    return startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
}

/**
 * The stub has to live somewhere the config can point at, and the config is
 * written before the fixture dir is known to the test - so write the stub
 * into the fixture dir and repoint the config through a second server start
 * is not an option. Instead the stub is written first, into a temp dir the
 * test owns, and passed as an absolute path.
 */
function startWithStub(t, source) {
    const stubDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'model3d-stub-'));
    const stub = path.join(stubDir, 'generate-3d.js');
    fs.writeFileSync(stub, source);
    // Tolerant, because Windows will not unlink a script a child process is
    // still executing - a test that deliberately leaves a build running gets
    // EPERM here, and a leaked directory under the OS temp dir is not worth
    // failing a passing test over.
    t.after(() => {
        try {
            fs.rmSync(stubDir, { recursive: true, force: true });
        } catch { /* the child outlived the test; the OS will reap it */ }
    });
    return {
        stubDir,
        server: startTestServer({
            tablesText: TABLES_FIXTURE,
            port: PORT,
            extraConfig: { generate3dScript: stub, pythonExecutable: process.execPath },
        }),
    };
}

/** Polls /api/model-3d until the job leaves 'running', or gives up. */
async function settle(baseUrl, id) {
    for (let i = 0; i < 100; i++) {
        const body = await (await fetch(`${baseUrl}/api/model-3d?id=${encodeURIComponent(id)}`)).json();
        if (body.status && body.status !== 'running') return body;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('the 3D job never left "running"');
}

/* ---- GET /api/model-3d ---- */

test('an unknown item id is a 404', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/model-3d?id=npc-nobody-1`);
    assert.equal(res.status, 404);
});

test('an NPC with no 3d/ folder reports no model rather than an error', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());
    seedNpc(server);

    const res = await fetch(`${server.baseUrl}/api/model-3d?id=${encodeURIComponent(NPC_ID)}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.shell, null);
    assert.deepEqual(body.turnarounds, []);
    assert.equal(body.status, null, 'no job has ever run for this NPC');
});

test('the listing names the deliverables and hides the intermediates', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());
    seedNpc(server, { withModel: true });

    const body = await (await fetch(
        `${server.baseUrl}/api/model-3d?id=${encodeURIComponent(NPC_ID)}`)).json();
    assert.equal(body.shell, `${NPC_NAME} Shell.glb`);
    assert.equal(body.print, `${NPC_NAME} Print.stl`);
    assert.equal(body.rigged, null);
    assert.equal(body.turnarounds.length, 4);
    assert.ok(!JSON.stringify(body).includes('_shell.glb'), '_shell.glb is an intermediate');
    assert.ok(!JSON.stringify(body).includes('apose.png'), 'apose.png is the input, not output');
});

test('the listing carries a build time, so the panel can say when', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());
    seedNpc(server, { withModel: true });

    const body = await (await fetch(
        `${server.baseUrl}/api/model-3d?id=${encodeURIComponent(NPC_ID)}`)).json();
    assert.ok(Number.isFinite(body.builtAt) && body.builtAt > 0, `got ${body.builtAt}`);
});

/* ---- /api/items ---- */

test('/api/items says whether an NPC has a model, without listing its files', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());
    seedNpc(server);

    const before = await (await fetch(`${server.baseUrl}/api/items?category=npc`)).json();
    const item = before.items.find((i) => i.id === NPC_ID);
    assert.equal(item.has3d, false);
    assert.ok(!('turnarounds' in item),
        'the file list belongs to /api/model-3d - itemView runs for every NPC on every poll');

    seedNpc(server, { withModel: true });
    const after = await (await fetch(`${server.baseUrl}/api/items?category=npc`)).json();
    assert.equal(after.items.find((i) => i.id === NPC_ID).has3d, true);
});

/* ---- POST /api/model-3d ---- */

test('malformed JSON is a 400 rather than a throw', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/model-3d`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json',
    });
    assert.equal(res.status, 400);
});

test('starting a build for an unknown id is a 404', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/model-3d`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'npc-nobody-1' }),
    });
    assert.equal(res.status, 404);
});

test('a build passes --id, and neither --rig nor --overwrite by default', async (t) => {
    const { stubDir, server: pending } = startWithStub(t, STUB_3D);
    const server = await pending;
    t.after(() => server.stop());
    seedNpc(server);

    const res = await fetch(`${server.baseUrl}/api/model-3d`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: NPC_ID }),
    });
    assert.equal(res.status, 202);
    await settle(server.baseUrl, NPC_ID);

    const argv = JSON.parse(fs.readFileSync(path.join(stubDir, 'argv.json'), 'utf8'));
    assert.deepEqual(argv, ['--id', NPC_ID]);
});

test('rig and overwrite reach the command line when asked for', async (t) => {
    const { stubDir, server: pending } = startWithStub(t, STUB_3D);
    const server = await pending;
    t.after(() => server.stop());
    seedNpc(server);

    await fetch(`${server.baseUrl}/api/model-3d`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: NPC_ID, rig: true, overwrite: true }),
    });
    await settle(server.baseUrl, NPC_ID);

    const argv = JSON.parse(fs.readFileSync(path.join(stubDir, 'argv.json'), 'utf8'));
    assert.deepEqual(argv, ['--id', NPC_ID, '--rig', '--overwrite']);
});

test('a failed build surfaces the generator\'s own output, not just an exit code', async (t) => {
    const { server: pending } = startWithStub(t, STUB_3D_FAILS);
    const server = await pending;
    t.after(() => server.stop());
    seedNpc(server);

    await fetch(`${server.baseUrl}/api/model-3d`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: NPC_ID }),
    });
    const done = await settle(server.baseUrl, NPC_ID);
    assert.equal(done.status, 'error');
    assert.match(done.error, /Blender not found/);
});

test('a second build for the same NPC is refused while the first is running', async (t) => {
    // Two generate-3d.py runs on one NPC write the same files. The loser does
    // not fail - it interleaves, and the output is a mix of two runs.
    const { server: pending } = startWithStub(t, [
        'setTimeout(() => process.exit(0), 3000);',
    ].join('\n'));
    const server = await pending;
    t.after(() => server.stop());
    seedNpc(server);

    const start = () => fetch(`${server.baseUrl}/api/model-3d`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: NPC_ID }),
    });
    assert.equal((await start()).status, 202);
    const second = await start();
    assert.equal(second.status, 409);
    assert.match((await second.json()).error, /already/i);

    // Let the first build finish rather than leaving a child process behind
    // for the next test - and for the stub directory's own teardown.
    await settle(server.baseUrl, NPC_ID);
});

test('the panel can see which stage a running build reached', async (t) => {
    const { server: pending } = startWithStub(t, [
        'process.stdout.write("    A-pose render ...\\n");',
        'process.stdout.write("    assembling ...\\n");',
        'setTimeout(() => process.exit(0), 2000);',
    ].join('\n'));
    const server = await pending;
    t.after(() => server.stop());
    seedNpc(server);

    await fetch(`${server.baseUrl}/api/model-3d`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: NPC_ID }),
    });
    // A reconstruction runs for minutes; a bare spinner for that long is
    // indistinguishable from a hang, so the last line the generator printed
    // is what the status text shows.
    let stage = null;
    for (let i = 0; i < 60 && !stage; i++) {
        const body = await (await fetch(
            `${server.baseUrl}/api/model-3d?id=${encodeURIComponent(NPC_ID)}`)).json();
        stage = body.stage;
        if (!stage) await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(stage, 'assembling ...');
});

/* ---- GET /api/model-3d-image ---- */

test('a turnaround is served as a PNG', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());
    seedNpc(server, { withModel: true });

    const res = await fetch(`${server.baseUrl}/api/model-3d-image`
        + `?id=${encodeURIComponent(NPC_ID)}&file=${encodeURIComponent(`${NPC_NAME} Turnaround_090.png`)}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /image\/png/);
    assert.equal(await res.text(), `${NPC_NAME} Turnaround_090.png`);
});

test('a file outside the NPC\'s own 3d/ folder is refused', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());
    const folder = seedNpc(server, { withModel: true });
    fs.writeFileSync(path.join(server.dir, 'secret.txt'), 'not yours');

    for (const file of [
        '../../../secret.txt',
        '..\\..\\..\\secret.txt',
        `../${NPC_NAME} Portrait.png`,
        'sub/nested.png',
        path.join(server.dir, 'secret.txt'),
    ]) {
        const res = await fetch(`${server.baseUrl}/api/model-3d-image`
            + `?id=${encodeURIComponent(NPC_ID)}&file=${encodeURIComponent(file)}`);
        assert.equal(res.status, 400, `${file} should be refused, got ${res.status}`);
    }
    assert.ok(fs.existsSync(folder), 'fixture intact');
});

test('only this NPC\'s own deliverables are servable', async (t) => {
    // The intermediates sit in the same folder. Serving them is harmless but
    // the panel never names one, so a request for one is a bug or a probe.
    const server = await startWith();
    t.after(() => server.stop());
    seedNpc(server, { withModel: true });

    for (const file of ['_shell.glb', 'apose.png', 'Lucia Vos Turnaround_000.png']) {
        const res = await fetch(`${server.baseUrl}/api/model-3d-image`
            + `?id=${encodeURIComponent(NPC_ID)}&file=${encodeURIComponent(file)}`);
        assert.equal(res.status, 404, `${file} should not be servable, got ${res.status}`);
    }
});

test('a turnaround URL changes when the file does, so a rebuild is not shown stale', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());
    const folder = seedNpc(server, { withModel: true });

    const url = `${server.baseUrl}/api/model-3d?id=${encodeURIComponent(NPC_ID)}`;
    const before = (await (await fetch(url)).json()).turnaroundUrls[0];

    const png = path.join(folder, '3d', `${NPC_NAME} Turnaround_000.png`);
    fs.writeFileSync(png, 'rebuilt');
    fs.utimesSync(png, new Date(), new Date(Date.now() + 5000));

    const after = (await (await fetch(url)).json()).turnaroundUrls[0];
    assert.notEqual(after, before, 'the version stamp must move with the file');
});
