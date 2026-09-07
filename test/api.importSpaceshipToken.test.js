/*
 * Task 4: the Foundry-facing job gains optional actorType/tokenWidth/
 * tokenHeight fields. G1 is the whole point of this file: tokenWidth/
 * tokenHeight on the wire are GRID UNITS and must be read off the manifest
 * entry's gridWidth/gridHeight - never its tokenWidth/tokenHeight, which are
 * the rendered canvas in pixels and happen to share the wire field's name.
 * Sending the pixel pair would draw a ship 1728 hexes across the map.
 *
 * See docs/foundry-importer-contract.md and server.js's queueImport().
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5229;
const TABLES = '## Role\n\n- a courier\n';

/** Creates a folder with real portrait/token files and returns its path. */
function makeItemFolder(dir, ...segments) {
    const folder = path.join(dir, ...segments);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'portrait.png'), 'png');
    fs.writeFileSync(path.join(folder, 'token.png'), 'png');
    return folder;
}

async function importAndGetJob(server, id) {
    const res = await fetch(`${server.baseUrl}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
    });
    assert.equal(res.status, 200);
    const { results } = await res.json();
    assert.equal(results[0]?.queued, true, `import did not queue: ${JSON.stringify(results)}`);

    const { jobs } = await (await fetch(`${server.baseUrl}/importer/pending`)).json();
    const job = jobs.find((j) => j.itemId === id);
    assert.ok(job, `no pending job was queued for ${id}`);
    return job;
}

test('an NPC import job carries no size or actorType keys when none are configured', async () => {
    // foundryNpcActorType: '' isolates the conditional-spread mechanism from
    // its own real-world default ('npc'), so this proves the mechanism
    // itself omits the key rather than proving today's shipped config does -
    // config.example.json ships foundryNpcActorType: 'npc', which is a
    // deliberate, harmless addition to the wire, not a regression this test
    // is meant to catch.
    const srv = await startTestServer({
        tablesText: TABLES, port: PORT, extraConfig: { foundryNpcActorType: '' },
    });
    try {
        const folder = makeItemFolder(srv.dir, 'output', 'Pilots', 'Jules Sokolova');
        const manifest = {
            [folder]: {
                id: 'npc-jules-sokolova-1',
                kind: 'npc',
                name: 'Jules Sokolova',
                seed: 111,
                traits: { Role: 'a courier' },
                portrait: 'portrait.png',
                token: 'token.png',
                files: ['portrait.png', 'token.png'],
            },
        };
        fs.writeFileSync(srv.manifestPath, JSON.stringify(manifest));

        const job = await importAndGetJob(srv, 'npc-jules-sokolova-1');
        assert.equal(job.kind, 'npc');
        assert.ok(!('tokenWidth' in job), 'tokenWidth leaked onto an NPC job');
        assert.ok(!('tokenHeight' in job), 'tokenHeight leaked onto an NPC job');
        assert.ok(!('actorType' in job), 'actorType leaked onto an NPC job with an empty configured type');
    } finally {
        await srv.stop();
    }
});

test('a ship import job carries the GRID pair as tokenWidth/tokenHeight, not the pixel pair', async () => {
    const srv = await startTestServer({ tablesText: TABLES, port: PORT });
    try {
        const folder = makeItemFolder(srv.dir, 'ship-output', 'Frigate', 'Aurora Drift');
        const manifest = {
            [folder]: {
                id: 'ship-aurora-drift-1',
                kind: 'spaceship',
                name: 'Aurora Drift',
                seed: 222,
                traits: { Backdrop: 'a smuggler run gone straight' },
                portrait: 'portrait.png',
                token: 'token.png',
                files: ['portrait.png', 'token.png'],
                // The manifest entry carries BOTH pairs side by side, exactly
                // as generate-spaceship.py writes it: gridWidth/gridHeight in
                // hexes, tokenWidth/tokenHeight in pixels.
                gridWidth: 3,
                gridHeight: 2,
                tokenWidth: 1728,
                tokenHeight: 1152,
            },
        };
        fs.writeFileSync(srv.manifestPath, JSON.stringify(manifest));

        const job = await importAndGetJob(srv, 'ship-aurora-drift-1');
        assert.equal(job.kind, 'spaceship');
        assert.equal(job.role, null, 'role is an NPC trait slot and must not carry a ship trait');
        assert.equal(job.faction, null);
        assert.equal(job.actorType, 'deployable');

        // G1: the wire's tokenWidth/tokenHeight read the manifest's GRID
        // pair (gridWidth/gridHeight = 3/2), never its own tokenWidth/
        // tokenHeight (1728/1152), which are pixels.
        assert.equal(job.tokenWidth, 3);
        assert.equal(job.tokenHeight, 2);
        assert.notEqual(job.tokenWidth, 1728, 'G1 guard: the pixel width leaked onto the wire as grid units');
        assert.notEqual(job.tokenHeight, 1152, 'G1 guard: the pixel height leaked onto the wire as grid units');

        assert.ok(job.portraitPath.includes('LancerSpaceships/'), job.portraitPath);
        assert.ok(job.tokenPath.includes('LancerSpaceships/'), job.tokenPath);
        assert.ok(!job.portraitPath.includes('\\'), 'portraitPath is not forward-slashed');
        assert.ok(!job.tokenPath.includes('\\'), 'tokenPath is not forward-slashed');
    } finally {
        await srv.stop();
    }
});

test('a ship entry without gridWidth degrades gracefully: the size keys are absent, not null', async () => {
    const srv = await startTestServer({ tablesText: TABLES, port: PORT });
    try {
        const folder = makeItemFolder(srv.dir, 'ship-output', 'Cutter', 'Caravel of Rust');
        const manifest = {
            [folder]: {
                id: 'ship-caravel-of-rust-1',
                kind: 'spaceship',
                name: 'Caravel of Rust',
                seed: 333,
                traits: { Backdrop: 'a debt collector with a grudge' },
                portrait: 'portrait.png',
                token: 'token.png',
                files: ['portrait.png', 'token.png'],
                // No gridWidth/gridHeight at all - an older manifest entry,
                // or a source that never recorded size.
            },
        };
        fs.writeFileSync(srv.manifestPath, JSON.stringify(manifest));

        const job = await importAndGetJob(srv, 'ship-caravel-of-rust-1');
        assert.ok(!('tokenWidth' in job), 'tokenWidth must be absent, not null, when gridWidth is missing');
        assert.ok(!('tokenHeight' in job), 'tokenHeight must be absent, not null, when gridWidth is missing');
    } finally {
        await srv.stop();
    }
});

test('foundrySpaceshipActorType: "" in config omits actorType from a ship job', async () => {
    const srv = await startTestServer({
        tablesText: TABLES, port: PORT, extraConfig: { foundrySpaceshipActorType: '' },
    });
    try {
        const folder = makeItemFolder(srv.dir, 'ship-output', 'Frigate', 'Aurora Drift');
        const manifest = {
            [folder]: {
                id: 'ship-aurora-drift-1',
                kind: 'spaceship',
                name: 'Aurora Drift',
                seed: 222,
                traits: {},
                portrait: 'portrait.png',
                token: 'token.png',
                files: ['portrait.png', 'token.png'],
                gridWidth: 3,
                gridHeight: 2,
                tokenWidth: 1728,
                tokenHeight: 1152,
            },
        };
        fs.writeFileSync(srv.manifestPath, JSON.stringify(manifest));

        const job = await importAndGetJob(srv, 'ship-aurora-drift-1');
        assert.ok(!('actorType' in job), 'actorType leaked despite an empty configured type');
        // The size fields are independent of actorType and still come through.
        assert.equal(job.tokenWidth, 3);
        assert.equal(job.tokenHeight, 2);
    } finally {
        await srv.stop();
    }
});
