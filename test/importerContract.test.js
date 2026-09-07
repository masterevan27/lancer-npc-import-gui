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
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5196;
const TABLES = '# Tables\n\n## Role\n\n- Assault\n';

// Task 4 additive assertions below pin the two things a shipped module must
// be able to keep assuming: a job with no recorded size carries no size
// keys at all (not null - see docs/foundry-importer-contract.md), and an
// old module's reconcile report (no `kinds` field) cannot un-import a kind
// it never scanned for. importedIndex is persisted to the real,
// gitignored .imported.json beside server.js (server.js:419) rather than a
// per-test temp dir, so these tests use a random per-run id suffix and clean
// up after themselves rather than assuming a pristine shared file.
const RUN = crypto.randomBytes(4).toString('hex');
const IMPORTED_INDEX_FILE = path.join(__dirname, '..', '.imported.json');

function cleanupImportedIndex(...ids) {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(IMPORTED_INDEX_FILE, 'utf8'));
    } catch {
        return;
    }
    for (const id of ids) delete parsed[id];
    fs.writeFileSync(IMPORTED_INDEX_FILE, JSON.stringify(parsed, null, 2));
}

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

test('a queued job for an item with no recorded size carries no tokenWidth/tokenHeight keys', async () => {
    const id = `npc-contract-${RUN}`;
    const srv = await startTestServer({
        tablesText: TABLES, port: PORT, extraConfig: { foundryNpcActorType: '' },
    });
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
        assert.ok(!('actorType' in job), 'actorType must be absent when the configured type is empty');
    } finally {
        await srv.stop();
    }
});

test('/importer/reconcile with no `kinds` field defaults to npc-only, leaving another kind tracked', async () => {
    const id = `ship-contract-${RUN}`;
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
        cleanupImportedIndex(`ship-contract-${RUN}`);
    }
});
