/*
 * POST /api/stage-trait - one trait edit applied to the stored NPC, with no
 * render.
 *
 * The route it replaces started a regen: two ComfyUI jobs and several minutes,
 * with a 409 on any second attempt while one ran, so a user could not try three
 * haircuts back to back at all. This one shells out to
 * `generate-npc.py --apply-only`, which rewrites the manifest entry and prints
 * the new traits, and answers with the item as it now stands. The entry is the
 * accumulator; Regenerate is what eventually draws it.
 *
 * Its refusals are the ones /api/reroll-trait and /api/set-trait give, reused
 * verbatim, and the value re-check is the one that matters most: the bullet is
 * pasted into an image prompt VERBATIM, and now it sits in the entry until a
 * render reads it, so an arbitrary string arriving here would be rendered later
 * rather than immediately.
 *
 * The stub stands in for the generator: it records its own argv beside itself,
 * answers --trait-choices with a canned payload, and under --apply-only does
 * what the real flag does - rewrite the entry it was pointed at and print the
 * result as JSON.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5221;

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

const KIMONO = 'a kimono || civ notac';

/**
 * The generator's constants, read out of its source by regex (see
 * lib/overrideTables.js), so rerollableFor() answers a real list rather than
 * an empty one - without them the "a table outside the re-rollable set is
 * refused" case would pass against `allowed.length &&` while checking nothing.
 */
const CONSTANTS = [
    '/*',
    'REQUIRED_TABLES = [',
    '    "Given names", "Family names", "Pronouns", "Theme", "Age", "Hair", "Eyes",',
    '    "Role", "Faction", "Outfit", "Weapon", "Gear", "Stance",',
    ']',
    'TRAIT_DEPENDENTS = {',
    '    "Outfit": ("Weapon", "Gear"),',
    '}',
    'REROLLABLE_TRAITS = (',
    '    "Hair", "Eyes",',
    ')',
    'RAW_REROLLABLE_TRAITS = tuple(',
    '    name for name in REQUIRED_TABLES',
    '    if name not in ("Given names", "Family names", "Pronouns"))',
    '*/',
].join('\n');

/**
 * `sleepMs` holds a run open - an apply so the in-flight guard can be
 * observed, a render so a regen job is still 'running' when the next request
 * lands; `fail` makes the apply exit non-zero with something on stderr. Both
 * are the stub's whole reason for being parameterised - everything else it
 * does is fixed.
 */
function stub({ sleepMs = 0, fail = false } = {}) {
    return `${CONSTANTS}
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'argv.log'), argv.join(' ') + '\\n');

if (argv.includes('--trait-choices')) {
  process.stdout.write(${JSON.stringify(JSON.stringify(PAYLOAD))});
  return;
}
if (!argv.includes('--apply-only')) {
  // A render. Nothing to stand in for beyond staying alive, which is what
  // makes regenJobsByItemId report 'running' for as long as a test needs.
  setTimeout(() => {}, ${sleepMs});
  return;
}

if (${JSON.stringify(fail)}) {
  process.stderr.write('generate-npc.py: no such table "Nonsense"\\n');
  process.exit(1);
}

const arg = (flag) => argv[argv.indexOf(flag) + 1];
const manifestPath = arg('--regen-manifest');
const id = arg('--regen-id');

setTimeout(() => {
  // What --apply-only does: roll, write the entry back, mark the art stale,
  // print the traits. The rolled value is canned - what is under test here is
  // the route, not the roller.
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const key = Object.keys(manifest).find((k) => manifest[k].id === id);
  const entry = manifest[key];
  const raw = argv.includes('--set-trait')
    ? arg('--set-trait').slice(arg('--set-trait').indexOf('=') + 1)
    : ${JSON.stringify(KIMONO)};
  const table = argv.includes('--set-trait')
    ? arg('--set-trait').slice(0, arg('--set-trait').indexOf('='))
    : arg('--reroll-trait');
  entry.traits = { ...entry.traits, [table]: raw.split(' || ')[0] };
  entry.rawTraits = { ...entry.rawTraits, [table]: raw };
  entry.artStale = true;
  manifest[key] = entry;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  // The cascade report goes to stderr precisely so stdout stays parseable.
  process.stderr.write("  with Headgear: 'a welding mask' -> 'nothing'\\n");
  process.stdout.write(JSON.stringify({
    id, traits: entry.traits, rawTraits: entry.rawTraits, artStale: true,
  }));
}, ${sleepMs});
`;
}

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

async function server(t, { entry = ENTRY, ...stubOptions } = {}) {
    const s = await startTestServer({
        tablesText: TABLES_FIXTURE,
        port: PORT,
        generatorSource: stub(stubOptions),
        manifest: { 'npcs/Test Subject': entry },
    });
    t.after(() => s.stop());
    return s;
}

function stage(s, body) {
    return fetch(`${s.baseUrl}/api/stage-trait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

/** The argv of the apply spawn - the line that is not the validation query. */
function applyArgv(s) {
    const logPath = path.join(s.dir, 'argv.log');
    if (!fs.existsSync(logPath)) throw new Error('the generator was never spawned');
    const applies = fs.readFileSync(logPath, 'utf8').trim().split('\n')
        .filter((l) => l.includes('--apply-only'));
    if (!applies.length) throw new Error('the generator was never spawned for an apply');
    return applies[applies.length - 1];
}

test('an unknown id is refused', async (t) => {
    const s = await server(t);
    assert.equal((await stage(s, { id: 'nope', op: 'reroll', table: 'Outfit' })).status, 404);
});

test('a non-npc kind is refused', async (t) => {
    const s = await server(t, { entry: { ...ENTRY, kind: 'mech' } });
    assert.equal((await stage(s, { id: 'npc-test-1', op: 'reroll', table: 'Outfit' })).status, 400);
});

test('an op the route does not know is refused', async (t) => {
    const s = await server(t);
    for (const op of [undefined, '', 'delete', 'regenerate']) {
        const res = await stage(s, { id: 'npc-test-1', op, table: 'Outfit' });
        assert.equal(res.status, 400, `op ${JSON.stringify(op)} should be refused`);
        assert.match((await res.json()).error, /reroll/);
    }
});

test('a missing table is refused', async (t) => {
    const s = await server(t);
    assert.equal((await stage(s, { id: 'npc-test-1', op: 'reroll' })).status, 400);
});

test('setting a trait on an entry with no raw bullets is refused', async (t) => {
    // Same refusal /api/set-trait gives, naming the same cure. A re-roll is
    // still offered on such an entry - it has its own legacy path.
    const s = await server(t, { entry: { ...ENTRY, rawTraits: {} } });
    const res = await stage(s, { id: 'npc-test-1', op: 'set', table: 'Outfit', value: KIMONO });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /re-roll/i);
});

test('a table outside the list this NPC gets is refused, and the list is named', async (t) => {
    const s = await server(t);
    const res = await stage(s, { id: 'npc-test-1', op: 'reroll', table: 'Given names' });
    assert.equal(res.status, 400);
    const { error } = await res.json();
    assert.match(error, /cannot be re-rolled/);
    // The set that applies to THIS entry - it recorded raw bullets, so the
    // wide one - never the legacy eleven by default.
    assert.match(error, /Outfit/);
});

test('a value the generator never offered is refused', async (t) => {
    // The re-check that matters most here: the bullet now sits in the entry
    // until a render reads it, so an unchecked string would be rendered later
    // rather than immediately.
    const s = await server(t);
    const res = await stage(s, {
        id: 'npc-test-1', op: 'set', table: 'Outfit', value: 'a jetpack made of bees',
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /not a value/i);
});

test('releasing a trait the value does not conflict with is refused', async (t) => {
    const s = await server(t);
    const res = await stage(s, {
        id: 'npc-test-1', op: 'set', table: 'Outfit', value: KIMONO, release: ['Backdrop'],
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Backdrop/);
});

test('a re-roll carrying a release is refused rather than quietly stripped', async (t) => {
    const s = await server(t);
    const res = await stage(s, {
        id: 'npc-test-1', op: 'reroll', table: 'Outfit', release: ['Headgear'],
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /release/);
});

test('the command line is --apply-only plus exactly one edit flag', async (t) => {
    const s = await server(t);
    assert.equal((await stage(s, { id: 'npc-test-1', op: 'reroll', table: 'Outfit' })).status, 200);

    const argv = applyArgv(s);
    assert.match(argv, /--apply-only/);
    assert.match(argv, /--regen-id npc-test-1/);
    assert.match(argv, /--reroll-trait Outfit/);
    assert.doesNotMatch(argv, /--set-trait/);
    // A fresh draw seed, or clicking Re-roll twice hands back the same haircut.
    assert.match(argv, /--new-seed \d+/);
    // Nothing that asks for, or declines, a render: --apply-only returns
    // before any render decision is read, and the generator refuses those two
    // together anyway.
    assert.doesNotMatch(argv, /--no-portrait|--no-token/);
});

test('a pinned value reaches the command line with its flags intact', async (t) => {
    const s = await server(t);
    assert.equal((await stage(s, {
        id: 'npc-test-1', op: 'set', table: 'Outfit', value: KIMONO, release: ['Headgear'],
    })).status, 200);

    const argv = applyArgv(s);
    assert.match(argv, /--set-trait Outfit=a kimono \|\| civ notac/);
    assert.match(argv, /--release Headgear/);
    assert.doesNotMatch(argv, /--reroll-trait/);
});

test('a successful stage answers 200 with the item as it now stands', async (t) => {
    const s = await server(t);
    const res = await stage(s, { id: 'npc-test-1', op: 'set', table: 'Outfit', value: KIMONO });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.ok, true);
    // Re-read from the manifest, not echoed from stdout: this is what the next
    // click and the next render will start from.
    assert.equal(body.item.traits.Outfit, 'a kimono');
    assert.equal(body.item.artStale, true);
    // The cascade report, off stderr - the only place that says what else
    // travelled with the trait the user clicked.
    assert.match(body.log, /with Headgear/);
});

test('the edit is in the manifest, not just in the reply', async (t) => {
    // The accumulator claim, end to end: the entry is what the next edit reads.
    const s = await server(t);
    await stage(s, { id: 'npc-test-1', op: 'set', table: 'Outfit', value: KIMONO });

    const { items } = await (await fetch(`${s.baseUrl}/api/items?category=npc`)).json();
    assert.equal(items[0].traits.Outfit, 'a kimono');
    assert.equal(items[0].artStale, true);
});

test('nothing about the stored art is touched', async (t) => {
    // The seed describes the noise of the STORED image, which this edit did
    // not remake - that is what artStale is for.
    const s = await server(t);
    const before = JSON.parse(fs.readFileSync(s.manifestPath, 'utf8'))['npcs/Test Subject'];
    await stage(s, { id: 'npc-test-1', op: 'reroll', table: 'Outfit' });
    const after = JSON.parse(fs.readFileSync(s.manifestPath, 'utf8'))['npcs/Test Subject'];
    assert.equal(after.seed, before.seed);
});

test('a second edit while the first is still applying is refused', async (t) => {
    // They are fast enough that a user CAN get a second click inside the
    // window, and a staged edit reads the whole entry and writes the whole
    // entry back, so two overlapping ones lose the first.
    const s = await server(t, { sleepMs: 400 });
    const first = stage(s, { id: 'npc-test-1', op: 'reroll', table: 'Outfit' });
    // Long enough for the first request to have reached the spawn, short
    // enough to land well inside the stub's sleep.
    await new Promise((r) => setTimeout(r, 120));
    const second = await stage(s, { id: 'npc-test-1', op: 'reroll', table: 'Hair' });

    assert.equal(second.status, 409);
    assert.match((await second.json()).reason, /still being applied/);
    assert.equal((await first).status, 200);
});

test('an edit while a regen is running is refused', async (t) => {
    // A regen rewrites the whole entry at the end of its run, which would
    // swallow whatever this edit applied.
    const s = await server(t, { sleepMs: 1000 });
    const regen = await fetch(`${s.baseUrl}/api/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'npc-test-1', which: 'both', seedMode: 'same' }),
    });
    assert.equal(regen.status, 202);

    const res = await stage(s, { id: 'npc-test-1', op: 'reroll', table: 'Outfit' });
    assert.equal(res.status, 409);
    assert.match((await res.json()).reason, /re-rendered/);

    // Wait the regen out before the fixture directory is torn down. The stub
    // runs with its cwd inside that directory, and on Windows removing it
    // under a live child fails - which would surface as an unrelated flake.
    for (let i = 0; i < 100; i++) {
        const { items } = await (await fetch(`${s.baseUrl}/api/items?category=npc`)).json();
        if (items[0].regenStatus !== 'running') break;
        await new Promise((r) => setTimeout(r, 50));
    }
});

test('a generator failure is a 502 carrying its stderr', async (t) => {
    const s = await server(t, { fail: true });
    const res = await stage(s, { id: 'npc-test-1', op: 'reroll', table: 'Outfit' });
    assert.equal(res.status, 502);
    assert.match((await res.json()).reason, /no such table/);
});

test('a failed edit leaves the item free to be edited again', async (t) => {
    // The in-flight guard is dropped on every exit path, not only the happy
    // one - otherwise one failure would lock the trait gutters until restart.
    const s = await server(t, { fail: true });
    assert.equal((await stage(s, { id: 'npc-test-1', op: 'reroll', table: 'Outfit' })).status, 502);
    assert.equal((await stage(s, { id: 'npc-test-1', op: 'reroll', table: 'Outfit' })).status, 502);
});

test('the value check reuses the cache the picker already filled', async (t) => {
    const s = await server(t);
    await (await fetch(`${s.baseUrl}/api/trait-choices?id=npc-test-1&trait=Outfit`)).json();
    await stage(s, { id: 'npc-test-1', op: 'set', table: 'Outfit', value: KIMONO });

    const queries = fs.readFileSync(path.join(s.dir, 'argv.log'), 'utf8')
        .trim().split('\n').filter((l) => l.includes('--trait-choices'));
    assert.equal(queries.length, 1);
});

test('/api/reroll-trait still answers 202', async (t) => {
    // The compatibility guarantee: a browser tab served before the page
    // started staging its edits still works, and so does a script.
    const s = await server(t);
    const res = await fetch(`${s.baseUrl}/api/reroll-trait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'npc-test-1', table: 'Outfit' }),
    });
    assert.equal(res.status, 202);
});

test('/api/set-trait still answers 202', async (t) => {
    const s = await server(t);
    const res = await fetch(`${s.baseUrl}/api/set-trait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'npc-test-1', table: 'Outfit', value: KIMONO }),
    });
    assert.equal(res.status, 202);
});
