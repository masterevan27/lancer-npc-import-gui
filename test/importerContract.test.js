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
const { startTestServer } = require('./helpers/testServer');

const PORT = 5196;
const TABLES = '# Tables\n\n## Role\n\n- Assault\n';

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
