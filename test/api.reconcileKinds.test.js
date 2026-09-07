/*
 * Task 4: POST /importer/reconcile's optional `kinds` array is the one place
 * this endpoint can actually destroy real data. Before this task, reconcile()
 * deleted every imported id a report did not mention - fine when only NPCs
 * existed, since the shipped module reports every NPC Actor it finds on
 * every poll. Once ships exist too, an old module's report (which only ever
 * scanned for NPC actors) would silently un-import every ship on the very
 * first reconcile, because the ship was never in its report at all.
 *
 * `kinds` says which item kinds a report actually covers. Omitted, it means
 * `['npc']` - an old module's implicit scope - so a kind it never looked for
 * survives. A report that explicitly names a kind is authoritative for it.
 *
 * See docs/foundry-importer-contract.md and server.js's reconcile().
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5230;
const TABLES = '## Role\n\n- a courier\n';

// importedIndex is persisted to .imported.json beside server.js - a real,
// gitignored, repo-root file shared by every server.js process this suite
// spawns, not something startTestServer's per-test temp dir can isolate (see
// server.js:419 and its "No data migration" constraint). A fixed id would
// collide with a stale entry left by a previous run of this same file, so
// every run gets a fresh suffix, and the entries this file writes are
// cleaned up afterward so repeated runs don't leave the real file growing.
const RUN = crypto.randomBytes(4).toString('hex');
const NPC_ID = `npc-jules-sokolova-${RUN}`;
const SHIP_ID = `ship-aurora-drift-${RUN}`;
const IMPORTED_INDEX_FILE = path.join(__dirname, '..', '.imported.json');

function cleanupImportedIndex() {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(IMPORTED_INDEX_FILE, 'utf8'));
    } catch {
        return;
    }
    delete parsed[NPC_ID];
    delete parsed[SHIP_ID];
    fs.writeFileSync(IMPORTED_INDEX_FILE, JSON.stringify(parsed, null, 2));
}

function makeItemFolder(dir, ...segments) {
    const folder = path.join(dir, ...segments);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'portrait.png'), 'png');
    fs.writeFileSync(path.join(folder, 'token.png'), 'png');
    return folder;
}

async function seedAndImportBoth(srv) {
    const npcFolder = makeItemFolder(srv.dir, 'output', 'Pilots', 'Jules Sokolova');
    const shipFolder = makeItemFolder(srv.dir, 'ship-output', 'Frigate', 'Aurora Drift');
    const manifest = {
        [npcFolder]: {
            id: NPC_ID, kind: 'npc', name: 'Jules Sokolova', seed: 111,
            traits: { Role: 'a courier' }, portrait: 'portrait.png', token: 'token.png',
            files: ['portrait.png', 'token.png'],
        },
        [shipFolder]: {
            id: SHIP_ID, kind: 'spaceship', name: 'Aurora Drift', seed: 222,
            traits: {}, portrait: 'portrait.png', token: 'token.png',
            files: ['portrait.png', 'token.png'], gridWidth: 3, gridHeight: 2,
        },
    };
    fs.writeFileSync(srv.manifestPath, JSON.stringify(manifest));

    const importRes = await fetch(`${srv.baseUrl}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [NPC_ID, SHIP_ID] }),
    });
    const { results } = await importRes.json();
    assert.ok(results.every((r) => r.queued), `both imports must queue: ${JSON.stringify(results)}`);

    // Complete both jobs, exactly as the Foundry module would after creating
    // the Actors, so both land in importedIndex (what reconcile prunes).
    const { jobs } = await (await fetch(`${srv.baseUrl}/importer/pending`)).json();
    for (const job of jobs) {
        await fetch(`${srv.baseUrl}/importer/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobId: job.jobId, itemId: job.itemId, ok: true,
                actorId: `actor-${job.itemId}`, actorUuid: `Actor.actor-${job.itemId}`,
            }),
        });
    }
}

async function reconcile(srv, body) {
    const res = await fetch(`${srv.baseUrl}/importer/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    assert.equal(res.status, 200);
    return res.json();
}

test('reconcile with no kinds (an old NPC-only module) leaves an imported ship alone', async () => {
    const srv = await startTestServer({ tablesText: TABLES, port: PORT });
    try {
        await seedAndImportBoth(srv);

        // The reporter only names the NPC and says nothing about kinds -
        // exactly what today's shipped module sends.
        const body = await reconcile(srv, {
            entries: [{ itemId: NPC_ID, actorId: `actor-${NPC_ID}`, actorUuid: `Actor.actor-${NPC_ID}` }],
        });

        // The data-loss guard: the ship must still be imported even though
        // the report never mentioned it.
        assert.equal(body.tracked, 2, 'the ship was dropped by a report that never claimed to cover ships');
    } finally {
        await srv.stop();
        cleanupImportedIndex();
    }
});

test('reconcile with kinds:["npc","spaceship"] drops a ship the report omitted', async () => {
    const srv = await startTestServer({ tablesText: TABLES, port: PORT });
    try {
        await seedAndImportBoth(srv);

        // The reporter claims to have scanned both kinds and found only the
        // NPC actor - so the ship really is gone in-world.
        const body = await reconcile(srv, {
            entries: [{ itemId: NPC_ID, actorId: `actor-${NPC_ID}`, actorUuid: `Actor.actor-${NPC_ID}` }],
            kinds: ['npc', 'spaceship'],
        });

        assert.equal(body.tracked, 1, 'a report authoritative for both kinds must still drop the missing ship');
    } finally {
        await srv.stop();
        cleanupImportedIndex();
    }
});

test('an itemId no longer in the manifest is pruned in both the default and explicit-kinds cases', async () => {
    const srv = await startTestServer({ tablesText: TABLES, port: PORT });
    try {
        await seedAndImportBoth(srv);

        // Delete the ship's manifest entry entirely (as if generate-npc.py's
        // folder vanished), leaving it only in importedIndex.
        const manifest = JSON.parse(fs.readFileSync(srv.manifestPath, 'utf8'));
        for (const key of Object.keys(manifest)) {
            if (manifest[key].id === SHIP_ID) delete manifest[key];
        }
        fs.writeFileSync(srv.manifestPath, JSON.stringify(manifest));

        // No kinds named at all - default scope is ['npc'] - yet a
        // manifest-gone item is pruned regardless of kind, because there is
        // nothing left for any future reporter to ever claim.
        const body = await reconcile(srv, {
            entries: [{ itemId: NPC_ID, actorId: `actor-${NPC_ID}`, actorUuid: `Actor.actor-${NPC_ID}` }],
        });
        assert.equal(body.tracked, 1, 'a manifest-gone ship must be pruned even though the report is npc-only');
    } finally {
        await srv.stop();
        cleanupImportedIndex();
    }
});

test('`tracked` in the response always matches importedIndex.size', async () => {
    const srv = await startTestServer({ tablesText: TABLES, port: PORT });
    try {
        await seedAndImportBoth(srv);

        const withoutKinds = await reconcile(srv, {
            entries: [
                { itemId: NPC_ID, actorId: `actor-${NPC_ID}`, actorUuid: `Actor.actor-${NPC_ID}` },
                { itemId: SHIP_ID, actorId: `actor-${SHIP_ID}`, actorUuid: `Actor.actor-${SHIP_ID}` },
            ],
        });
        assert.equal(withoutKinds.tracked, 2);

        const empty = await reconcile(srv, { entries: [], kinds: ['npc', 'spaceship'] });
        assert.equal(empty.tracked, 0, 'an authoritative empty report for both kinds must clear the index');
    } finally {
        await srv.stop();
        cleanupImportedIndex();
    }
});
