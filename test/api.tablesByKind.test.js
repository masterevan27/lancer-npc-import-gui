/**
 * `?kind=` across the tables/trait/presets family: GET /api/table-bullets,
 * POST .../toggle and .../set-weight, GET /api/trait-options, GET
 * /api/pronouns, the /api/presets family, and GET /api/npc-tables.
 *
 * Both fixture tables files carry a '## Backdrop' section with different
 * bullets on purpose - see spaceshipTablesPath in lib/paths.js, which is a
 * SIBLING of npcTablesPath rather than nested under it precisely because
 * two files can share a heading and only stay meaningful paired with which
 * file they came from. The toggle/set-weight tests below are the sharpest
 * form of that: a route that resolved the wrong file for a write would
 * corrupt a 252 KB hand-authored tables file, silently, the first time a GM
 * edited a Backdrop bullet from the Spaceships tab.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5228;

const NPC_TABLES_FIXTURE = [
    '## Backdrop',
    '- a neon-lit market district || civ',
    '- a quiet arcology garden',
    '',
    '## Role',
    '- a dockworker',
    '',
].join('\n');

const SHIP_TABLES_FIXTURE = [
    '## Backdrop',
    '- a debt collector with a grudge || crime',
    '- a smuggler run gone straight',
    '',
    '## Ship type',
    '- a rust-streaked patrol boat',
    '',
].join('\n');

// A parseable ship script: REQUIRED_TABLES, REROLLABLE_TRAITS and
// RAW_REROLLABLE_TRAITS in the shape lib/overrideTables.js's regexes expect,
// same trick every other test file in this suite uses to derive a non-empty
// override list without a real Python interpreter.
const SHIP_STUB = [
    '/*',
    'REQUIRED_TABLES = [',
    '    "Ship type", "Backdrop",',
    ']',
    'TRAIT_DEPENDENTS = {}',
    'REROLLABLE_TRAITS = (',
    '    "Backdrop",',
    ')',
    'RAW_REROLLABLE_TRAITS = tuple(',
    '    name for name in REQUIRED_TABLES',
    '    if name not in ("Hull ID",))',
    '*/',
    'process.exit(0);',
].join('\n');

// Present on disk but nothing in it matches the REQUIRED_TABLES /
// REROLLABLE_TRAITS patterns - the "unparseable" case, distinct from a
// missing script (which /api/available already handles elsewhere).
const UNPARSEABLE_SHIP_STUB = 'process.exit(0);\n';

async function withServer(t, opts = {}) {
    const server = await startTestServer({
        tablesText: NPC_TABLES_FIXTURE,
        port: PORT,
        spaceshipGeneratorSource: SHIP_STUB,
        spaceshipTablesText: SHIP_TABLES_FIXTURE,
        ...opts,
    });
    t.after(() => server.stop());
    return server;
}

function flatten(groups) {
    return groups.flatMap((g) => g.rows.map((r) => r.table));
}

async function getTableBullets(server, qs = '') {
    const res = await fetch(`${server.baseUrl}/api/table-bullets${qs}`);
    return { status: res.status, groups: (await res.json()).groups };
}

/* ---- GET /api/table-bullets ---- */

test('no ?kind= is the same as ?kind=npc, and both read the NPC Backdrop', async (t) => {
    const server = await withServer(t);

    const bare = await getTableBullets(server);
    const explicit = await getTableBullets(server, '?kind=npc');
    assert.equal(bare.status, 200);
    assert.equal(explicit.status, 200);

    for (const { groups } of [bare, explicit]) {
        const backdrop = flatten(groups).find((tbl) => tbl.name === 'Backdrop');
        const texts = backdrop.bullets.map((b) => b.text);
        assert.ok(texts.includes('a neon-lit market district || civ'));
        assert.ok(!texts.includes('a debt collector with a grudge || crime'));
    }
});

test('?kind=spaceship reads the SHIP Backdrop - the collision test', async (t) => {
    const server = await withServer(t);

    const { status, groups } = await getTableBullets(server, '?kind=spaceship');
    assert.equal(status, 200);
    const backdrop = flatten(groups).find((tbl) => tbl.name === 'Backdrop');
    const texts = backdrop.bullets.map((b) => b.text);
    assert.ok(texts.includes('a debt collector with a grudge || crime'));
    assert.ok(!texts.includes('a neon-lit market district || civ'));
});

/* ---- the cross-file write guard ---- */

test('POST /api/table-bullets/toggle for a ship rewrites ONLY the ship file', async (t) => {
    const server = await withServer(t);
    const npcBefore = fs.readFileSync(server.tablesPath, 'utf8');
    const shipBefore = fs.readFileSync(server.spaceshipTablesPath, 'utf8');

    const res = await fetch(`${server.baseUrl}/api/table-bullets/toggle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            kind: 'spaceship', table: 'Backdrop',
            text: 'a debt collector with a grudge || crime', enabled: false,
        }),
    });
    assert.equal(res.status, 200);

    const npcAfter = fs.readFileSync(server.tablesPath, 'utf8');
    const shipAfter = fs.readFileSync(server.spaceshipTablesPath, 'utf8');
    // The NPC file is byte-identical - the assertion this whole file exists for.
    assert.equal(npcAfter, npcBefore, 'a ship-kind write touched the NPC tables file');
    assert.notEqual(shipAfter, shipBefore, 'the toggle never reached the ship tables file at all');
    assert.match(shipAfter, /<!--\s*-\s*a debt collector with a grudge \|\| crime\s*-->/);
});

test('POST /api/table-bullets/set-weight for a ship rewrites ONLY the ship file', async (t) => {
    const server = await withServer(t);
    const npcBefore = fs.readFileSync(server.tablesPath, 'utf8');

    const res = await fetch(`${server.baseUrl}/api/table-bullets/set-weight`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            kind: 'spaceship', table: 'Backdrop',
            text: 'a smuggler run gone straight', weight: 5,
        }),
    });
    assert.equal(res.status, 200);

    const npcAfter = fs.readFileSync(server.tablesPath, 'utf8');
    assert.equal(npcAfter, npcBefore, 'a ship-kind write touched the NPC tables file');

    const { groups } = await getTableBullets(server, '?kind=spaceship');
    const backdrop = flatten(groups).find((tbl) => tbl.name === 'Backdrop');
    const bullet = backdrop.bullets.find((b) => b.text === 'a smuggler run gone straight');
    assert.equal(bullet.weight, 5);
});

/* ---- GET /api/trait-options ---- */

test('GET /api/trait-options?kind=spaceship keys on the ship tables', async (t) => {
    const server = await withServer(t);

    const res = await fetch(`${server.baseUrl}/api/trait-options?kind=spaceship`);
    assert.equal(res.status, 200);
    const { options } = await res.json();
    assert.deepEqual(Object.keys(options).sort(), ['Backdrop', 'Ship type']);
    assert.ok(options.Backdrop.some((o) => o.value.includes('smuggler run gone straight')));
    assert.ok(!options.Backdrop.some((o) => o.value.includes('neon-lit market district')));
});

/* ---- GET /api/pronouns ---- */

test('GET /api/pronouns?kind=spaceship is {subjects: []} at 200, not a 400', async (t) => {
    const server = await withServer(t);

    const res = await fetch(`${server.baseUrl}/api/pronouns?kind=spaceship`);
    assert.equal(res.status, 200);
    const { subjects } = await res.json();
    assert.deepEqual(subjects, []);
});

/* ---- GET/POST /api/presets ---- */

test('GET /api/presets?kind=spaceship reads presets/spaceship/, separate from the NPC list', async (t) => {
    const server = await withServer(t);

    const save = await fetch(`${server.baseUrl}/api/presets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'spaceship', name: 'Rust Belt Fleet' }),
    });
    assert.equal(save.status, 200, JSON.stringify(await save.json().catch(() => null)));

    const shipList = await (await fetch(`${server.baseUrl}/api/presets?kind=spaceship`)).json();
    assert.equal(shipList.presets.length, 1);
    assert.equal(shipList.presets[0].slug, 'rust-belt-fleet');

    // The saved bullets are the SHIP file's, not the NPC file's.
    const exported = await (await fetch(
        `${server.baseUrl}/api/presets/export?kind=spaceship&slug=rust-belt-fleet`)).json();
    assert.ok('Backdrop' in exported.selected);
    assert.ok(exported.selected.Backdrop.some((b) => b.text.includes('smuggler run gone straight')));

    // And it does not appear under the NPC tab at all.
    const npcList = await (await fetch(`${server.baseUrl}/api/presets`)).json();
    assert.equal(npcList.presets.length, 0);
});

/* ---- GET /api/npc-tables ---- */

test('GET /api/npc-tables?kind=spaceship returns the ship generator\'s own four parsed constants', async (t) => {
    const server = await withServer(t);

    const res = await fetch(`${server.baseUrl}/api/npc-tables?kind=spaceship`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.tables, ['Ship type', 'Backdrop']);
    assert.deepEqual(body.rerollable, ['Backdrop']);
    assert.deepEqual(body.rawRerollable, ['Ship type', 'Backdrop']);
    assert.deepEqual(body.dependents, {});
});

test('an unparseable ship script yields empty lists at 200, not an error', async (t) => {
    const server = await withServer(t, { spaceshipGeneratorSource: UNPARSEABLE_SHIP_STUB });

    const res = await fetch(`${server.baseUrl}/api/npc-tables?kind=spaceship`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.tables, []);
    assert.deepEqual(body.rerollable, []);
    assert.deepEqual(body.rawRerollable, []);
    assert.deepEqual(body.dependents, {});

    // And the NPC side is completely unaffected by the ship script's own parse miss.
    const npcRes = await fetch(`${server.baseUrl}/api/npc-tables`);
    const npcBody = await npcRes.json();
    assert.ok(npcBody.tables.length > 0, 'the npc kind must not be dragged down by a bad ship script');
});

/* ---- an unknown kind ---- */

test('?kind=mech is a 400 across the family, not a silent fold onto npc', async (t) => {
    const server = await withServer(t);

    for (const url of [
        '/api/table-bullets?kind=mech',
        '/api/trait-options?kind=mech',
        '/api/pronouns?kind=mech',
        '/api/presets?kind=mech',
        '/api/npc-tables?kind=mech',
        '/api/table-odds?kind=mech',
    ]) {
        const res = await fetch(`${server.baseUrl}${url}`);
        assert.equal(res.status, 400, `${url} should refuse an unknown kind`);
    }
});

/* ---- GET /api/ship-catalogue ---- */

/*
 * The generator's own reported shape (design doc finding G4): `sizes` is an
 * ARRAY of objects, not the map an earlier design predicted, and the route
 * hands it through unreshaped - see readShipCatalogue()'s own docs. V2 adds
 * a theme, so the invalidation test below has something visibly different
 * to check for after a re-spawn.
 */
const CATALOGUE_V1 = {
    types: [{ slug: 'patrol', name: 'Patrol boat', sizes: ['small'], folder: 'Patrol boats' }],
    sizes: [{
        sizeBand: 'small', hexes: 1, gridWidth: 1, gridHeight: 1,
        tokenWidth: 1024, tokenHeight: 1024, gloss: 'one hex - a patrol boat, light and fast',
    }],
    themes: ['salvage', 'piracy'],
};
const CATALOGUE_V2 = { ...CATALOGUE_V1, themes: [...CATALOGUE_V1.themes, 'smuggling'] };

/**
 * A stub that prints `payload` as JSON and records its own invocation, so a
 * test can tell a cache hit (no new line) from a re-spawn (a new one) -
 * `--ship-catalogue` carries no argv worth asserting on, unlike every other
 * route in this suite, so the log is what stands in for "did this run".
 */
function catalogueStub(payload) {
    return [
        'const fs = require("node:fs"), path = require("node:path");',
        'fs.appendFileSync(path.join(__dirname, "catalogue-invocations.log"), "x\\n");',
        `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`,
        'process.exit(0);',
    ].join('\n');
}

const CATALOGUE_FAILS_STUB = [
    'process.stderr.write("generate-spaceship.py: could not build the catalogue\\n");',
    'process.exit(1);',
].join('\n');

const CATALOGUE_BAD_JSON_STUB = 'process.stdout.write("this is not json");\nprocess.exit(0);\n';

/** Lines in the invocation log - 0 before the stub has ever run. */
function catalogueInvocations(server) {
    try {
        return fs.readFileSync(path.join(server.dir, 'catalogue-invocations.log'), 'utf8')
            .trim().split('\n').filter(Boolean).length;
    } catch {
        return 0;
    }
}

async function startCatalogueServer(t, generatorSource) {
    const server = await startTestServer({
        tablesText: NPC_TABLES_FIXTURE, port: PORT, spaceshipGeneratorSource: generatorSource,
    });
    t.after(() => server.stop());
    return server;
}

test('GET /api/ship-catalogue passes the JSON through, with sizes as an array', async (t) => {
    const server = await startCatalogueServer(t, catalogueStub(CATALOGUE_V1));

    const res = await fetch(`${server.baseUrl}/api/ship-catalogue`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, CATALOGUE_V1);
    // The shape this whole test exists to pin: an earlier design predicted a
    // map keyed by size band, and the client's Type -> Size gating depends
    // on this being an array instead.
    assert.ok(Array.isArray(body.sizes), 'sizes must stay an array, not be reshaped into a map');
    assert.equal(body.sizes[0].sizeBand, 'small');
    assert.ok(Array.isArray(body.types));
});

test('the mtime cache actually caches: a second request does not re-spawn the generator', async (t) => {
    const server = await startCatalogueServer(t, catalogueStub(CATALOGUE_V1));

    const first = await fetch(`${server.baseUrl}/api/ship-catalogue`);
    assert.equal(first.status, 200);
    assert.equal(catalogueInvocations(server), 1);

    const second = await fetch(`${server.baseUrl}/api/ship-catalogue`);
    assert.equal(second.status, 200);
    assert.equal(catalogueInvocations(server), 1, 'a second request re-spawned the generator instead of serving the cache');
    assert.deepEqual(await second.json(), CATALOGUE_V1);
});

test('touching the script mtime invalidates the cache and re-spawns with the fresh content', async (t) => {
    const server = await startCatalogueServer(t, catalogueStub(CATALOGUE_V1));
    const scriptPath = path.join(server.dir, 'generate-spaceship.js');

    const first = await fetch(`${server.baseUrl}/api/ship-catalogue`);
    assert.deepEqual(await first.json(), CATALOGUE_V1);
    assert.equal(catalogueInvocations(server), 1);

    // Rewrite the script AND move its mtime forward explicitly - a plain
    // rewrite can land inside the same filesystem-mtime tick the first
    // write did, which would leave the cache key (the script's raw mtimeMs)
    // unchanged and the test asserting nothing.
    fs.writeFileSync(scriptPath, catalogueStub(CATALOGUE_V2));
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(scriptPath, future, future);

    const second = await fetch(`${server.baseUrl}/api/ship-catalogue`);
    assert.equal(second.status, 200);
    assert.equal(catalogueInvocations(server), 2, 'a moved mtime did not cause a re-spawn');
    assert.deepEqual(await second.json(), CATALOGUE_V2, 'the cache kept serving the stale catalogue');
});

test('a generator that exits non-zero is a 502, not a throw or a hang', async (t) => {
    const server = await startCatalogueServer(t, CATALOGUE_FAILS_STUB);

    const res = await fetch(`${server.baseUrl}/api/ship-catalogue`);
    assert.equal(res.status, 502);
    const { error } = await res.json();
    assert.match(error, /could not build the catalogue/);
});

test('a generator that prints unparseable JSON is a 502, not a throw or a hang', async (t) => {
    const server = await startCatalogueServer(t, CATALOGUE_BAD_JSON_STUB);

    const res = await fetch(`${server.baseUrl}/api/ship-catalogue`);
    assert.equal(res.status, 502);
    const { error } = await res.json();
    assert.match(error, /could not parse --ship-catalogue output as JSON/);
});
