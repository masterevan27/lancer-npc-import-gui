const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// Task 6: the Create Spaceship tab and the Tables kind select. There is no
// DOM harness in this repo, so - same approach as ui.rerollConfirm.test.js,
// ui.setTraitPicker.test.js and ui.kindVocab.test.js - the served /index.html
// and /app.js are fetched over HTTP and checked either by source-assertion
// or by lifting a pure top-level function out and running it directly.
const PORT = 5232;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

/**
 * Lift one top-level function out of app.js, optionally injecting free
 * variables it closes over by name - the same mechanism ui.kindVocab.test.js
 * and ui.setTraitPicker.test.js use, copied rather than imported because
 * app.js touches `document` as it loads and so cannot be required directly.
 */
function liftFunction(js, name, helpers = {}) {
    const start = js.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `app.js no longer defines ${name}`);
    let depth = 0;
    let end = -1;
    for (let i = js.indexOf('{', start); i < js.length; i += 1) {
        if (js[i] === '{') depth += 1;
        if (js[i] === '}') {
            depth -= 1;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    assert.notEqual(end, -1, `could not find the end of ${name}`);
    const names = Object.keys(helpers);
    // eslint-disable-next-line no-new-func
    return new Function(...names, `${js.slice(start, end)}\nreturn ${name};`)(
        ...names.map((k) => helpers[k]));
}

/* ---- the form itself ---- */

test('index.html carries the fifth tab and the Create Spaceship form', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/index.html');
    assert.match(html, /data-tab="shipcreate"/, 'no fifth tab button for the Create Spaceship tab');
    assert.match(html, /id="tab-shipcreate"/, 'no #tab-shipcreate panel');

    const panel = /<section class="tab-panel" id="tab-shipcreate"[\s\S]*?<\/section>/.exec(html);
    assert.ok(panel, '#tab-shipcreate is no longer a <section class="tab-panel">');
    const body = panel[0];

    for (const id of ['create-ship-count', 'create-ship-seed', 'create-ship-type',
        'create-ship-size', 'create-ship-theme']) {
        assert.match(body, new RegExp(`id="${id}"`), `#tab-shipcreate is missing #${id}`);
    }

    // No Pronouns, no Unarmed run - person-only concepts a ship's own
    // /api/create validation refuses outright (see handleCreateRequest in
    // server.js), so the form must never be able to send either.
    assert.doesNotMatch(body, /create-ship-pronouns/,
        '#tab-shipcreate offers a Pronouns control, which no ship has');
    assert.doesNotMatch(body, /unarmed/i,
        '#tab-shipcreate offers an Unarmed control, which is a person-only concept');
});

test('a fifth tab has no sixth: the tab bar names exactly these five', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/index.html');
    const nav = /<nav class="tabs" id="tabs">[\s\S]*?<\/nav>/.exec(html);
    assert.ok(nav, '#tabs is no longer a <nav>');
    const tabs = [...nav[0].matchAll(/data-tab="([\w-]+)"/g)].map((m) => m[1]);
    assert.deepEqual(tabs, ['import', 'create', 'shipcreate', 'traits', 'tables']);
});

test('the Tables tab carries a #tables-kind select', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/index.html');
    const tables = /<section class="tab-panel" id="tab-tables"[\s\S]*?<\/section>/.exec(html);
    assert.ok(tables, '#tab-tables is no longer a <section class="tab-panel">');
    assert.match(tables[0], /id="tables-kind"/, '#tab-tables is missing the #tables-kind select');
});

/* ---- app.js wiring ---- */

test('app.js declares shipCreateState and elShipCreate, and switchTab lazy-loads the tab', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    assert.match(js, /const shipCreateState = \{/, 'app.js no longer declares shipCreateState');
    assert.match(js, /const elShipCreate = \{/, 'app.js no longer declares elShipCreate');

    const switchTab = /function switchTab\([\s\S]*?\n\}/.exec(js);
    assert.ok(switchTab, 'switchTab is no longer a top-level function');
    assert.match(switchTab[0], /tab === 'shipcreate'/,
        "switchTab no longer registers 'shipcreate' in its lazy-load block");
});

test('no ship-specific copy of the shared Create-form helpers has appeared', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // The anti-duplication rule, mechanically enforced: a second
    // implementation of any of these five names would mean the pure helpers
    // were copied instead of shared - see the brief's "share every pure
    // helper" list.
    for (const name of ['populateOverrideValues', 'filterTraitOptions', 'traitScopeNote',
        'pollCreateJob', 'setPresetStatus']) {
        const matches = [...js.matchAll(new RegExp(`function ${name}\\(`, 'g'))];
        assert.equal(matches.length, 1, `${name} is declared ${matches.length} times - it should be shared, not copied`);
    }
    // And the detail-sheet guard this task must not defeat, pinned again here
    // for the same reason ui.kindVocab.test.js pins it: a regression in
    // *this* file's own diff is the one this test is actually guarding.
    assert.doesNotMatch(js, /renderShipDetailTraits|renderShipRegenPanel/,
        'a ship-specific copy of the shared trait-rendering machinery has appeared');
});

/* ---- shipCreateRequestBody ---- */

/** A minimal stand-in for the three .value/.checked-bearing DOM elements
 * shipCreateRequestBody reads - just enough surface for the lifted function
 * to run without a real document. */
function fakeInput(value) { return { value }; }
function fakeCheckbox(checked) { return { checked }; }

test('shipCreateRequestBody posts kind:spaceship and folds the pinned selects into overrides', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    const fakeElShipCreate = {
        count: fakeInput('2'),
        seed: fakeInput(''),
        name: fakeInput(''),
        server: fakeInput(''),
        portrait: fakeCheckbox(true),
        token: fakeCheckbox(true),
        keepRaw: fakeCheckbox(false),
    };
    const fakeShipCreateState = {
        pinned: { 'Ship type': 'a rust-streaked patrol boat', Size: 'a small, one-hex runabout', Theme: 'salvage' },
        overrides: [{ table: 'Hull', value: 'a scorched patchwork hull', custom: false }],
    };
    const shipCreateRequestBody = liftFunction(js, 'shipCreateRequestBody', {
        elShipCreate: fakeElShipCreate,
        shipCreateState: fakeShipCreateState,
        SHIP_PINNED_TABLES: ['Ship type', 'Size', 'Theme'],
    });

    const body = shipCreateRequestBody(false);
    assert.equal(body.kind, 'spaceship');
    assert.equal(body.count, 2);
    const tables = body.overrides.map((o) => o.table);
    assert.ok(tables.includes('Ship type'), 'overrides is missing the pinned Ship type row');
    assert.ok(tables.includes('Size'), 'overrides is missing the pinned Size row');
    assert.ok(tables.includes('Theme'), 'overrides is missing the pinned Theme row');
    assert.ok(tables.includes('Hull'), 'overrides dropped the free-form row');
    // No pronouns, no unarmed - a ship's own /api/create validation refuses
    // both outright, so the body must never carry either key.
    assert.equal(body.pronouns, undefined);
    assert.equal(body.unarmed, undefined);
});

test('a blank pinned select is not sent as an empty-string override', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    const shipCreateRequestBody = liftFunction(js, 'shipCreateRequestBody', {
        elShipCreate: {
            count: fakeInput('1'), seed: fakeInput(''), name: fakeInput(''), server: fakeInput(''),
            portrait: fakeCheckbox(true), token: fakeCheckbox(true), keepRaw: fakeCheckbox(false),
        },
        shipCreateState: { pinned: { 'Ship type': '', Size: '', Theme: '' }, overrides: [] },
        SHIP_PINNED_TABLES: ['Ship type', 'Size', 'Theme'],
    });

    assert.deepEqual(shipCreateRequestBody(true).overrides, []);
});

test('the ship submit posts /api/create, not /api/create-npc', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    const startShipCreateJob = /function startShipCreateJob\([\s\S]*?\n\}/.exec(js);
    assert.ok(startShipCreateJob, 'startShipCreateJob is no longer a top-level function');
    assert.match(startShipCreateJob[0], /fetch\('\/api\/create'/,
        'the ship Create form no longer posts to the canonical /api/create route');
    assert.doesNotMatch(startShipCreateJob[0], /\/api\/create-npc/,
        'the ship Create form posts to the NPC-only alias, which always forces kind:npc');
});

/* ---- sizeBlockReason / Type -> Size gating ---- */

// The catalogue fixture, shaped exactly as G4 pins it: `sizes` is an ARRAY of
// objects keyed by sizeBand, not the map an earlier design predicted (see
// readShipCatalogue()'s own docs in server.js and
// test/api.tablesByKind.test.js's CATALOGUE_V1).
const CATALOGUE = {
    types: [{ slug: 'patrol', name: 'Patrol boat', sizes: ['small'], folder: 'Patrol boats' }],
    sizes: [
        {
            sizeBand: 'small', hexes: 1, gridWidth: 1, gridHeight: 1,
            tokenWidth: 1024, tokenHeight: 1024, gloss: 'one hex - light and fast',
        },
        {
            sizeBand: 'huge', hexes: 5, gridWidth: 5, gridHeight: 3,
            tokenWidth: 2048, tokenHeight: 1280, gloss: 'five hexes - a leviathan',
        },
    ],
    themes: ['salvage', 'piracy'],
};
const hugeBullet = 'a leviathan-huge superstructure, five hexes across';
const smallBullet = 'a small, one-hex runabout';

test('sizeBlockReason greys a size the chosen Ship type may not roll', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    const sizeBlockReason = liftFunction(js, 'sizeBlockReason', {
        shipCreateState: { catalogue: CATALOGUE },
    });

    // A patrol boat rolls `small` only (CATALOGUE.types[0].sizes), so `huge`
    // is refused and `small` is not.
    assert.ok(sizeBlockReason(hugeBullet, 'patrol'), 'a patrol boat rolling huge was not blocked');
    assert.equal(sizeBlockReason(smallBullet, 'patrol'), null,
        'a patrol boat rolling its own only legal size was blocked');
});

test('sizeBlockReason degrades to no gating without a catalogue', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    const sizeBlockReason = liftFunction(js, 'sizeBlockReason', {
        shipCreateState: { catalogue: null },
    });

    // Still loading, or the /api/ship-catalogue route failed - either way the
    // form must not lock the user out of Generate over a fact it never
    // learned. Degraded, not broken, per the design's own phase-6 note.
    assert.equal(sizeBlockReason(hugeBullet, 'patrol'), null);
});

test('the seam signature is pinned: sizeBlockReason takes exactly two arguments', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    assert.match(js, /function sizeBlockReason\(sizeBullet, shipTypeSlug\)/,
        'sizeBlockReason no longer matches the two-argument shape the design calls for');
});
