/*
 * The /importer/* routes are a CROSS-REPO interface: the client is
 * scripts/importer.js inside the Foundry module of
 * masterevan27/foundryvtt-to-sillytavern-nhp-uplink, shipped in module.zip and
 * already installed in worlds we cannot update. These tests pin the shape both
 * sides agreed on. A failure here is not a bug in the test -- it means a
 * shipped Foundry module has just been broken.
 *
 * See docs/foundry-importer-contract.md.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5196;
const TABLES = '# Tables\n\n## Role\n\n- Assault\n';

// Task 4 additive assertions below pin what a shipped module must be able to
// keep assuming, under the DEFAULT config the project actually ships (fix
// round 1, finding 1): an NPC job carries no actorType/tokenWidth/
// tokenHeight keys at all (not null - see docs/foundry-importer-contract.md
// - foundryNpcActorType defaults to '', which is what keeps this true), a
// ship job does carry actorType: 'deployable' (foundrySpaceshipActorType's
// default), and an old module's reconcile report (no `kinds` field) cannot
// un-import a kind it never scanned for. Fixed ids are safe here:
// startTestServer points config.importedIndexPath at this test's own tmp
// dir (fix round 1, finding 2), so importedIndex never leaks across test
// runs or files.

test('/importer/pending returns a jobs array', async () => {
    const srv = await startTestServer({ tablesText: TABLES, port: PORT });
    try {
        const res = await fetch(`${srv.baseUrl}/importer/pending`);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.ok(Array.isArray(body.jobs), 'jobs must be an array');
    } finally {
        await srv.stop();
    }
});

test('/importer/complete rejects an unknown job with 409, not a throw', async () => {
    const srv = await startTestServer({ tablesText: TABLES, port: PORT });
    try {
        const res = await fetch(`${srv.baseUrl}/importer/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId: 'nope', itemId: 'nope', ok: true }),
        });
        assert.strictEqual(res.status, 409);
        assert.deepStrictEqual(await res.json(), { ok: false });
    } finally {
        await srv.stop();
    }
});

test('/importer/reconcile accepts an entries array and reports what it tracks', async () => {
    const srv = await startTestServer({ tablesText: TABLES, port: PORT });
    try {
        const res = await fetch(`${srv.baseUrl}/importer/reconcile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries: [] }),
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.ok, true);
        assert.strictEqual(typeof body.tracked, 'number');
    } finally {
        await srv.stop();
    }
});

test('an unknown /importer/ route 404s rather than falling through to /api', async () => {
    const srv = await startTestServer({ tablesText: TABLES, port: PORT });
    try {
        const res = await fetch(`${srv.baseUrl}/importer/nonsense`);
        assert.strictEqual(res.status, 404);
    } finally {
        await srv.stop();
    }
});

// --- Task 4: optional size/actorType fields, additive to this contract ---

test('under the DEFAULT config, a queued NPC job carries no actorType/tokenWidth/tokenHeight keys', async () => {
    const id = 'npc-contract-case';
    // No extraConfig at all: this is the config the project actually ships
    // (config.example.json), which is the pin fix round 1 found missing -
    // the earlier version of this test only proved the *mechanism* with
    // foundryNpcActorType blanked out, not what a real deployment sends.
    const srv = await startTestServer({ tablesText: TABLES, port: PORT });
    try {
        const folder = path.join(srv.dir, 'output', 'Pilots', 'Contract Case');
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, 'portrait.png'), 'png');
        fs.writeFileSync(path.join(folder, 'token.png'), 'png');
        fs.writeFileSync(srv.manifestPath, JSON.stringify({
            [folder]: {
                id, kind: 'npc', name: 'Contract Case', seed: 1,
                traits: {}, portrait: 'portrait.png', token: 'token.png',
                files: ['portrait.png', 'token.png'],
            },
        }));

        await fetch(`${srv.baseUrl}/api/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [id] }),
        });
        const { jobs } = await (await fetch(`${srv.baseUrl}/importer/pending`)).json();
        const job = jobs.find((j) => j.itemId === id);
        assert.ok(job, 'no job was queued for the contract-pinning item');
        assert.ok(!('tokenWidth' in job), 'tokenWidth must be absent, not null, with no recorded size');
        assert.ok(!('tokenHeight' in job), 'tokenHeight must be absent, not null, with no recorded size');
        assert.ok(!('actorType' in job), 'actorType leaked onto an NPC job under the default shipped config');
    } finally {
        await srv.stop();
    }
});

test('under the DEFAULT config, a queued ship job carries actorType: "deployable"; a kinds-less reconcile still tracks it', async () => {
    const id = 'ship-contract-case';
    const srv = await startTestServer({ tablesText: TABLES, port: PORT });
    try {
        const folder = path.join(srv.dir, 'ship-output', 'Frigate', 'Contract Ship');
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, 'portrait.png'), 'png');
        fs.writeFileSync(path.join(folder, 'token.png'), 'png');
        fs.writeFileSync(srv.manifestPath, JSON.stringify({
            [folder]: {
                id, kind: 'spaceship', name: 'Contract Ship', seed: 1,
                traits: {}, portrait: 'portrait.png', token: 'token.png',
                files: ['portrait.png', 'token.png'],
            },
        }));

        await fetch(`${srv.baseUrl}/api/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [id] }),
        });
        const { jobs } = await (await fetch(`${srv.baseUrl}/importer/pending`)).json();
        const job = jobs.find((j) => j.itemId === id);
        assert.ok(job, 'no job was queued for the contract-pinning ship');
        assert.strictEqual(job.actorType, 'deployable', 'the default foundrySpaceshipActorType must reach the wire');

        await fetch(`${srv.baseUrl}/importer/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobId: job.jobId, itemId: id, ok: true,
                actorId: `actor-${id}`, actorUuid: `Actor.actor-${id}`,
            }),
        });

        // No `kinds` in the body at all - today's shipped module's request
        // shape. It never claims to have scanned for spaceships, so the
        // ship must survive.
        const res = await fetch(`${srv.baseUrl}/importer/reconcile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries: [] }),
        });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.tracked, 1, 'a kinds-less reconcile un-imported a kind it never claimed to cover');
    } finally {
        await srv.stop();
    }
});
