const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

/**
 * The /api/create-presets family, against a real server.js child process.
 *
 * Port 5219 throughout, and only 5219: `node --test` runs test FILES
 * concurrently, every server in this suite binds a fixed port, and two files
 * sharing one does not fail with EADDRINUSE in any way a reader would notice -
 * the second server never becomes ready and the whole run sits there until the
 * readiness loop's 20s budget expires, once per test in the file. Everything
 * from 5193 to 5218 is spoken for.
 *
 * These tests go through HTTP rather than calling lib/createPresets directly
 * (test/createPresets.test.js already covers the module) because what is being
 * checked here is the part the module cannot see: which status code each
 * failure produces, that the module's field-naming error text survives the trip
 * to the client intact, that the files land under presets/create/ and not
 * somewhere else, and that a slug off the wire cannot walk out of that
 * directory.
 */

const TABLES_FIXTURE = [
    '## Outfit',
    '- a heavy work jacket over a stained undersuit',
    '',
    '## Gear',
    '- nothing at all, hands loose and empty',
    '',
].join('\n');

// A full nine-key settings blob with nothing at its default, so a route that
// quietly dropped or reordered a field shows up as a diff rather than as a
// value that happens to match what the default would have been anyway.
const SETTINGS = {
    count: 3,
    seed: 7,
    pronouns: 'she',
    server: 'http://127.0.0.1:8188',
    portrait: true,
    token: false,
    keepRawToken: true,
    unarmed: true,
    overrides: [{ table: 'Outfit', value: 'a heavy work jacket over a stained undersuit', custom: false }],
};

function start(t) {
    return startTestServer({ tablesText: TABLES_FIXTURE, port: 5219 }).then((server) => {
        t.after(() => server.stop());
        return server;
    });
}

function post(server, route, body) {
    return fetch(`${server.baseUrl}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function save(server, name, settings = SETTINGS) {
    return post(server, '/api/create-presets', { name, settings });
}

async function list(server) {
    const res = await fetch(`${server.baseUrl}/api/create-presets`);
    assert.equal(res.status, 200);
    return (await res.json()).presets;
}

test('GET /api/create-presets is an empty list before anything is saved', async (t) => {
    const server = await start(t);
    // Not an error and not a 500: presets/create/ does not exist yet on a fresh
    // install, and the tab has to render before the first save, not after it.
    assert.deepEqual(await list(server), []);
});

test('POST /api/create-presets saves under presets/create/ and the list shows it', async (t) => {
    const server = await start(t);

    const res = await save(server, 'Frontier Medics');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, slug: 'frontier-medics' });

    // Asserted on disk as well as through the API, because the whole point of
    // createPresetsDir defaulting to a subfolder is that a user who moves or
    // backs up presets/ takes both flavours with them - a route writing beside
    // it instead of inside it would pass every HTTP assertion in this file.
    const file = path.join(server.presetsDir, 'create', 'frontier-medics.json');
    assert.ok(fs.existsSync(file), `expected the preset at ${file}`);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(onDisk.kind, 'create-form');
    assert.equal(onDisk.name, 'Frontier Medics');
    assert.ok(typeof onDisk.created === 'string' && onDisk.created);
    assert.deepEqual(onDisk.settings, SETTINGS);

    const presets = await list(server);
    assert.equal(presets.length, 1);
    assert.equal(presets[0].slug, 'frontier-medics');
    assert.equal(presets[0].name, 'Frontier Medics');
    assert.equal(presets[0].overrideCount, 1);
});

test('POST /api/create-presets is a 409 for a name that slugifies to one already saved', async (t) => {
    const server = await start(t);

    assert.equal((await save(server, 'Same Name')).status, 200);
    const second = await save(server, 'Same  name!');
    assert.equal(second.status, 409);
    // The message quotes what the user typed, not the slug the collision was
    // actually on - the slug is an implementation detail they never see.
    assert.match((await second.json()).error, /already exists/);
    assert.equal((await list(server)).length, 1);
});

test('POST /api/create-presets is a 400 for a missing name and for one with no letters or digits', async (t) => {
    const server = await start(t);

    const missing = await post(server, '/api/create-presets', { settings: SETTINGS });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /name is required/);

    // '!!!' is a name the user can see in the box but slugify() reduces to '',
    // which would have written a file called '.json'.
    const unsluggable = await save(server, '!!!');
    assert.equal(unsluggable.status, 400);
    assert.match((await unsluggable.json()).error, /at least one letter or digit/);

    assert.deepEqual(await list(server), []);
});

test('POST /api/create-presets is a 400 naming the field normaliseSettings rejected', async (t) => {
    const server = await start(t);

    const res = await save(server, 'Bad Settings', { ...SETTINGS, pronouns: 42 });
    assert.equal(res.status, 400);
    // The field name has to survive the route verbatim. A generic "invalid
    // settings" here is the difference between a user fixing one box and a user
    // guessing at twelve.
    assert.equal((await res.json()).error, 'pronouns must be a string');

    const noSettings = await post(server, '/api/create-presets', { name: 'No Settings' });
    assert.equal(noSettings.status, 400);
    assert.equal((await noSettings.json()).error, 'settings must be an object');

    assert.deepEqual(await list(server), []);
});

test('GET /api/create-presets/export sends the file as a named attachment', async (t) => {
    const server = await start(t);
    await save(server, 'Frontier Medics');

    const res = await fetch(`${server.baseUrl}/api/create-presets/export?slug=frontier-medics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="frontier-medics.json"');

    const body = await res.json();
    assert.equal(body.name, 'Frontier Medics');
    assert.equal(body.kind, 'create-form');
    assert.deepEqual(body.settings, SETTINGS);
    // Key order is asserted because the exported file is one a GM may open and
    // hand-edit, and count/seed first then the flags then the overrides is the
    // order the form itself reads in.
    assert.deepEqual(Object.keys(body.settings), [
        'count', 'seed', 'pronouns', 'server',
        'portrait', 'token', 'keepRawToken', 'unarmed', 'overrides',
    ]);

    const missing = await fetch(`${server.baseUrl}/api/create-presets/export?slug=never-saved`);
    assert.equal(missing.status, 404);
});

test('POST /api/create-presets/delete removes it once and 404s the second time', async (t) => {
    const server = await start(t);
    await save(server, 'Frontier Medics');

    const first = await post(server, '/api/create-presets/delete', { slug: 'frontier-medics' });
    assert.equal(first.status, 200);
    assert.deepEqual(await list(server), []);

    // The second delete is the one worth testing: a double-clicked button, or
    // two tabs open on the same list, must not come back as a success for a
    // file that is no longer there.
    const second = await post(server, '/api/create-presets/delete', { slug: 'frontier-medics' });
    assert.equal(second.status, 404);
});

test('POST /api/create-presets/import returns a valid file as form settings without saving it', async (t) => {
    const server = await start(t);

    const file = {
        name: 'Zero-G Salvage Crew',
        created: '2026-01-02T03:04:05.000Z',
        kind: 'create-form',
        settings: { count: 2, pronouns: 'they', overrides: [{ table: 'Gear', value: 'a cutting torch' }] },
    };
    const res = await post(server, '/api/create-presets/import', file);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.name, 'Zero-G Salvage Crew');
    // Absent keys come back as their defaults rather than as undefined, so the
    // client can assign every control from the response without a fallback of
    // its own for each one.
    assert.deepEqual(body.settings, {
        count: 2,
        seed: null,
        pronouns: 'they',
        server: '',
        portrait: true,
        token: true,
        keepRawToken: false,
        unarmed: false,
        overrides: [{ table: 'Gear', value: 'a cutting torch', custom: false }],
    });

    // Import fills the form and nothing else. Writing the file here would leave
    // a user who imported one to look at it with a preset they never named and
    // did not ask to keep.
    assert.deepEqual(await list(server), []);
});

test('POST /api/create-presets/import refuses a Tables preset by name, and an unknown override table', async (t) => {
    const server = await start(t);

    // Exactly what /api/presets/export hands back, which is the file a user will
    // pick by mistake: same directory tree, same shape at a glance, and without
    // this check it imports "successfully" as a form of pure defaults.
    const tablesPreset = {
        name: 'Grittier Frontier',
        created: '2026-01-02T03:04:05.000Z',
        selected: { Outfit: [{ text: 'a heavy work jacket over a stained undersuit', weight: 1 }] },
    };
    const res = await post(server, '/api/create-presets/import', tablesPreset);
    assert.equal(res.status, 400);
    const { error } = await res.json();
    // Both flavours have to be named: the user's next move is to go to the other
    // tab, and only a message that says so gets them there.
    assert.match(error, /Tables preset/);
    assert.match(error, /Create NPC preset/);

    const notJsonObject = await post(server, '/api/create-presets/import', ['nope']);
    assert.equal(notJsonObject.status, 400);

    // Caught here rather than three clicks later on Generate, where the same
    // message would arrive with no visible connection to the imported file.
    const staleTable = await post(server, '/api/create-presets/import', {
        name: 'Stale',
        settings: { overrides: [{ table: 'Cybernetics', value: 'a spinal jack' }] },
    });
    assert.equal(staleTable.status, 400);
    assert.equal((await staleTable.json()).error, 'unknown table "Cybernetics"');
});

test('a slug carrying path separators is refused instead of reaching path.join', async (t) => {
    const server = await start(t);
    await save(server, 'Frontier Medics');

    // Planted in presets/, one level up from presets/create/ - a real file a
    // traversal would reach, so the test fails on the file being read or
    // deleted rather than only on a status code.
    const victim = path.join(server.presetsDir, 'victim.json');
    fs.mkdirSync(server.presetsDir, { recursive: true });
    fs.writeFileSync(victim, JSON.stringify({ name: 'Tables preset', selected: {} }));

    for (const slug of ['../victim', '..%2Fvictim', '../../../../etc/passwd', 'frontier-medics/../../victim']) {
        const res = await fetch(`${server.baseUrl}/api/create-presets/export?slug=${encodeURIComponent(slug)}`);
        // 404 and not 400, deliberately: telling a prober which of their slugs
        // were at least well-formed is free information they should not get.
        assert.equal(res.status, 404, `export accepted ${slug}`);
        const del = await post(server, '/api/create-presets/delete', { slug });
        assert.equal(del.status, 404, `delete accepted ${slug}`);
    }

    assert.ok(fs.existsSync(victim), 'a traversal slug deleted a file outside presets/create/');

    // A newline in a slug would otherwise be spelled straight into the
    // Content-Disposition header of the export response.
    const injected = await fetch(
        `${server.baseUrl}/api/create-presets/export?slug=${encodeURIComponent('frontier-medics"\r\nX-Evil: 1')}`,
    );
    assert.equal(injected.status, 404);
    assert.equal(injected.headers.get('x-evil'), null);

    // And the legitimate slug still works, so the guard is a filter and not a
    // wall.
    const ok = await fetch(`${server.baseUrl}/api/create-presets/export?slug=frontier-medics`);
    assert.equal(ok.status, 200);
});
