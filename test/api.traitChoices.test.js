const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

// Which values a trait could take is generate-npc.py's question to answer -
// see lib/traitChoices.js for why it is not answered here - so this file's
// subject is the wrapping: who is refused before the generator is ever
// spawned, and whether a repeated ask spawns it twice.
//
// The refusals matter more than they look. Every one of them is drawn behind
// the same test the Set... button is drawn behind, so a button that exists is
// a button that works; the failure mode this guards is a control that answers
// 400 when clicked, which is worse than no control at all.
//
// The generator is stubbed as a plain Node script (startTestServer's
// generatorSource, run via process.execPath), so none of this needs Python.
const PORT = 5213;

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
        {
            value: 'a flight suit || mil', heading: 'Outfit',
            allowed: false, current: false, conflicts: [], releases: [],
        },
    ],
};

// Records every spawn beside itself, so a cache hit is distinguishable from a
// second run. startTestServer writes the stub into the fixture dir and hands
// that dir back, so the test knows where to look.
const STUB = `
const fs = require('fs'), path = require('path');
fs.appendFileSync(path.join(__dirname, 'argv.log'), process.argv.slice(2).join(' ') + '\\n');
process.stdout.write(${JSON.stringify(JSON.stringify(PAYLOAD))});
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

function spawnCount(s) {
    const p = path.join(s.dir, 'argv.log');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).length : 0;
}

function ask(s, query) {
    return fetch(`${s.baseUrl}/api/trait-choices?${query}`);
}

test('an unknown id is refused', async (t) => {
    const s = await server(t);
    assert.equal((await ask(s, 'id=nope&trait=Outfit')).status, 404);
});

test('a missing trait is refused', async (t) => {
    const s = await server(t);
    assert.equal((await ask(s, 'id=npc-test-1')).status, 400);
});

test('an entry with no raw bullets is refused, and names the cure', async (t) => {
    // Pinning is what makes a chosen value mean anything, and a legacy entry
    // has nothing to pin - its stored bullets lost their flags on the way in.
    const s = await server(t, { ...ENTRY, rawTraits: {} });
    const res = await ask(s, 'id=npc-test-1&trait=Outfit');
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /re-roll/i);
    assert.equal(spawnCount(s), 0, 'refused before spawning anything');
});

test('a non-npc kind is refused', async (t) => {
    const s = await server(t, { ...ENTRY, kind: 'mech' });
    assert.equal((await ask(s, 'id=npc-test-1&trait=Outfit')).status, 400);
});

test('a good request returns the choices with every documented key', async (t) => {
    const s = await server(t);
    const res = await ask(s, 'id=npc-test-1&trait=Outfit');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.trait, 'Outfit');
    assert.equal(body.choices.length, 3);
    for (const c of body.choices) {
        assert.deepEqual(
            Object.keys(c).sort(),
            ['allowed', 'conflicts', 'current', 'heading', 'label', 'releases', 'value']);
    }
});

test('the readable label is added here, not invented in the browser', async (t) => {
    // The '||' -> '·' convention belongs to lib/traitOptions.js, which the
    // Create form's dropdown already renders through. Spelling it a second
    // time in the client would give one bullet two appearances depending on
    // which control you met it in.
    const s = await server(t);
    const body = await (await ask(s, 'id=npc-test-1&trait=Outfit')).json();
    const kimono = body.choices.find((c) => c.value.includes('kimono'));
    assert.equal(kimono.label, 'a kimono · civ notac');
    assert.equal(kimono.value, 'a kimono || civ notac', 'the value is untouched');
});

test('the flags stay on the value', async (t) => {
    // The value is posted back and pasted into a prompt verbatim, so anything
    // on this path that tidies '|| civ notac' away changes the NPC.
    const s = await server(t);
    const body = await (await ask(s, 'id=npc-test-1&trait=Outfit')).json();
    assert.ok(body.choices.some((c) => c.value.includes('|| civ notac')));
});

test('a ruled-out value is returned rather than dropped', async (t) => {
    // The picker greys them and still lets them be chosen, so the route must
    // not filter what the generator deliberately reported.
    const s = await server(t);
    const body = await (await ask(s, 'id=npc-test-1&trait=Outfit')).json();
    assert.ok(body.choices.some((c) => c.allowed === false));
});

test('the argv reaches the generator as lib/traitChoices builds it', async (t) => {
    const s = await server(t);
    await ask(s, 'id=npc-test-1&trait=Outfit');
    const argv = fs.readFileSync(path.join(s.dir, 'argv.log'), 'utf8').trim();
    assert.match(argv, /--regen-id npc-test-1/);
    assert.match(argv, /--trait-choices Outfit/);
});

test('a repeated request is served from cache', async (t) => {
    // The only test that can catch a cache key which never matches, a bug
    // whose sole symptom is slowness.
    const s = await server(t);
    await (await ask(s, 'id=npc-test-1&trait=Outfit')).json();
    const first = spawnCount(s);
    assert.equal(first, 1);
    await (await ask(s, 'id=npc-test-1&trait=Outfit')).json();
    assert.equal(spawnCount(s), first, 'the second request should not respawn');
});

test('a different trait is not served from the first trait\'s cache', async (t) => {
    const s = await server(t);
    await (await ask(s, 'id=npc-test-1&trait=Outfit')).json();
    await (await ask(s, 'id=npc-test-1&trait=Hair')).json();
    assert.equal(spawnCount(s), 2);
});
