/**
 * The four routes behind the detail overlay's Animated portrait panel.
 *
 *   GET  /api/animation              - the loop on disk, its record, the table
 *   POST /api/animation              - start a render
 *   POST /api/animation/description  - stage the next loop's description
 *   GET  /api/animation-image        - serve the loop
 *
 * animate-portrait.py is stood in for by a Node stub, the way generate-3d.py
 * is in api.model3d.test.js, so the argv the server builds and the sidecar it
 * writes can be asserted on without Python, ComfyUI or a Wan render.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5234;

const DESCRIPTIONS = [
    'the wind moves their hair. the camera does not move.',
    'smoke drifts by behind them. the camera does not move.',
    'snow falls and settles on their shoulders. the camera does not move.',
];

const TABLES_FIXTURE = [
    '## Role',
    '- a dockworker',
    '',
    '## Animation',
    ...DESCRIPTIONS.map((d) => `- ${d}`),
    '<!-- - a switched-off one. the camera does not move. -->',
    '',
].join('\n');

// Records its argv beside itself and writes the --out file, so a "render"
// leaves exactly what the real script would: a .webp where it was told.
const STUB = [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const argv = process.argv.slice(2);',
    'fs.writeFileSync(path.join(__dirname, "argv.json"), JSON.stringify(argv));',
    'process.stdout.write("  uploading...\\n");',
    'fs.writeFileSync(argv[argv.indexOf("--out") + 1], "RIFF-webp-bytes");',
    'process.exit(0);',
].join('\n');

const STUB_FAILS = [
    'process.stdout.write("  queued 1234\\n");',
    'process.stderr.write("RuntimeError: hostbuf_file_reader_read failed\\n");',
    'process.exit(1);',
].join('\n');

// Stays running long enough for a second request to find it so.
const STUB_SLOW = 'setTimeout(() => process.exit(0), 1500);';

const NPC_NAME = 'Jules Sokolova';
const NPC_ID = 'npc-Jules-Sokolova-3958386534';
const SHIP_ID = 'spaceship-Vega-1';

function seedNpc(server, { kind = 'npc', id = NPC_ID, withPortrait = true } = {}) {
    const folder = path.join(server.dir, 'output', 'Pilots', NPC_NAME);
    fs.mkdirSync(folder, { recursive: true });
    if (withPortrait) fs.writeFileSync(path.join(folder, `${NPC_NAME} Portrait.png`), 'png');
    // A token too: queueImport derives the Foundry-relative token path
    // unconditionally, so an import of a portrait-only fixture is a 500 that
    // has nothing to do with animation.
    fs.writeFileSync(path.join(folder, `${NPC_NAME} Token.png`), 'png');
    const manifest = JSON.parse(fs.readFileSync(path.join(server.dir, '.generated-npcs.json'), 'utf8'));
    manifest[folder] = {
        id, kind, name: NPC_NAME, callsign: 'Legal', seed: 3958386534,
        when: '2026-09-05T01-33-00', traits: { Role: 'a dockworker' },
        portrait: `${NPC_NAME} Portrait.png`, token: `${NPC_NAME} Token.png`,
        files: [`${NPC_NAME} Portrait.png`, `${NPC_NAME} Token.png`],
    };
    fs.writeFileSync(path.join(server.dir, '.generated-npcs.json'), JSON.stringify(manifest));
    return folder;
}

function startWith(extraConfig) {
    return startTestServer({ tablesText: TABLES_FIXTURE, port: PORT, extraConfig });
}

function startWithStub(t, source, { generatorSource } = {}) {
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animate-stub-'));
    const stub = path.join(stubDir, 'animate-portrait.js');
    fs.writeFileSync(stub, source);
    t.after(() => {
        try {
            fs.rmSync(stubDir, { recursive: true, force: true });
        } catch { /* the child outlived the test; the OS will reap it */ }
    });
    return {
        stubDir,
        server: startTestServer({
            tablesText: TABLES_FIXTURE, port: PORT, generatorSource,
            extraConfig: { animatePortraitScript: stub, pythonExecutable: process.execPath },
        }),
    };
}

async function view(server, id = NPC_ID) {
    return (await fetch(`${server.baseUrl}/api/animation?id=${encodeURIComponent(id)}`)).json();
}

async function post(server, route, body) {
    return fetch(`${server.baseUrl}${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
}

async function settle(server, id = NPC_ID) {
    for (let i = 0; i < 100; i++) {
        const body = await view(server, id);
        if (body.status && body.status !== 'running') return body;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('the animation job never left "running"');
}

/* ---- GET /api/animation ---- */

test('an unknown item id is a 404', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());
    const res = await fetch(`${server.baseUrl}/api/animation?id=npc-nobody-1`);
    assert.equal(res.status, 404);
});

test('an NPC with no loop yet offers the table and nothing else', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());
    seedNpc(server);

    const body = await view(server);
    assert.equal(body.supported, true);
    assert.deepEqual(body.descriptions, DESCRIPTIONS, 'enabled bullets only, in file order');
    assert.equal(body.url, null);
    assert.equal(body.description, null);
    assert.equal(body.pending, null);
    assert.equal(body.status, null);
    assert.equal(body.stale, false);
});

test('a spaceship is not offered an animation', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());
    seedNpc(server, { kind: 'spaceship', id: SHIP_ID });

    assert.equal((await view(server, SHIP_ID)).supported, false);
    const res = await post(server, '/api/animation', { id: SHIP_ID });
    assert.equal(res.status, 400);
});

/* ---- POST /api/animation ---- */

test('malformed JSON is a 400 rather than a throw', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());
    const res = await fetch(`${server.baseUrl}/api/animation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json',
    });
    assert.equal(res.status, 400);
});

test('a render names the portrait, the loop beside it, a table description and a seed', async (t) => {
    const { stubDir, server: pending } = startWithStub(t, STUB);
    const server = await pending;
    t.after(() => server.stop());
    const folder = seedNpc(server);

    const res = await post(server, '/api/animation', { id: NPC_ID, seedMode: 'specific', seed: 77 });
    assert.equal(res.status, 202);
    const done = await settle(server);
    assert.equal(done.status, 'done', done.error);

    const argv = JSON.parse(fs.readFileSync(path.join(stubDir, 'argv.json'), 'utf8'));
    assert.equal(argv[0], path.join(folder, `${NPC_NAME} Portrait.png`));
    assert.equal(argv[argv.indexOf('--out') + 1], path.join(folder, `${NPC_NAME} Animated Portrait.webp`));
    assert.ok(DESCRIPTIONS.includes(argv[argv.indexOf('-d') + 1]), 'the description is drawn from the table');
    assert.equal(argv[argv.indexOf('--seed') + 1], '77');

    // The record describes the loop, and the loop is served.
    assert.equal(done.description, argv[argv.indexOf('-d') + 1]);
    assert.equal(done.seed, 77);
    assert.equal(done.pending, null);
    assert.equal(done.file, `${NPC_NAME} Animated Portrait.webp`);
    assert.match(done.url, /^\/api\/animation-image\?id=.*&v=\d+$/);
    assert.equal(done.stale, false);
    const sidecar = JSON.parse(fs.readFileSync(path.join(folder, `${NPC_NAME} Animated Portrait.json`), 'utf8'));
    assert.equal(sidecar.seed, 77);
    assert.ok(Number.isFinite(sidecar.portraitVersion));

    const image = await fetch(`${server.baseUrl}${done.url}`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/webp');
    assert.equal(await image.text(), 'RIFF-webp-bytes');
});

test('/api/items says whether an NPC has a loop, and how its job went', async (t) => {
    const { server: pending } = startWithStub(t, STUB);
    const server = await pending;
    t.after(() => server.stop());
    seedNpc(server);

    const before = (await (await fetch(`${server.baseUrl}/api/items?category=npc`)).json()).items
        .find((i) => i.id === NPC_ID);
    assert.equal(before.hasAnimation, false);
    assert.equal(before.animationStatus, null);
    assert.ok(!('descriptions' in before), 'the table belongs to /api/animation, not every poll');

    await post(server, '/api/animation', { id: NPC_ID });
    await settle(server);
    const after = (await (await fetch(`${server.baseUrl}/api/items?category=npc`)).json()).items
        .find((i) => i.id === NPC_ID);
    assert.equal(after.hasAnimation, true);
    assert.equal(after.animationStatus, 'done');
    assert.match(after.animationUrl, /^\/api\/animation-image\?/);
});

test('the same seed is the last loop\'s seed, once there is one', async (t) => {
    const { stubDir, server: pending } = startWithStub(t, STUB);
    const server = await pending;
    t.after(() => server.stop());
    seedNpc(server);

    await post(server, '/api/animation', { id: NPC_ID, seedMode: 'specific', seed: 5 });
    await settle(server);
    await post(server, '/api/animation', { id: NPC_ID, seedMode: 'same' });
    const done = await settle(server);
    assert.equal(done.seed, 5);
    const argv = JSON.parse(fs.readFileSync(path.join(stubDir, 'argv.json'), 'utf8'));
    assert.equal(argv[argv.indexOf('--seed') + 1], '5');
});

test('ping-pong is on unless the panel says otherwise, and the record keeps the choice', async (t) => {
    const { stubDir, server: pending } = startWithStub(t, STUB);
    const server = await pending;
    t.after(() => server.stop());
    const folder = seedNpc(server);
    const argv = () => JSON.parse(fs.readFileSync(path.join(stubDir, 'argv.json'), 'utf8'));
    const sidecar = () => JSON.parse(fs.readFileSync(
        path.join(folder, `${NPC_NAME} Animated Portrait.json`), 'utf8'));

    // A loop from before the choice existed reports it as unknown, not off.
    const before = await (await fetch(`${server.baseUrl}/api/animation?id=${NPC_ID}`)).json();
    assert.equal(before.pingpong, null);

    await post(server, '/api/animation', { id: NPC_ID });
    let done = await settle(server);
    assert.ok(!argv().includes('--no-pingpong'), 'absent is on, and on sends no flag');
    assert.equal(sidecar().pingpong, true);
    assert.equal(done.pingpong, true);

    await post(server, '/api/animation', { id: NPC_ID, pingpong: false });
    done = await settle(server);
    assert.equal(argv().at(-1), '--no-pingpong');
    assert.equal(sidecar().pingpong, false);
    assert.equal(done.pingpong, false);

    // Anything that is not the literal false is on - a string "false" from a
    // hand-written client must not silently switch the loop to one way.
    await post(server, '/api/animation', { id: NPC_ID, pingpong: 'false' });
    done = await settle(server);
    assert.ok(!argv().includes('--no-pingpong'));
    assert.equal(done.pingpong, true);
});

test('a failed render surfaces the script\'s own output and leaves no record', async (t) => {
    const { server: pending } = startWithStub(t, STUB_FAILS);
    const server = await pending;
    t.after(() => server.stop());
    const folder = seedNpc(server);

    await post(server, '/api/animation', { id: NPC_ID });
    const done = await settle(server);
    assert.equal(done.status, 'error');
    assert.match(done.error, /hostbuf_file_reader_read/);
    assert.equal(fs.existsSync(path.join(folder, `${NPC_NAME} Animated Portrait.json`)), false);
});

test('a missing portrait is refused before anything is spawned', async (t) => {
    const { server: pending } = startWithStub(t, STUB);
    const server = await pending;
    t.after(() => server.stop());
    seedNpc(server, { withPortrait: false });

    const res = await post(server, '/api/animation', { id: NPC_ID });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /no portrait/);
});

test('a second render, and a regen, are refused while one is running', async (t) => {
    // A generator stub as well, so the regen route gets past its own "script
    // not found" refusal and reaches the one this test is about.
    const { server: pending } = startWithStub(t, STUB_SLOW, { generatorSource: 'process.exit(0);' });
    const server = await pending;
    t.after(() => server.stop());
    seedNpc(server);

    assert.equal((await post(server, '/api/animation', { id: NPC_ID })).status, 202);
    assert.equal((await post(server, '/api/animation', { id: NPC_ID })).status, 409);
    const regen = await post(server, '/api/regenerate', { id: NPC_ID, which: 'portrait' });
    assert.equal(regen.status, 409);
    assert.match((await regen.json()).reason, /animated/);
});

/* ---- POST /api/animation/description ---- */

test('a re-roll stages a different description, and a render then uses it', async (t) => {
    const { stubDir, server: pending } = startWithStub(t, STUB);
    const server = await pending;
    t.after(() => server.stop());
    seedNpc(server);

    const first = await (await post(server, '/api/animation/description', { id: NPC_ID, op: 'reroll' })).json();
    assert.ok(DESCRIPTIONS.includes(first.pending));
    for (let i = 0; i < 6; i++) {
        const again = await (await post(server, '/api/animation/description', { id: NPC_ID, op: 'reroll' })).json();
        assert.notEqual(again.pending, (await view(server)).description, 'never the one already showing');
    }
    const chosen = (await view(server)).pending;

    await post(server, '/api/animation', { id: NPC_ID });
    const done = await settle(server);
    const argv = JSON.parse(fs.readFileSync(path.join(stubDir, 'argv.json'), 'utf8'));
    assert.equal(argv[argv.indexOf('-d') + 1], chosen);
    assert.equal(done.description, chosen);
    assert.equal(done.pending, null, 'consumed by the render that showed it');
});

test('set takes only what the table offers', async (t) => {
    const server = await startWith();
    t.after(() => server.stop());
    seedNpc(server);

    const bad = await post(server, '/api/animation/description', {
        id: NPC_ID, op: 'set', value: 'she waves at the camera',
    });
    assert.equal(bad.status, 400);
    const off = await post(server, '/api/animation/description', {
        id: NPC_ID, op: 'set', value: 'a switched-off one. the camera does not move.',
    });
    assert.equal(off.status, 400, 'a disabled bullet is not on offer');

    const good = await post(server, '/api/animation/description', {
        id: NPC_ID, op: 'set', value: DESCRIPTIONS[2],
    });
    assert.equal(good.status, 200);
    assert.equal((await good.json()).pending, DESCRIPTIONS[2]);
    assert.equal((await view(server)).pending, DESCRIPTIONS[2], 'it survives a reload');
});

test('a staged choice is refused while a render is running', async (t) => {
    const { server: pending } = startWithStub(t, STUB_SLOW);
    const server = await pending;
    t.after(() => server.stop());
    seedNpc(server);

    await post(server, '/api/animation', { id: NPC_ID });
    const res = await post(server, '/api/animation/description', { id: NPC_ID, op: 'reroll' });
    assert.equal(res.status, 409);
});

/* ---- staleness and import ---- */

test('a portrait re-rendered after the loop marks it stale', async (t) => {
    const { server: pending } = startWithStub(t, STUB);
    const server = await pending;
    t.after(() => server.stop());
    const folder = seedNpc(server);

    await post(server, '/api/animation', { id: NPC_ID });
    await settle(server);
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(folder, `${NPC_NAME} Portrait.png`), later, later);
    assert.equal((await view(server)).stale, true);
});

test('importing carries the loop and its record into the Foundry copy', async (t) => {
    const { server: pending } = startWithStub(t, STUB);
    const server = await pending;
    t.after(() => server.stop());
    seedNpc(server);

    await post(server, '/api/animation', { id: NPC_ID });
    await settle(server);
    const res = await post(server, '/api/import', { ids: [NPC_ID] });
    assert.equal(res.status, 200);

    const manifest = JSON.parse(fs.readFileSync(path.join(server.dir, '.generated-npcs.json'), 'utf8'));
    const [dest] = Object.keys(manifest);
    assert.ok(dest.includes('FoundryData'), `the entry moved under Foundry: ${dest}`);
    assert.ok(fs.existsSync(path.join(dest, `${NPC_NAME} Animated Portrait.webp`)));
    assert.ok(fs.existsSync(path.join(dest, `${NPC_NAME} Animated Portrait.json`)));
    assert.equal((await view(server)).file, `${NPC_NAME} Animated Portrait.webp`);
});
