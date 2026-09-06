const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

// Posting a chosen value, and everything that has to be true before the
// generator is allowed to see it.
//
// The value check is the one worth stating. --set-trait takes its bullet
// VERBATIM and pastes it into an image prompt, so an arbitrary string arriving
// on this route would be rendered. The client's list can also simply be stale,
// which a detail sheet left open makes easy. So the value is re-checked
// against the generator's own list rather than trusted - through the same
// cache the GET route filled, so the ordinary open-choose-submit path still
// only spawns the generator once.
//
// Asserting on the command line needs a detour: unlike a create job, a regen
// job's log is never exposed (its status rides on the item view as
// `regenStatus`), so the stub records its own argv beside itself in the
// fixture directory and the test reads that.
const PORT = 5217;

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '',
    '## Outfit',
    '- a padded work jacket || civ',
    '- a kimono || civ notac',
    '',
].join('\n');

const PAYLOAD = {
    trait: 'Outfit',
    current: 'a padded work jacket || civ',
    dependents: ['Headgear', 'Weapon', 'Gear'],
    choices: [
        {
            value: 'a padded work jacket || civ', heading: 'Outfit',
            allowed: true, current: true, conflicts: [], releases: [],
        },
        {
            value: 'a kimono || civ notac', heading: 'Outfit',
            allowed: true, current: false,
            conflicts: ['Headgear'], releases: ['Headgear'],
        },
    ],
};

// Two jobs in one stub: answer the validation query, and record argv for the
// regen so the test can see the command line the server built.
const STUB = `
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'argv.log'), argv.join(' ') + '\\n');
if (argv.includes('--trait-choices')) {
  process.stdout.write(${JSON.stringify(JSON.stringify(PAYLOAD))});
}
`;

const ENTRY = {
    id: 'npc-test-1',
    kind: 'npc',
    name: 'Test Subject',
    callsign: 'Fixture',
    seed: 1,
    folderPath: 'npcs/Test Subject',
    traits: { Pronouns: 'she/her/her/woman', Outfit: 'a padded work jacket' },
    rawTraits: { Outfit: 'a padded work jacket || civ' },
};

async function server(t, entry = ENTRY) {
    const s = await startTestServer({
        tablesText: TABLES_FIXTURE,
        port: PORT,
        generatorSource: STUB,
        manifest: { 'npcs/Test Subject': entry },
    });
    t.after(() => s.stop());
    return s;
}

function post(s, body) {
    return fetch(`${s.baseUrl}/api/set-trait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

/** The argv of the regen spawn - the line that is not the validation query. */
async function regenArgv(s) {
    const logPath = path.join(s.dir, 'argv.log');
    for (let i = 0; i < 60; i++) {
        if (fs.existsSync(logPath)) {
            const regen = fs.readFileSync(logPath, 'utf8').trim().split('\n')
                .filter((l) => l && !l.includes('--trait-choices'));
            if (regen.length) return regen[regen.length - 1];
        }
        await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error('the generator was never spawned for a regen');
}

const KIMONO = 'a kimono || civ notac';

test('an unknown id is refused', async (t) => {
    const s = await server(t);
    assert.equal((await post(s, { id: 'nope', table: 'Outfit', value: KIMONO })).status, 404);
});

test('a non-npc kind is refused', async (t) => {
    const s = await server(t, { ...ENTRY, kind: 'mech' });
    assert.equal((await post(s, { id: 'npc-test-1', table: 'Outfit', value: KIMONO })).status, 400);
});

test('an entry with no raw bullets is refused', async (t) => {
    const s = await server(t, { ...ENTRY, rawTraits: {} });
    const res = await post(s, { id: 'npc-test-1', table: 'Outfit', value: KIMONO });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /re-roll/i);
});

test('a missing table or value is refused', async (t) => {
    const s = await server(t);
    assert.equal((await post(s, { id: 'npc-test-1', value: KIMONO })).status, 400);
    assert.equal((await post(s, { id: 'npc-test-1', table: 'Outfit' })).status, 400);
});

test('a value the generator did not offer is refused', async (t) => {
    const s = await server(t);
    const res = await post(s, {
        id: 'npc-test-1', table: 'Outfit', value: 'a jetpack made of bees',
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /not a value/i);
});

test('releasing a trait the value does not conflict with is refused', async (t) => {
    const s = await server(t);
    const res = await post(s, {
        id: 'npc-test-1', table: 'Outfit', value: KIMONO, release: ['Backdrop'],
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Backdrop/);
});

test('a good request passes the bullet through with its flags intact', async (t) => {
    const s = await server(t);
    const res = await post(s, { id: 'npc-test-1', table: 'Outfit', value: KIMONO });
    assert.equal(res.status, 202);
    const argv = await regenArgv(s);
    assert.match(argv, /--set-trait Outfit=a kimono \|\| civ notac/);
    assert.doesNotMatch(argv, /--reroll-trait/);
});

test('ticking the box sends --release', async (t) => {
    const s = await server(t);
    await post(s, {
        id: 'npc-test-1', table: 'Outfit', value: KIMONO, release: ['Headgear'],
    });
    assert.match(await regenArgv(s), /--release Headgear/);
});

test('leaving the box unticked sends no --release', async (t) => {
    // The whole point of this over Re-roll is that nothing else moves unless
    // it was asked for.
    const s = await server(t);
    await post(s, { id: 'npc-test-1', table: 'Outfit', value: KIMONO });
    assert.doesNotMatch(await regenArgv(s), /--release/);
});

test('the value check reuses the cache the picker already filled', async (t) => {
    // Open the picker, then submit: one validation spawn, not two.
    const s = await server(t);
    await (await fetch(`${s.baseUrl}/api/trait-choices?id=npc-test-1&trait=Outfit`)).json();
    await post(s, { id: 'npc-test-1', table: 'Outfit', value: KIMONO });
    await regenArgv(s);
    const queries = fs.readFileSync(path.join(s.dir, 'argv.log'), 'utf8')
        .trim().split('\n').filter((l) => l.includes('--trait-choices'));
    assert.equal(queries.length, 1);
});
