const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

// Nothing in this stack recorded whether the user had looked at an NPC yet, so
// one generated ten minutes ago was indistinguishable from one generated six
// months ago. The server now keeps a `.npc-seen.json` beside the manifest and
// reports `isNew` on every item view, with newness defined negatively: an id is
// new iff it is absent from that store.
//
// Two properties matter more than the rest and both are pinned below. The store
// is seeded from the whole manifest the first time it is created, so a first
// run against an existing library flags nothing; and it is seeded once ever,
// not once per start, so an NPC rolled at the CLI while the server was down is
// still new on the next boot. The seed is also refused outright when the
// manifest cannot be read, because seeding from loadManifest()'s empty answer
// would write an empty store and light the entire library up on the next poll -
// silently, and with no way back.
const PORT = 5209;

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '',
].join('\n');

/**
 * A manifest object keyed the way generate-npc.py writes it - by absolute
 * folder path - for the given names, rooted at `dir`. Entry shape copied from
 * api.createProduced.test.js's seedNpc; loadManifest only needs `id`, and
 * nothing here needs the art to exist on disk since `isNew` is reported for
 * unimportable entries too.
 */
function manifestFor(dir, names) {
    const manifest = {};
    for (const name of names) {
        manifest[path.join(dir, 'output', 'Pilots', name)] = {
            id: idFor(name),
            kind: 'npc',
            name,
            when: '2026-09-04 09:00:00',
            traits: { Role: 'a courier' },
            portrait: `${name} Portrait.png`,
            files: [`${name} Portrait.png`],
        };
    }
    return manifest;
}

function idFor(name) {
    return `npc-${name.replace(/ /g, '-')}-1`;
}

/** Rewrite the fixture manifest in place, the way a generator run would. */
function writeManifest(server, names) {
    fs.writeFileSync(server.manifestPath, JSON.stringify(manifestFor(server.dir, names)));
}

async function items(server) {
    const res = await fetch(`${server.baseUrl}/api/items?category=npc`);
    assert.equal(res.status, 200);
    return (await res.json()).items;
}

async function unseen(server) {
    const res = await fetch(`${server.baseUrl}/api/unseen`);
    assert.equal(res.status, 200);
    return res.json();
}

async function postSeen(server, body) {
    return fetch(`${server.baseUrl}/api/seen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function readStore(server) {
    return JSON.parse(fs.readFileSync(path.join(server.dir, '.npc-seen.json'), 'utf8'));
}

test('an existing library is not flagged new on first contact', async (t) => {
    // Handed over before the server starts, because the store is seeded at
    // startup - which is the whole point of the helper's `manifest` option.
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT,
        manifest: manifestFor('/library', ['Jules Sokolova', 'Rasa Mbeki', 'Dex Hallow']),
    });
    t.after(() => server.stop());

    const list = await items(server);
    assert.equal(list.length, 3, 'the fixture library did not load, so the check below is vacuous');
    for (const item of list) {
        assert.equal(item.isNew, false, `${item.name} was flagged new on a first-ever load`);
    }
    assert.equal((await unseen(server)).count, 0);
});

test('an entry that appears after seeding is new', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT,
        manifest: manifestFor('/library', ['Jules Sokolova', 'Rasa Mbeki', 'Dex Hallow']),
    });
    t.after(() => server.stop());

    writeManifest(server, ['Jules Sokolova', 'Rasa Mbeki', 'Dex Hallow', 'Mira Kovic']);

    const list = await items(server);
    const isNewByName = Object.fromEntries(list.map((i) => [i.name, i.isNew]));
    assert.deepEqual(isNewByName, {
        'Jules Sokolova': false,
        'Rasa Mbeki': false,
        'Dex Hallow': false,
        'Mira Kovic': true,
    });

    assert.deepEqual(await unseen(server), { count: 1, ids: [idFor('Mira Kovic')] });
});

test('marking an NPC seen clears its tag and persists in the expected shape', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT,
        manifest: manifestFor('/library', ['Jules Sokolova']),
    });
    t.after(() => server.stop());

    writeManifest(server, ['Jules Sokolova', 'Mira Kovic']);
    assert.equal((await unseen(server)).count, 1);

    const res = await postSeen(server, { ids: [idFor('Mira Kovic')] });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, unseen: 0 });

    const list = await items(server);
    assert.equal(list.find((i) => i.name === 'Mira Kovic').isNew, false);
    assert.equal((await unseen(server)).count, 0);

    // server.stop() destroys the fixture directory, so "survives a restart" is
    // asserted as "is on disk in a shape a restart could read" rather than by
    // restarting. This is also the pin on the persisted format.
    const store = readStore(server);
    assert.equal(store.version, 1);
    assert.equal(typeof store.seededAt, 'number');
    assert.equal(typeof store.seen[idFor('Mira Kovic')].at, 'number');
    assert.ok(store.seen[idFor('Jules Sokolova')], 'the seeded entry did not survive the mark');
});

test('mark-all clears everything', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT,
        manifest: manifestFor('/library', ['Jules Sokolova']),
    });
    t.after(() => server.stop());

    writeManifest(server, ['Jules Sokolova', 'Mira Kovic', 'Dex Hallow']);
    assert.equal((await unseen(server)).count, 2);

    const res = await postSeen(server, { all: true });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).unseen, 0);

    assert.equal((await unseen(server)).count, 0);
    for (const item of await items(server)) {
        assert.equal(item.isNew, false, `${item.name} is still flagged new after mark-all`);
    }
});

test('an unknown id is ignored rather than stored, and a malformed body is a 400', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT,
        manifest: manifestFor('/library', ['Jules Sokolova']),
    });
    t.after(() => server.stop());

    // A stale tab posting the id of an NPC that has since been deleted must not
    // put it back in the store: a re-marked deleted id is exactly how a
    // regenerated NPC would lose the tag deleteItem cleared for it.
    const res = await postSeen(server, { ids: ['npc-does-not-exist-1'] });
    assert.equal(res.status, 200);
    assert.equal(readStore(server).seen['npc-does-not-exist-1'], undefined);

    const bad = await postSeen(server, { ids: 'nope' });
    assert.equal(bad.status, 400, 'a body that is neither ids nor all should be rejected, not a no-op');
    assert.match((await bad.json()).error, /ids/);
});

test('deleting an NPC forgets that it was seen', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT,
        manifest: manifestFor('/library', ['Jules Sokolova']),
    });
    t.after(() => server.stop());

    // The id is `npc-<slug>-<seed>`, deterministic from name and seed, so
    // deleting an NPC and rolling it again with the same two yields the same
    // id. Without the prune in deleteItem the re-created NPC arrives silently
    // already-seen. deleteItem removes the folder from disk, so it has to be
    // there - hence the mkdir, unlike every other case in this file.
    const folder = path.join(server.dir, 'output', 'Pilots', 'Jules Sokolova');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(server.dir, '.generated-npcs.json'), JSON.stringify({
        [folder]: {
            id: idFor('Jules Sokolova'), kind: 'npc', name: 'Jules Sokolova',
            when: '2026-09-04 09:00:00', traits: {}, files: [],
        },
    }));

    await postSeen(server, { all: true });
    assert.equal((await unseen(server)).count, 0);

    const del = await fetch(`${server.baseUrl}/api/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [idFor('Jules Sokolova')] }),
    });
    assert.equal((await del.json()).results[0].deleted, true);

    // Rolled again, same name and seed, same id.
    writeManifest(server, ['Jules Sokolova']);
    const list = await items(server);
    assert.equal(list.length, 1);
    assert.equal(list[0].isNew, true, 'a deleted-then-regenerated NPC arrived already marked seen');
});

test('a library with no manifest at all seeds empty, so the first NPCs ever rolled are new', async (t) => {
    // The fresh-install case, and the one the New tag is easiest to lose.
    // .generated-npcs.json is gitignored and does not exist until the first
    // generate run, so a seed that bailed on a missing manifest the way it
    // bails on an unreadable one would leave seenLoaded false - and the
    // deferred seed would then run on the next /api/items poll, against the
    // manifest the user's first NPCs had just written, marking every one of
    // them already seen.
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, manifest: null,
    });
    t.after(() => server.stop());

    assert.equal(
        fs.existsSync(server.manifestPath), false,
        'the fixture wrote a manifest, so this is not the fresh-install case at all');
    // Written at startup, and empty: a library with no manifest holds nothing
    // that could have been seen. Persisting it is what stops the seed from
    // happening later, against a manifest that by then has entries in it.
    assert.deepEqual(readStore(server).seen, {}, 'no seen store was written for an absent manifest');

    writeManifest(server, ['Jules Sokolova', 'Rasa Mbeki']);

    const list = await items(server);
    assert.equal(list.length, 2, 'the manifest written after startup did not load');
    for (const item of list) {
        assert.equal(item.isNew, true, `${item.name} was among the first NPCs ever rolled and is not flagged new`);
    }
    assert.deepEqual(
        (await unseen(server)).ids.sort(),
        [idFor('Jules Sokolova'), idFor('Rasa Mbeki')].sort());
});

test('a manifest whose directory does not exist yet still boots and serves the library', async (t) => {
    // The fresh-install case taken one step earlier: the GUI configured before
    // the generator has ever run, so not only is the manifest absent, the
    // output tree holding it is too - equally, a mistyped npcManifestPath. The
    // seed runs at module load and writes the store beside the manifest, so an
    // unhandled write error there is not a missing New tag, it is a server that
    // exits 1 before it listens. The fixture path is outside the helper's own
    // directory only because the config has to name it before that directory
    // exists to hold it.
    const missingDir = path.join(os.tmpdir(), `import-gui-seen-${crypto.randomUUID()}`);
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, manifest: null,
        extraConfig: { npcManifestPath: path.join(missingDir, '.generated-npcs.json') },
    });
    t.after(() => {
        fs.rmSync(missingDir, { recursive: true, force: true });
        return server.stop();
    });

    // Reaching this line at all is most of the point - startTestServer throws
    // on a child that never listens - but the library has to be served, not
    // merely offered a socket.
    assert.deepEqual(await items(server), []);
    assert.deepEqual(await unseen(server), { count: 0, ids: [] });
    // And the store did land, because saveSeen creates the directory rather
    // than only surviving its absence: a seed that never persists is one that
    // runs again on the next boot, by which time the manifest holds the user's
    // first NPCs and seeding from it marks every one of them seen.
    assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(missingDir, '.npc-seen.json'), 'utf8')).seen, {},
        'the seed was not persisted once its directory could be created');
});

test('a store written under another version is reseeded rather than read', async (t) => {
    // `version` is only worth writing if something refuses to trust a value it
    // does not recognise, so this is the test that makes the field mean
    // anything. Reseeding is the conservative answer available - it flags
    // nothing rather than flagging everything - and it costs at most the tags
    // on NPCs the user had not got to yet.
    //
    // Both the manifest and the store have to be on disk before the child
    // spawns, and only the manifest is the helper's to write, so the fixture
    // lives in a directory of its own that the config is pointed at.
    const dir = path.join(os.tmpdir(), `import-gui-seen-${crypto.randomUUID()}`);
    fs.mkdirSync(dir, { recursive: true });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(
        path.join(dir, '.generated-npcs.json'),
        JSON.stringify(manifestFor('/library', ['Jules Sokolova', 'Mira Kovic'])));
    fs.writeFileSync(path.join(dir, '.npc-seen.json'), JSON.stringify({
        version: 99,
        seededAt: Date.now(),
        seen: { [idFor('Jules Sokolova')]: { at: Date.now() } },
    }));

    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, manifest: null,
        extraConfig: { npcManifestPath: path.join(dir, '.generated-npcs.json') },
    });
    t.after(() => server.stop());

    // Mira Kovic is the tell: absent from the version-99 store, and so flagged
    // new by anything that read it, seen by anything that reseeded instead.
    for (const item of await items(server)) {
        assert.equal(item.isNew, false, `${item.name} was flagged new from a store of another version`);
    }
    const store = JSON.parse(fs.readFileSync(path.join(dir, '.npc-seen.json'), 'utf8'));
    assert.equal(store.version, 1, 'the reseeded store kept the version it could not read');
    assert.deepEqual(Object.keys(store.seen).sort(), [idFor('Jules Sokolova'), idFor('Mira Kovic')].sort());
});

test('a store that cannot be written degrades the New tag instead of failing the request', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT,
        manifest: manifestFor('/library', ['Jules Sokolova']),
    });
    t.after(() => server.stop());

    writeManifest(server, ['Jules Sokolova', 'Mira Kovic']);

    // A directory where the store's file belongs: whatever the real cause on a
    // given machine - a read-only volume, a permission, a sync client holding
    // the file - the shape the server meets is a write it cannot do, and it
    // must not answer that with a 500 over a pill in the corner of a card.
    const storePath = path.join(server.dir, '.npc-seen.json');
    fs.rmSync(storePath);
    fs.mkdirSync(storePath);

    const res = await postSeen(server, { ids: [idFor('Mira Kovic')] });
    assert.equal(res.status, 200, 'an unwritable seen store failed the request that touched it');
    assert.deepEqual(await res.json(), { ok: true, unseen: 0 });

    // Seen in memory for as long as this process lives, which is the whole of
    // what a store it cannot write can promise.
    const list = await items(server);
    assert.equal(list.find((i) => i.name === 'Mira Kovic').isNew, false);
});

test('the store is not created when the manifest is unreadable, and seeding is deferred', async (t) => {
    // The worst way this feature can fail: loadManifest() answers [] for a
    // manifest that is missing *and* for one that will not parse, so a seed
    // taken from it would write an empty store and flag the whole library on
    // the next two-second poll. Refusing to seed and trying again later is the
    // only safe reading.
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, manifest: 'not json',
    });
    t.after(() => server.stop());

    assert.equal(
        fs.existsSync(path.join(server.dir, '.npc-seen.json')), false,
        'a store was written from an unreadable manifest, which flags the library new');

    writeManifest(server, ['Jules Sokolova', 'Rasa Mbeki', 'Dex Hallow']);
    const list = await items(server);
    assert.equal(list.length, 3);
    for (const item of list) {
        assert.equal(item.isNew, false, `${item.name} was flagged new by deferred seeding`);
    }
});
