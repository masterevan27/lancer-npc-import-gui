/**
 * POST /api/create - the canonical create route - and its /api/create-npc
 * alias, which hard-codes kind: 'npc' regardless of whatever the body names.
 *
 * The alias test is a regression guard: /api/create-npc has to keep
 * producing byte-identical argv to what it always did, including never
 * passing --manifest - the latent coupling to generate-npc.py's own
 * DEFAULT_MANIFEST that the design deliberately does not fix here (fixing
 * it would change what test/api.createArgs.test.js already pins).
 *
 * The ship half exercises the second half of the shared validation:
 * person-only fields (pronouns, unarmed) are a 400 when the body actually
 * asks for them on a ship, not a silent drop - and an unknown kind is a 400
 * rather than a silent fold onto npc.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5227;

const NPC_TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '',
    '## Role',
    '- a dockworker',
    '',
].join('\n');

const SHIP_TABLES_FIXTURE = [
    '## Ship type',
    '- a rust-streaked patrol boat',
    '',
].join('\n');

// Echoes its own argv (and nothing else) so the test can assert on the
// command line the server built, the same trick api.createArgs.test.js uses.
const ECHO_STUB = 'console.log(process.argv.slice(2).join(" "));\n';

// The ship script needs REQUIRED_TABLES in its own source for
// lib/overrideTables.js to derive an override list from - there is no
// npc-shaped fallback for a non-npc kind, so a stub without this parses to
// an empty override list and every override would be "unknown".
const SHIP_ECHO_STUB = [
    '/*',
    'REQUIRED_TABLES = [',
    '    "Ship type", "Size", "Weapon", "Backdrop",',
    ']',
    '*/',
    ECHO_STUB,
].join('\n');

/** Writes `names.length` spaceship manifest entries, merged into whatever the manifest already holds. */
function shipStubWriting(names) {
    return [
        '/*',
        'REQUIRED_TABLES = [',
        '    "Ship type", "Size", "Weapon", "Backdrop",',
        ']',
        '*/',
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'const manifestPath = path.join(__dirname, ".generated-npcs.json");',
        'let manifest = {};',
        'try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch {}',
        `for (const name of ${JSON.stringify(names)}) {`,
        '  manifest[path.join(__dirname, "ship-output", "Frigate", name)] = {',
        '    id: `ship-${name.replace(/ /g, "-").toLowerCase()}-1`,',
        '    kind: "spaceship",',
        '    name,',
        '    when: "2026-09-07T01-33-00",',
        '    traits: { "Ship type": "a rust-streaked patrol boat" },',
        '    portrait: `${name} Portrait.png`,',
        '    files: [`${name} Portrait.png`],',
        '  };',
        '}',
        'fs.writeFileSync(manifestPath, JSON.stringify(manifest));',
        'console.log(process.argv.slice(2).join(" "));',
    ].join('\n');
}

async function pollCreateStatus(server, jobId) {
    for (let i = 0; i < 50; i++) {
        const res = await fetch(`${server.baseUrl}/api/create-status?jobId=${jobId}`);
        const job = await res.json();
        if (job.status !== 'running') return job;
        await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error('create job never finished');
}

async function runCreate(server, path_, body) {
    const res = await fetch(`${server.baseUrl}${path_}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (res.status !== 202) return { res, job: null };
    const { jobId } = await res.json();
    const job = await pollCreateStatus(server, jobId);
    return { res, job };
}

test('POST /api/create-npc is byte-identical to what it always produced', async (t) => {
    const server = await startTestServer({
        tablesText: NPC_TABLES_FIXTURE, port: PORT, generatorSource: ECHO_STUB,
    });
    t.after(() => server.stop());

    const { res, job } = await runCreate(server, '/api/create-npc', {
        count: 1,
        seed: 42,
        name: 'Test Subject',
        pronouns: 'she',
        overrides: [{ table: 'Role', value: 'a courier' }],
        noToken: true,
        keepRawToken: true,
        unarmed: true,
        server: 'my-relay',
        dryRun: true,
    });
    assert.equal(res.status, 202);
    assert.equal(job.status, 'done');
    assert.equal(job.kind, 'npc');

    const log = job.log;
    assert.match(log, /--count 1/);
    assert.match(log, /--seed 42/);
    assert.match(log, /--name Test Subject/);
    assert.match(log, /--pronouns she/);
    assert.match(log, /--set-trait Role=a courier/);
    assert.match(log, /--no-token/);
    assert.match(log, /--keep-raw-token/);
    assert.match(log, /--unarmed/);
    assert.match(log, /--server my-relay/);
    assert.match(log, /--dry-run/);
    assert.doesNotMatch(log, /--manifest/, 'the NPC alias must never pass --manifest');
});

test('POST /api/create for a spaceship passes --manifest, --set-trait, and no person-only flags', async (t) => {
    const server = await startTestServer({
        tablesText: NPC_TABLES_FIXTURE, port: PORT,
        spaceshipGeneratorSource: SHIP_ECHO_STUB, spaceshipTablesText: SHIP_TABLES_FIXTURE,
    });
    t.after(() => server.stop());

    // pronouns and unarmed are present in the body, both falsy - the shape a
    // form that always posts its full state (unchecked box, empty select)
    // sends. "Carries them" and "silently dropped" are two different claims:
    // this is the first (present but empty), the next test is the second
    // (present and meaningful).
    const { res, job } = await runCreate(server, '/api/create', {
        kind: 'spaceship',
        count: 2,
        overrides: [{ table: 'Ship type', value: 'a rust-streaked patrol boat' }],
        pronouns: '',
        unarmed: false,
        dryRun: true,
    });
    assert.equal(res.status, 202, JSON.stringify(job));
    assert.equal(job.status, 'done');
    assert.equal(job.kind, 'spaceship');

    const log = job.log;
    assert.match(log, /--count 2/);
    assert.match(log, new RegExp(`--manifest ${server.manifestPath.replace(/[\\.]/g, '\\$&')}`));
    assert.match(log, /--set-trait Ship type=a rust-streaked patrol boat/);
    assert.doesNotMatch(log, /--pronouns/);
    assert.doesNotMatch(log, /--unarmed/);
});

test('pronouns on a spaceship create is a 400, not a silent drop', async (t) => {
    const server = await startTestServer({
        tablesText: NPC_TABLES_FIXTURE, port: PORT,
        spaceshipGeneratorSource: SHIP_ECHO_STUB, spaceshipTablesText: SHIP_TABLES_FIXTURE,
    });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'spaceship', count: 1, pronouns: 'she', dryRun: true }),
    });
    assert.equal(res.status, 400);
    const { error } = await res.json();
    assert.match(error, /pronouns are not a spaceship field/);
});

test('unarmed on a spaceship create is a 400, not a silent drop', async (t) => {
    const server = await startTestServer({
        tablesText: NPC_TABLES_FIXTURE, port: PORT,
        spaceshipGeneratorSource: SHIP_ECHO_STUB, spaceshipTablesText: SHIP_TABLES_FIXTURE,
    });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'spaceship', count: 1, unarmed: true, dryRun: true }),
    });
    assert.equal(res.status, 400);
    const { error } = await res.json();
    assert.match(error, /unarmed is not a spaceship field/);
});

test('spaceshipOutputRoot in config reaches the argv as --out-root', async (t) => {
    const server = await startTestServer({
        tablesText: NPC_TABLES_FIXTURE, port: PORT,
        spaceshipGeneratorSource: SHIP_ECHO_STUB, spaceshipTablesText: SHIP_TABLES_FIXTURE,
        extraConfig: { spaceshipOutputRoot: path.join('G:', 'ship-review') },
    });
    t.after(() => server.stop());

    const { job } = await runCreate(server, '/api/create', { kind: 'spaceship', count: 1, dryRun: true });
    assert.match(job.log, /--out-root/);
    assert.match(job.log, /ship-review/);
});

test('no spaceshipOutputRoot configured means no --out-root at all', async (t) => {
    const server = await startTestServer({
        tablesText: NPC_TABLES_FIXTURE, port: PORT,
        spaceshipGeneratorSource: SHIP_ECHO_STUB, spaceshipTablesText: SHIP_TABLES_FIXTURE,
    });
    t.after(() => server.stop());

    const { job } = await runCreate(server, '/api/create', { kind: 'spaceship', count: 1, dryRun: true });
    assert.doesNotMatch(job.log, /--out-root/);
});

test('GET /api/create-status reports kind for a ship job', async (t) => {
    const server = await startTestServer({
        tablesText: NPC_TABLES_FIXTURE, port: PORT,
        spaceshipGeneratorSource: SHIP_ECHO_STUB, spaceshipTablesText: SHIP_TABLES_FIXTURE,
    });
    t.after(() => server.stop());

    const { job } = await runCreate(server, '/api/create', { kind: 'spaceship', count: 1, dryRun: true });
    assert.equal(job.kind, 'spaceship');
});

test('produced and producedIds count only the ships this run wrote, not the NPCs already in the manifest', async (t) => {
    const server = await startTestServer({
        tablesText: NPC_TABLES_FIXTURE, port: PORT,
        spaceshipGeneratorSource: shipStubWriting(['Aurora Drift', 'Caravel of Rust']),
        spaceshipTablesText: SHIP_TABLES_FIXTURE,
    });
    t.after(() => server.stop());

    // An NPC already on record, written straight into the fixture manifest.
    // A count over the wrong kind, or over the whole manifest, would report
    // 3 instead of 2.
    fs.writeFileSync(server.manifestPath, JSON.stringify({
        [path.join(server.dir, 'output', 'Pilots', 'Jules Sokolova')]: {
            id: 'npc-jules-sokolova-1',
            kind: 'npc',
            name: 'Jules Sokolova',
            when: '2026-09-07T00-00-00',
            traits: { Role: 'a courier' },
            portrait: 'Jules Sokolova Portrait.png',
            files: ['Jules Sokolova Portrait.png'],
        },
    }));

    const { job } = await runCreate(server, '/api/create', { kind: 'spaceship', count: 2 });
    assert.equal(job.status, 'done');
    assert.equal(job.produced, 2);
    assert.deepEqual(
        [...job.producedIds].sort(),
        ['ship-aurora-drift-1', 'ship-caravel-of-rust-1'],
    );
});

test('POST /api/create for an unknown kind is a 400', async (t) => {
    const server = await startTestServer({
        tablesText: NPC_TABLES_FIXTURE, port: PORT,
        spaceshipGeneratorSource: SHIP_ECHO_STUB, spaceshipTablesText: SHIP_TABLES_FIXTURE,
    });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'mech', count: 1 }),
    });
    assert.equal(res.status, 400);
    const { error } = await res.json();
    assert.match(error, /unknown kind/);
});
