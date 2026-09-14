const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

/**
 * POST /api/create-presets/from-item - the NPC sheet's "Save as Create
 * preset", against a real server.js child process.
 *
 * Port 5265, and only 5265: `node --test` runs test files concurrently and
 * every server in this suite binds a fixed port. 5193-5264 are spoken for.
 *
 * lib/presetFromItem.js is unit-tested in test/presetFromItem.test.js; what
 * is checked here is the part it cannot see. That the route reads the
 * manifest entry's raw bullets rather than the stripped traits the browser
 * gets - which is the whole reason the conversion lives on the server. That
 * `custom` is decided against the kind's real tables file. That the file
 * lands in the same presets/create/ directory the Create tab lists, under the
 * same discriminator, so the tab shows it with no further plumbing. And that
 * a ship's entry lands in the ship directory under the ship discriminator,
 * from the item's own kind and not from anything the request said.
 */

const PORT = 5265;

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '- he/him/his/man',
    '',
    '## Role',
    '- a field medic || mil',
    '- a dockworker',
    '',
    '## Outfit',
    '- a heavy work jacket over a stained undersuit || civ notac',
    '',
].join('\n');

const SHIP_TABLES_FIXTURE = [
    '## Ship type',
    '- a rust-streaked patrol boat',
    '',
].join('\n');

const SHIP_STUB = [
    '/*',
    'REQUIRED_TABLES = [',
    '    "Ship type", "Size", "Weapon", "Backdrop",',
    ']',
    '*/',
    'process.exit(0);',
].join('\n');

const VELA_ID = 'npc-Vela-Ostrom-1';
const ROOK_ID = 'npc-Rook-1';
const SHIP_ID = 'ship-kestrel-1';

/** A manifest keyed the way generate-npc.py writes it, by absolute folder path. */
function manifestIn(dir) {
    return {
        [path.join(dir, 'output', 'Pilots', 'Vela Ostrom')]: {
            id: VELA_ID,
            kind: 'npc',
            name: 'Vela Ostrom',
            when: '2026-09-05 09:00:00',
            seed: 12345,
            traits: {
                'Given names': 'Vela',
                'Family names': 'Ostrom',
                Callsigns: 'Wren',
                Pronouns: 'she/her/her/woman',
                Theme: 'rust and neon',
                Role: 'a field medic',
                Outfit: 'a heavy work jacket over a stained undersuit',
            },
            rawTraits: {
                Pronouns: 'she/her/her/woman',
                Theme: 'rust and neon @theme',
                Role: 'a field medic || mil',
                Outfit: 'a heavy work jacket over a stained undersuit || civ notac',
            },
        },
        // Predates rawTraits: its stripped values are all it has.
        [path.join(dir, 'output', 'Pilots', 'Rook')]: {
            id: ROOK_ID,
            kind: 'npc',
            name: 'Rook',
            when: '2026-09-05 09:00:00',
            traits: { Pronouns: 'he/him/his/man', Role: 'a dockworker', Outfit: 'a coat nobody rolls any more' },
        },
        [path.join(dir, 'ship-output', 'Frigate', 'Kestrel')]: {
            id: SHIP_ID,
            kind: 'spaceship',
            name: 'Kestrel',
            when: '2026-09-07T01-33-00',
            seed: 9,
            traits: { 'Ship type': 'a rust-streaked patrol boat', Size: 'small', Weapon: 'a railgun spine' },
        },
    };
}

async function start(t) {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE,
        spaceshipTablesText: SHIP_TABLES_FIXTURE,
        spaceshipGeneratorSource: SHIP_STUB,
        port: PORT,
    });
    t.after(() => server.stop());
    // Written after the server is up; it re-reads the manifest on every request.
    fs.writeFileSync(server.manifestPath, JSON.stringify(manifestIn(server.dir)));
    return server;
}

function fromItem(server, body) {
    return fetch(`${server.baseUrl}/api/create-presets/from-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

async function list(server, kind) {
    const res = await fetch(`${server.baseUrl}/api/create-presets${kind ? `?kind=${kind}` : ''}`);
    assert.equal(res.status, 200);
    return (await res.json()).presets;
}

async function exported(server, slug, kind) {
    const q = `slug=${encodeURIComponent(slug)}${kind ? `&kind=${kind}` : ''}`;
    const res = await fetch(`${server.baseUrl}/api/create-presets/export?${q}`);
    assert.equal(res.status, 200);
    return res.json();
}

test('an NPC is saved as a Create NPC preset the Create tab lists', async (t) => {
    const server = await start(t);

    const res = await fromItem(server, { id: VELA_ID, name: 'Like Vela' });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    assert.deepEqual(JSON.parse(text), { ok: true, slug: 'like-vela', name: 'Like Vela', overrideCount: 3 });

    // The same directory the Create tab's own Save writes to, so the tab sees
    // it with no extra plumbing - and the NPC discriminator, so Import on the
    // ship tab refuses it by name.
    const file = path.join(server.presetsDir, 'create', 'like-vela.json');
    assert.ok(fs.existsSync(file), `expected the preset at ${file}`);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(onDisk.kind, 'create-form');
    assert.equal(onDisk.name, 'Like Vela');
    assert.ok(typeof onDisk.created === 'string' && onDisk.created);
    assert.deepEqual(onDisk.settings, {
        count: 1,
        seed: 12345,
        pronouns: 'she',
        server: '',
        portrait: true,
        token: true,
        keepRawToken: false,
        unarmed: false,
        overrides: [
            // Raw bullets, flags and all - the browser never sees these.
            { table: 'Theme', value: 'rust and neon @theme', custom: true },
            { table: 'Role', value: 'a field medic || mil', custom: false },
            { table: 'Outfit', value: 'a heavy work jacket over a stained undersuit || civ notac', custom: false },
        ],
    });

    const presets = await list(server);
    assert.equal(presets.length, 1);
    assert.equal(presets[0].slug, 'like-vela');
    assert.equal(presets[0].overrideCount, 3);
    // And Load on the tab reads the export route, which hands back the same.
    assert.deepEqual((await exported(server, 'like-vela')).settings, onDisk.settings);
});

test('a legacy entry without raw bullets saves its stripped values, custom where the tables file lacks them', async (t) => {
    const server = await start(t);

    const res = await fromItem(server, { id: ROOK_ID, name: 'Rook again' });
    assert.equal(res.status, 200, await res.text());
    const { settings } = await exported(server, 'rook-again');
    assert.equal(settings.seed, null);
    assert.equal(settings.pronouns, 'he');
    assert.deepEqual(settings.overrides, [
        { table: 'Role', value: 'a dockworker', custom: false },
        { table: 'Outfit', value: 'a coat nobody rolls any more', custom: true },
    ]);
});

test('a spaceship lands in the ship presets under the ship discriminator, by its own kind', async (t) => {
    const server = await start(t);

    // No kind anywhere in the request: the item says what it is.
    const res = await fromItem(server, { id: SHIP_ID, name: 'Kestrel class' });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    assert.deepEqual(JSON.parse(text), { ok: true, slug: 'kestrel-class', name: 'Kestrel class', overrideCount: 3 });

    assert.deepEqual(await list(server), [], 'a ship preset must not appear on the NPC tab');
    const ships = await list(server, 'spaceship');
    assert.equal(ships.length, 1);
    assert.equal(ships[0].slug, 'kestrel-class');

    const preset = await exported(server, 'kestrel-class', 'spaceship');
    assert.equal(preset.kind, 'create-form-spaceship');
    assert.ok(!('pronouns' in preset.settings));
    assert.ok(!('unarmed' in preset.settings));
    assert.equal(preset.settings.seed, 9);
    assert.deepEqual(preset.settings.overrides, [
        { table: 'Ship type', value: 'a rust-streaked patrol boat', custom: false },
        { table: 'Size', value: 'small', custom: true },
        { table: 'Weapon', value: 'a railgun spine', custom: true },
    ]);
});

test('an unknown item is a 404 and nothing is written', async (t) => {
    const server = await start(t);
    for (const id of ['npc-nobody-1', '', undefined, 42]) {
        const res = await fromItem(server, { id, name: 'Nobody' });
        assert.equal(res.status, 404, `id ${JSON.stringify(id)}`);
        assert.equal((await res.json()).error, 'unknown item');
    }
    assert.deepEqual(await list(server), []);
});

test('a missing or unsluggable name is a 400, same wording as the Create tab', async (t) => {
    const server = await start(t);

    const missing = await fromItem(server, { id: VELA_ID });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /name is required/);

    const unsluggable = await fromItem(server, { id: VELA_ID, name: '!!!' });
    assert.equal(unsluggable.status, 400);
    assert.match((await unsluggable.json()).error, /at least one letter or digit/);

    assert.deepEqual(await list(server), []);
});

test('a name already saved on that tab is a 409 and the first preset is kept', async (t) => {
    const server = await start(t);

    assert.equal((await fromItem(server, { id: VELA_ID, name: 'Medic' })).status, 200);
    const second = await fromItem(server, { id: ROOK_ID, name: 'medic!' });
    assert.equal(second.status, 409);
    assert.match((await second.json()).error, /already exists/);

    const { settings } = await exported(server, 'medic');
    assert.equal(settings.pronouns, 'she', 'the second save must not overwrite the first');
});
