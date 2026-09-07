/*
 * `artStale` on the item view - the one field that says the stored image no
 * longer matches the stored traits.
 *
 * Staged trait edits (POST /api/stage-trait) rewrite the manifest entry without
 * rendering anything, which gives up the invariant "the picture is of this
 * NPC". generate-npc.py --apply-only marks the entry and a real render clears
 * it; this field is how that reaches the page, and the page reads it directly -
 * `hidden = !item.artStale` on the stale-art notice, and an arm of the card's
 * badge chain - so it has to be a boolean on every entry, including the ones
 * written before the marker existed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5224;
const TABLES_FIXTURE = '## Role\n\n- a dockworker\n';

/** Two NPCs: one edited since its art was made, one never touched. */
function manifestFor(dir) {
    const entry = (name, extra) => [
        path.join(dir, 'output', 'Pilots', name),
        {
            id: `npc-${name.replace(/ /g, '-')}-1`,
            kind: 'npc',
            name,
            when: '2026-09-06 09:00:00',
            seed: 12345,
            traits: { Role: 'a dockworker' },
            // queueImport() spells both into Data-relative paths for the
            // Foundry side, and has nothing to spell without them.
            portrait: 'portrait.png',
            token: 'token.png',
            ...extra,
        },
    ];
    return Object.fromEntries([
        entry('Staged Sam', { artStale: true }),
        entry('Untouched Uli', {}),
    ]);
}

async function server(t) {
    const s = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => s.stop());
    const manifest = manifestFor(s.dir);
    // The folders have to exist: isImportable() is an existsSync on them, and
    // an item that cannot be imported queues no job for the contract test
    // below to inspect.
    for (const folder of Object.keys(manifest)) {
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, 'portrait.png'), 'png');
        fs.writeFileSync(path.join(folder, 'token.png'), 'png');
    }
    fs.writeFileSync(s.manifestPath, JSON.stringify(manifest));
    return s;
}

async function itemsById(s) {
    const { items } = await (await fetch(`${s.baseUrl}/api/items?category=npc`)).json();
    return Object.fromEntries(items.map((item) => [item.id, item]));
}

test('an entry marked by a staged edit reports artStale', async (t) => {
    const s = await server(t);
    assert.equal((await itemsById(s))['npc-Staged-Sam-1'].artStale, true);
});

test('an entry that never staged anything reports false, not undefined', async (t) => {
    // The client reads this directly. `undefined` would work by accident for
    // `hidden = !item.artStale` and then read as a missing field to anything
    // that checked the key, so it is coerced here once rather than in three
    // places there.
    const s = await server(t);
    const item = (await itemsById(s))['npc-Untouched-Uli-1'];
    assert.equal(item.artStale, false);
    assert.ok('artStale' in item, 'the key is always present');
});

test('the marker never reaches the Foundry importer contract', async (t) => {
    // /importer/* is a cross-repo interface to a shipped Foundry module. It
    // carries no traits at all, so it must not start carrying the fact that
    // they were edited either.
    const s = await server(t);
    const queued = await fetch(`${s.baseUrl}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['npc-Staged-Sam-1'] }),
    });
    assert.equal(queued.status, 200);

    const { jobs } = await (await fetch(`${s.baseUrl}/importer/pending`)).json();
    assert.ok(jobs.length, 'an empty queue would pass every assertion below');
    for (const job of jobs) {
        assert.ok(!('artStale' in job), 'artStale leaked into the importer payload');
        assert.ok(!('traits' in job), 'the importer payload carries no traits');
    }
});
