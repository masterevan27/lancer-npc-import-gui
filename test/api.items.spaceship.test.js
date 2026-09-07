/*
 * End-to-end proof that a spaceship rides through browse, import, delete and
 * seen without a single ship-shaped branch in any of those routes.
 *
 * generate-npc.py and generate-spaceship.py both write into one
 * .generated-npcs.json, distinguished only by each entry's `kind`. Every
 * route this file exercises - /api/categories, /api/items, /api/image,
 * /api/import, /api/delete, /api/seen, /api/unseen - already worked in
 * terms of `item.kind` and the manifest's folder-path keys before a ship
 * ever existed; this file is the test that they still do, now that a
 * second kind is actually present alongside the first.
 *
 * The one place a ship really does behave differently on purpose is
 * /api/model-3d: generate-3d.py and lib/model3d.js both assume NPC
 * deliverable names, so a ship's kind entry in the registry says
 * `supports.model3d: false` and the route refuses it - the refusal itself
 * generic (a capability flag, not an `item.kind === 'spaceship'` check).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5225;

const TABLES_FIXTURE = '## Role\n\n- a dockworker\n';

const NPC_ID = 'npc-jules-sokolova-1';
const SHIP_A_ID = 'ship-aurora-drift-1';
const SHIP_B_ID = 'ship-caravel-of-rust-1';

/**
 * One NPC and two ships on disk, keyed the way the generators write the
 * manifest - by absolute folder path, with the run's own <category>/<name>
 * nesting so foundryDestFolder can recover the category from the folder.
 * Real files are written because /api/import only copies what exists and
 * /api/image only serves what exists.
 */
function seedLibrary(dir) {
    const npcFolder = path.join(dir, 'output', 'Pilots', 'Jules Sokolova');
    const shipAFolder = path.join(dir, 'ship-output', 'run1', 'Frigate', 'Aurora Drift');
    const shipBFolder = path.join(dir, 'ship-output', 'run1', 'Cutter', 'Caravel of Rust');

    for (const folder of [npcFolder, shipAFolder, shipBFolder]) {
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, 'portrait.png'), 'png');
        fs.writeFileSync(path.join(folder, 'token.png'), 'png');
    }

    const manifest = {
        [npcFolder]: {
            id: NPC_ID,
            kind: 'npc',
            name: 'Jules Sokolova',
            when: '2026-09-06 09:00:00',
            seed: 111,
            traits: { Role: 'a courier' },
            portrait: 'portrait.png',
            token: 'token.png',
            files: ['portrait.png', 'token.png'],
        },
        [shipAFolder]: {
            id: SHIP_A_ID,
            kind: 'spaceship',
            name: 'Aurora Drift',
            when: '2026-09-06 09:05:00',
            seed: 222,
            traits: { Backdrop: 'a smuggler run gone straight' },
            portrait: 'portrait.png',
            token: 'token.png',
            files: ['portrait.png', 'token.png'],
            gridWidth: 3,
            gridHeight: 3,
            tokenWidth: 1728,
            tokenHeight: 1728,
        },
        [shipBFolder]: {
            id: SHIP_B_ID,
            kind: 'spaceship',
            name: 'Caravel of Rust',
            when: '2026-09-06 09:06:00',
            seed: 333,
            traits: { Backdrop: 'a debt collector with a grudge' },
            portrait: 'portrait.png',
            token: 'token.png',
            files: ['portrait.png', 'token.png'],
            artStale: true,
            gridWidth: 2,
            gridHeight: 1,
            tokenWidth: 1152,
            tokenHeight: 576,
        },
    };

    return { npcFolder, shipAFolder, shipBFolder, manifest };
}

async function startWithLibrary(t) {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const { npcFolder, shipAFolder, shipBFolder, manifest } = seedLibrary(server.dir);
    fs.writeFileSync(server.manifestPath, JSON.stringify(manifest));
    return { server, npcFolder, shipAFolder, shipBFolder };
}

async function getJson(url) {
    const res = await fetch(url);
    return { status: res.status, body: await res.json() };
}

test('GET /api/categories reports both kinds, correct counts and the registry label', async (t) => {
    const { server } = await startWithLibrary(t);

    const { status, body } = await getJson(`${server.baseUrl}/api/categories`);
    assert.equal(status, 200);

    const byId = Object.fromEntries(body.categories.map((c) => [c.id, c]));
    assert.equal(byId.npc.count, 1);
    assert.equal(byId.spaceship.count, 2);
    // The label the client actually renders on each category button. A
    // per-category copy of `supports` used to ride along beside it and nothing
    // ever read it - the per-ITEM supports on /api/items is what drives the
    // detail sheet - so it was dropped rather than left as a second source of
    // truth for the same answer.
    assert.equal(byId.spaceship.label, 'Spaceships');
    assert.equal(byId.spaceship.supports, undefined);

    // This fixture has no generator scripts at all, so nothing is generatable
    // and `kinds` is empty - which the client reads as "say nothing about
    // availability" and leaves every control alone. The two real states are
    // pinned in ui.shipCreate.test.js.
    assert.deepEqual(body.kinds, []);
});

test('GET /api/items?category=spaceship returns exactly the two ships, name-sorted, with kind-generic fields', async (t) => {
    const { server } = await startWithLibrary(t);

    const { status, body } = await getJson(`${server.baseUrl}/api/items?category=spaceship`);
    assert.equal(status, 200);
    assert.equal(body.items.length, 2);
    assert.deepEqual(body.items.map((i) => i.name), ['Aurora Drift', 'Caravel of Rust']);

    const [aurora, caravel] = body.items;

    assert.equal(aurora.kind, 'spaceship');
    assert.deepEqual(aurora.traits, { Backdrop: 'a smuggler run gone straight' });
    assert.equal(aurora.seed, 222);
    assert.equal(aurora.roleCategory, null, 'roleCategory is an NPC-only concept and must be null for a ship');
    assert.deepEqual(aurora.tokenHexes, { w: 3, h: 3 });
    assert.equal(aurora.supports.model3d, false);
    assert.equal(aurora.supports.regen, true);
    assert.equal(aurora.artStale, false);

    assert.equal(caravel.kind, 'spaceship');
    assert.deepEqual(caravel.tokenHexes, { w: 2, h: 1 });
    assert.equal(caravel.artStale, true);
});

test('GET /api/image serves a spaceship portrait', async (t) => {
    const { server } = await startWithLibrary(t);

    const res = await fetch(`${server.baseUrl}/api/image?id=${encodeURIComponent(SHIP_A_ID)}&which=portrait`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
});

test('POST /api/import files a ship under LancerSpaceships, not LancerNPCs, and repoints the manifest', async (t) => {
    const { server, shipAFolder } = await startWithLibrary(t);

    const res = await fetch(`${server.baseUrl}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [SHIP_A_ID] }),
    });
    const { results } = await res.json();
    assert.equal(res.status, 200, JSON.stringify(results));
    assert.equal(results.length, 1);
    assert.equal(results[0].queued, true, JSON.stringify(results[0]));

    const { body } = await getJson(`${server.baseUrl}/api/items?category=spaceship`);
    const imported = body.items.find((i) => i.id === SHIP_A_ID);
    assert.ok(imported, 'the imported ship vanished from the listing');
    assert.notEqual(imported.folderPath, shipAFolder, 'still names the pre-import folder after importing');
    assert.ok(
        imported.folderPath.includes(`${path.sep}LancerSpaceships${path.sep}`),
        `expected the ship under LancerSpaceships, got ${imported.folderPath}`);
    assert.ok(
        !imported.folderPath.includes(`${path.sep}LancerNPCs${path.sep}`),
        `a ship landed under LancerNPCs: ${imported.folderPath}`);
    assert.ok(
        fs.existsSync(path.join(imported.folderPath, imported.portraitFile)),
        'the reported folder does not hold the copied art');

    // The manifest re-reads clean: still valid JSON, still exactly three
    // entries, old key gone, new key present.
    const manifest = JSON.parse(fs.readFileSync(server.manifestPath, 'utf8'));
    assert.equal(Object.keys(manifest).length, 3);
    assert.ok(!manifest[shipAFolder], 'the pre-import key is still in the manifest');
    assert.ok(manifest[imported.folderPath], 'the post-import key is missing from the manifest');
});

test('POST /api/delete removes a ship folder and manifest key, prunes seen, and leaves the NPC alone', async (t) => {
    const { server, shipBFolder } = await startWithLibrary(t);

    // Mark everything seen first so the prune is visible.
    await fetch(`${server.baseUrl}/api/seen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
    });
    assert.equal((await getJson(`${server.baseUrl}/api/unseen`)).body.count, 0);

    const res = await fetch(`${server.baseUrl}/api/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [SHIP_B_ID] }),
    });
    assert.equal(res.status, 200);
    const { results } = await res.json();
    assert.equal(results[0].deleted, true, JSON.stringify(results[0]));

    assert.equal(fs.existsSync(shipBFolder), false, 'the deleted ship folder is still on disk');

    const manifest = JSON.parse(fs.readFileSync(server.manifestPath, 'utf8'));
    assert.ok(!manifest[shipBFolder], 'the deleted ship is still keyed in the manifest');
    assert.equal(Object.keys(manifest).length, 2, 'exactly the NPC and the surviving ship should remain');

    const seenStore = JSON.parse(fs.readFileSync(path.join(server.dir, '.npc-seen.json'), 'utf8'));
    assert.ok(!seenStore.seen[SHIP_B_ID], 'the deleted ship is still in the seen store');
    assert.ok(seenStore.seen[NPC_ID], 'deleting a ship pruned the untouched NPC out of the seen store too');

    const { body } = await getJson(`${server.baseUrl}/api/items?category=npc`);
    assert.equal(body.items.length, 1, 'the NPC entry was affected by a ship delete');
    assert.equal(body.items[0].id, NPC_ID);
});

test('POST /api/seen then GET /api/unseen drops the ship and keeps the NPC', async (t) => {
    const { server } = await startWithLibrary(t);

    assert.deepEqual(
        (await getJson(`${server.baseUrl}/api/unseen`)).body.ids.sort(),
        [NPC_ID, SHIP_A_ID, SHIP_B_ID].sort(),
        'precondition: nothing has been looked at yet');

    const res = await fetch(`${server.baseUrl}/api/seen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [SHIP_A_ID] }),
    });
    assert.equal(res.status, 200);

    const { body } = await getJson(`${server.baseUrl}/api/unseen`);
    assert.ok(!body.ids.includes(SHIP_A_ID), 'the marked ship is still reported unseen');
    assert.ok(body.ids.includes(NPC_ID), 'the untouched NPC dropped out of unseen too');
    assert.ok(body.ids.includes(SHIP_B_ID), 'the untouched ship dropped out of unseen too');
});

test('GET /api/model-3d refuses a ship by kind and still serves an NPC', async (t) => {
    const { server } = await startWithLibrary(t);

    const shipRes = await getJson(`${server.baseUrl}/api/model-3d?id=${encodeURIComponent(SHIP_A_ID)}`);
    assert.equal(shipRes.status, 400);
    assert.match(shipRes.body.error, /spaceship/);

    const npcRes = await getJson(`${server.baseUrl}/api/model-3d?id=${encodeURIComponent(NPC_ID)}`);
    assert.equal(npcRes.status, 200);
});
