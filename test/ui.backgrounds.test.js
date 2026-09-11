const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// There is no DOM harness in this repo - same approach as
// ui.shipCreate.test.js and ui.kindVocab.test.js: fetch the served
// /index.html and /app.js over HTTP and check them either by
// source-assertion or by lifting a pure top-level function out and running it.
const PORT = 5238;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

/** Copied from ui.shipCreate.test.js - app.js touches `document` as it loads
 *  and so cannot be required directly. */
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

/** A document with one [data-feature] node, recording what got removed. */
function fakeDocument(features) {
    const removed = [];
    const nodes = features.map((feature) => ({
        dataset: { feature },
        remove() { removed.push(feature); },
    }));
    return {
        removed,
        querySelectorAll(sel) {
            assert.equal(sel, '[data-feature]');
            return nodes;
        },
        // An active tab button always survives here, so the fallback click
        // never fires and never needs a stub of its own.
        querySelector() { return {}; },
    };
}

test('index.html carries the Backgrounds tab and its panel', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/index.html');
    assert.match(html, /data-tab="backgrounds"[^>]*data-feature="backgrounds"/,
        'the tab button must carry data-feature="backgrounds"');
    assert.match(html, /id="tab-backgrounds"/, 'no #tab-backgrounds panel');
    // The panel itself must NOT carry data-feature: elBackgrounds reads its
    // ids at load, and removing the panel would leave every one of them null.
    // The ship tab sets the same precedent.
    const panel = /<section class="tab-panel" id="tab-backgrounds"[^>]*>/.exec(html);
    assert.ok(panel, 'no #tab-backgrounds section tag');
    assert.ok(!/data-feature/.test(panel[0]), 'the panel must not be removable');
});

test('applyFeatureAvailability removes a feature the server did not report', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    const doc = fakeDocument(['backgrounds']);
    liftFunction(js, 'applyFeatureAvailability', { document: doc })([]);
    assert.deepEqual(doc.removed, ['backgrounds'],
        'an EMPTY features array must remove the node - that is the whole gate');
});

test('applyFeatureAvailability keeps a feature the server did report', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    const doc = fakeDocument(['backgrounds']);
    liftFunction(js, 'applyFeatureAvailability', { document: doc })(['backgrounds']);
    assert.deepEqual(doc.removed, []);
});

test('applyFeatureAvailability changes nothing for a missing or malformed field', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    for (const value of [undefined, null, 'backgrounds', 7, { backgrounds: true }]) {
        const doc = fakeDocument(['backgrounds']);
        liftFunction(js, 'applyFeatureAvailability', { document: doc })(value);
        assert.deepEqual(doc.removed, [],
            `a ${typeof value} features field must degrade to today's UI`);
    }
});

test('loadCategories hands features to applyFeatureAvailability', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const source = js.slice(js.indexOf('async function loadCategories('));
    assert.match(source.slice(0, 800), /applyFeatureAvailability\(features\)/,
        'loadCategories must apply the feature gate as well as the kind gate');
});

test('backgroundEntryLabel falls back to the prefix when no heading was found', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const label = liftFunction(js, 'backgroundEntryLabel');
    assert.equal(label({ name: 'Canyon Skirmish — A Night Raid', prefix: 'Canyon-Skirmish' }),
        'Canyon Skirmish — A Night Raid');
    assert.equal(label({ name: '', prefix: 'Canyon-Skirmish' }), 'Canyon-Skirmish');
});

test('backgroundPills names the loop, the staleness and the running job', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const pills = liftFunction(js, 'backgroundPills');

    assert.deepEqual(pills({ animation: null, status: null }), [],
        'a still with no loop carries no pills');
    assert.deepEqual(pills({ animation: { stale: false }, status: null }), ['Animated']);
    assert.deepEqual(pills({ animation: { stale: true }, status: null }), ['Animated', 'Stale']);
    assert.deepEqual(pills({ animation: null, status: 'running' }), ['Animating…'],
        'a stale nothing is nothing, but a running job still shows');
});

test('pickBackgroundMotion never repeats the prompt already showing', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    const two = liftFunction(js, 'pickBackgroundMotion', {
        backgroundsState: { motionPrompts: ['smoke drifts', 'rain falls'] },
    });
    assert.equal(two('smoke drifts'), 'rain falls');

    const one = liftFunction(js, 'pickBackgroundMotion', {
        backgroundsState: { motionPrompts: ['smoke drifts'] },
    });
    assert.equal(one('smoke drifts'), 'smoke drifts', 'a pool of one is the only honest repeat');

    const none = liftFunction(js, 'pickBackgroundMotion', {
        backgroundsState: { motionPrompts: [] },
    });
    assert.equal(none(null), null);
});

test('the Animate panel posts the text it settled on, not a staged one', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    // There is no /api/backgrounds/description route: the motion prompt is
    // chosen in the panel, shown nowhere else, and dies with the panel.
    assert.ok(!js.includes('/api/backgrounds/description'),
        'the client must not stage a description server-side');
    const body = js.slice(js.indexOf('async function startBackgroundAnimate('));
    assert.match(body.slice(0, 1200), /description: elBackgrounds\.motionText\.value/);
});
