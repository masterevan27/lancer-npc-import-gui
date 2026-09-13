/**
 * The spaceship half of the regen/reroll/set-trait machinery: startRegenJob
 * routed through the kind registry instead of the module-level
 * GENERATE_NPC_SCRIPT constant, and the four capability-read refusals from
 * server.js's four-refusal table (regen, model-3d, set-trait, trait-choices)
 * actually letting a ship through instead of hard-refusing it on
 * `item.kind !== 'npc'`.
 *
 * The stub stands in for generate-spaceship.py. It answers --trait-choices
 * with a canned payload (so /api/set-trait's value re-check can pass without
 * a real roller) and otherwise just records its own argv and cwd before
 * exiting - optionally after a delay, so the "second regen while one runs"
 * case has something to observe still running.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5226;

const TABLES_FIXTURE = '## Role\n\n- a dockworker\n';

// Mined for the same four constants lib/overrideTables.js already knows how
// to parse off a real generator script - see api.rerollTrait.test.js and
// api.setTrait.test.js for the identical trick. RAW_REROLLABLE_TRAITS is
// spelled as the comprehension the generator actually writes: there is no
// list of names in it to read, only an exclusion.
const SHIP_CONSTANTS = [
    '/*',
    'REQUIRED_TABLES = [',
    '    "Ship name", "Ship type", "Size", "Weapon", "Backdrop",',
    ']',
    'TRAIT_DEPENDENTS = {}',
    'REROLLABLE_TRAITS = (',
    '    "Size",',
    ')',
    'RAW_REROLLABLE_TRAITS = tuple(',
    '    name for name in REQUIRED_TABLES',
    '    if name not in ("Ship name",))',
    '*/',
].join('\n');

const SIZE_PAYLOAD = {
    trait: 'Size',
    current: 'small || light',
    dependents: [],
    choices: [
        {
            value: 'small || light', heading: 'Size',
            allowed: true, current: true, conflicts: [], releases: [],
        },
        {
            value: 'medium || armored', heading: 'Size',
            allowed: true, current: false, conflicts: [], releases: [],
        },
    ],
};

/** `sleepMs` holds the spawn open, so a second request can observe it still running. */
function shipStub({ sleepMs = 0 } = {}) {
    return `${SHIP_CONSTANTS}
const fs = require('fs'), path = require('path');
// argv[0] here is the invoked script itself (process.argv sliced past only
// the node executable, not past the script too) - the brief's own way of
// checking which generator the server actually spawned.
const fullArgv = process.argv.slice(1);
const argv = fullArgv.slice(1);
fs.appendFileSync(
    path.join(__dirname, 'argv.log'),
    JSON.stringify({ argv, script: fullArgv[0], cwd: process.cwd() }) + '\\n');

if (argv.includes('--trait-choices')) {
    process.stdout.write(${JSON.stringify(JSON.stringify(SIZE_PAYLOAD))});
    process.exit(0);
}
setTimeout(() => process.exit(0), ${sleepMs});
`;
}

const SHIP_ID = 'ship-aurora-drift-1';
const EMPTY_SHIP_ID = 'ship-hollow-hulk-1';

function manifestFor(dir) {
    const entry = (name, id, extra) => [
        path.join(dir, 'ship-output', 'Frigate', name),
        {
            id,
            kind: 'spaceship',
            name,
            when: '2026-09-07 09:00:00',
            seed: 54321,
            traits: { Size: 'small', Weapon: 'a mass driver' },
            ...extra,
        },
    ];
    return Object.fromEntries([
        entry('Aurora Drift', SHIP_ID, {
            rawTraits: { Size: 'small || light', Weapon: 'a mass driver || mil' },
        }),
        entry('Hollow Hulk', EMPTY_SHIP_ID, { rawTraits: {} }),
    ]);
}

async function startShipServer(t, { sleepMs = 0 } = {}) {
    const s = await startTestServer({
        tablesText: TABLES_FIXTURE,
        port: PORT,
        spaceshipGeneratorSource: shipStub({ sleepMs }),
        spaceshipTablesText: TABLES_FIXTURE,
    });
    t.after(() => s.stop());
    fs.writeFileSync(s.manifestPath, JSON.stringify(manifestFor(s.dir)));
    return s;
}

function regenerate(s, body) {
    return fetch(`${s.baseUrl}/api/regenerate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function rerollTrait(s, body) {
    return fetch(`${s.baseUrl}/api/reroll-trait`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function setTrait(s, body) {
    return fetch(`${s.baseUrl}/api/set-trait`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const LOG_PATH = (s) => path.join(s.dir, 'argv.log');

/** How many lines the ship stub has appended so far - 0 before it has ever run. */
function shipArgvCount(s) {
    try {
        return fs.readFileSync(LOG_PATH(s), 'utf8').trim().split('\n').filter(Boolean).length;
    } catch {
        return 0;
    }
}

/**
 * The next line the ship stub appends after `skip` already exist, parsed.
 * Defaulting `skip` to shipArgvCount(s) at call time would race the very
 * request the caller is about to make, so it has to be captured by the
 * caller BEFORE firing that request - see waitForShipArgv() below, which
 * does exactly that.
 */
async function lastShipArgv(s, { skip = 0 } = {}) {
    for (let i = 0; i < 60; i++) {
        if (shipArgvCount(s) > skip) {
            const lines = fs.readFileSync(LOG_PATH(s), 'utf8').trim().split('\n').filter(Boolean);
            return JSON.parse(lines[lines.length - 1]);
        }
        await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error('the ship generator was never spawned');
}

/**
 * Fires `send()` and returns the argv of the `expectCount`-th spawn it
 * caused (1 by default) - counted from before `send()` runs, so a request
 * this test already knows spawns twice (a --trait-choices validation query
 * then the regen itself) can ask for the SECOND one specifically instead of
 * racing the first.
 */
async function waitForShipArgv(s, send, expectCount = 1) {
    const skip = shipArgvCount(s) + expectCount - 1;
    const res = await send();
    const argv = await lastShipArgv(s, { skip });
    return { res, ...argv };
}

/** Wait until the item view reports that the current ship regen completed. */
async function waitForShipRegenDone(s) {
    for (let i = 0; i < 60; i++) {
        const res = await fetch(`${s.baseUrl}/api/items?category=spaceship`);
        const { items } = await res.json();
        const ship = items.find((it) => it.id === SHIP_ID);
        if (ship?.regenStatus === 'done') return;
        if (ship?.regenStatus === 'error') {
            throw new Error(`ship regeneration failed: ${ship.regenError}`);
        }
        await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error('ship regeneration did not complete');
}

test('a regen spawns the ship script with --regen-manifest, --regen-id and --new-seed', async (t) => {
    const s = await startShipServer(t);
    const { res, argv, script, cwd } = await waitForShipArgv(s, () => regenerate(s, {
        id: SHIP_ID, which: 'both', seedMode: 'specific', seed: 99,
    }));
    assert.equal(res.status, 202);
    assert.equal(script, path.join(s.dir, 'generate-spaceship.js'));
    assert.match(argv.join(' '), /--regen-manifest/);
    assert.match(argv.join(' '), new RegExp(`--regen-id ${SHIP_ID}`));
    assert.match(argv.join(' '), /--new-seed 99/);
    assert.doesNotMatch(argv.join(' '), /--no-portrait|--no-token/);
    // The child ran from beside the ship script, not the NPC one.
    assert.equal(cwd, s.dir);
});

test('which:"portrait" adds --no-token, which:"token" adds --no-portrait', async (t) => {
    const s = await startShipServer(t, { sleepMs: 100 });

    let { res, argv } = await waitForShipArgv(s, () => regenerate(s, {
        id: SHIP_ID, which: 'portrait', seedMode: 'specific', seed: 1,
    }));
    assert.equal(res.status, 202);
    assert.match(argv.join(' '), /--no-token/);
    assert.doesNotMatch(argv.join(' '), /--no-portrait/);
    await waitForShipRegenDone(s);

    ({ res, argv } = await waitForShipArgv(s, () => regenerate(s, {
        id: SHIP_ID, which: 'token', seedMode: 'specific', seed: 2,
    })));
    assert.equal(res.status, 202);
    assert.match(argv.join(' '), /--no-portrait/);
    assert.doesNotMatch(argv.join(' '), /--no-token/);
    await waitForShipRegenDone(s);
});

test('reroll-trait on a ship spawns --reroll-trait', async (t) => {
    const s = await startShipServer(t);
    const { res, argv } = await waitForShipArgv(
        s, () => rerollTrait(s, { id: SHIP_ID, table: 'Weapon' }));
    assert.equal(res.status, 202);
    assert.match(argv.join(' '), /--reroll-trait Weapon/);
});

test('set-trait on a ship is a 202, not the old hard-coded 400', async (t) => {
    const s = await startShipServer(t);
    // Two spawns: the --trait-choices value check, then the regen itself.
    const { res, argv } = await waitForShipArgv(s, () => setTrait(s, {
        id: SHIP_ID, table: 'Size', value: 'medium || armored',
    }), 2);
    assert.equal(res.status, 202);
    assert.match(argv.join(' '), /--set-trait Size=medium \|\| armored/);
});

test('a ship with no raw bullets is refused the same "recorded no raw bullets" message', async (t) => {
    const s = await startShipServer(t);
    const res = await setTrait(s, { id: EMPTY_SHIP_ID, table: 'Size', value: 'medium || armored' });
    assert.equal(res.status, 400);
    const { error } = await res.json();
    assert.match(error, /recorded no raw bullets/);
});

test('a second regen while one runs is a 409 "already regenerating"', async (t) => {
    const s = await startShipServer(t, { sleepMs: 1000 });
    const first = await regenerate(s, { id: SHIP_ID, which: 'both', seedMode: 'specific', seed: 5 });
    assert.equal(first.status, 202);

    const second = await regenerate(s, { id: SHIP_ID, which: 'both', seedMode: 'specific', seed: 6 });
    assert.equal(second.status, 409);
    const body = await second.json();
    assert.match(body.reason, /already regenerating/);

    // Let the slow child finish before the fixture directory is torn down -
    // removing it out from under a live child fails on Windows.
    for (let i = 0; i < 100; i++) {
        const { items } = await (await fetch(`${s.baseUrl}/api/items?category=spaceship`)).json();
        const ship = items.find((it) => it.id === SHIP_ID);
        if (ship.regenStatus !== 'running') break;
        await new Promise((r) => setTimeout(r, 50));
    }
});
