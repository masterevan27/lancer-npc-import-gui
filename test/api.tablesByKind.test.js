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
