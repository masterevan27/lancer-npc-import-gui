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

/**
 * Like liftFunction, but for an `async function` - liftFunction's brace
 * match starts at `function `, which drops the `async` keyword and would
 * turn every `await` inside the body into a syntax error. This keeps the
 * keyword by wrapping the whole lifted text in a `return (...)` function
 * expression instead of appending a bare `return name;`.
 */
function liftAsyncFunction(js, name, helpers = {}) {
    const marker = `async function ${name}(`;
    const start = js.indexOf(marker);
    assert.notEqual(start, -1, `app.js no longer defines async function ${name}`);
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
    return new Function(...names, `return (${js.slice(start, end)});`)(
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
    assert.deepEqual(pills({ animation: null, status: 'error', error: 'boom' }), ['Failed'],
        'a chained loop that failed must not render silently under the render\'s own success line');
    assert.deepEqual(pills({ animation: { stale: false }, status: 'error', error: 'boom' }), ['Failed', 'Animated'],
        'a stale failure still shows the loop it failed to replace');
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

test('a stale animate completion cannot orphan a second, still-running poll', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    // The real-world trigger: open a still, click Animate (job1 starts),
    // close the panel while job1's poll tick is mid-await, reopen the same
    // still and click Animate again (job2 starts) before job1's in-flight
    // tick resolves. clearInterval only cancels *future* ticks, so that
    // tick still runs to completion and still calls job1's own onDone - and
    // the rel alone cannot tell job1's now-stale completion from job2's,
    // because reopening the very same still makes the rel match again.
    const item = { rel: 'a.png', url: '/img/a.png', name: 'A', animation: null, status: null };
    const state = {
        items: [item],
        selected: item.rel,
        motionPrompts: [],
        animateTimer: null,
        animateJobId: null,
    };
    const el = {
        motionText: { value: 'smoke drifts' },
        animateSeed: { value: '' },
        pingpong: { checked: true },
        animateBtn: { disabled: false },
        animateStatus: { textContent: '' },
        animateLog: { hidden: false, textContent: '' },
        panel: { hidden: false },
    };

    // pollBackgroundJob is faked out entirely: each call gets a distinct
    // token standing in for the real setInterval id, and the test keeps
    // every call's onDone so it can fire completions in whatever order it
    // likes - independent of real timers, which is the whole point of the
    // race under test.
    let nextJobId = 1;
    const polled = [];
    function fakePollBackgroundJob(jobId, opts) {
        const timer = { jobId };
        polled.push({ jobId, timer, ...opts });
        return timer;
    }

    const opened = [];
    const helpers = {
        backgroundsState: state,
        elBackgrounds: el,
        selectedBackground: () => state.items.find((i) => i.rel === state.selected) || null,
        backgroundSeedMode: () => 'same',
        api: async () => ({ jobId: nextJobId++ }),
        pollBackgroundJob: fakePollBackgroundJob,
        loadBackgrounds: async () => {},
        openBackgroundAnimate: (rel) => opened.push(rel),
    };

    const start = liftAsyncFunction(js, 'startBackgroundAnimate', helpers);
    const close = liftFunction(js, 'closeBackgroundAnimate', helpers);

    await start();
    assert.equal(polled.length, 1, 'the first Animate click should start exactly one poll');
    const job1 = polled[0];
    assert.equal(state.animateTimer, job1.timer, "the tracked timer is job1's");

    // Close mid-poll, then reopen the same still (openBackgroundAnimate is
    // faked out above, so the reopen is simulated the same way it happens
    // for real: selected is set back to the still's rel).
    close();
    assert.equal(state.animateTimer, null, 'closing must hand back the timer slot');
    assert.equal(el.animateBtn.disabled, false, 'closing must hand back the button too');
    state.selected = item.rel;

    // Animate again before job1's tick resolves - job2 starts.
    await start();
    assert.equal(polled.length, 2, 'a second Animate click should start a second poll');
    const job2 = polled[1];
    assert.equal(state.animateTimer, job2.timer, "the tracked timer is now job2's");

    // job1's delayed tick now resolves - the exact race under review.
    await job1.onDone({ status: 'done' });

    assert.equal(state.animateTimer, job2.timer,
        "job1's stale completion must not null out the reference to job2's still-running timer");
    assert.deepEqual(opened, [],
        "job1's stale completion must not reopen the panel on stale data while job2 is still running");

    // job2's own, genuine completion still works exactly as before.
    await job2.onDone({ status: 'done' });
    assert.equal(state.animateTimer, null);
    assert.deepEqual(opened, [item.rel]);
});

test('watchBackgroundGalleryUntilSettled keeps refreshing until nothing is still running', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    // A chained render's onDone sees every item still 'running' - chained
    // animate jobs start before the render itself flips to 'done'. Faking
    // setInterval/clearInterval the way the race test above fakes
    // pollBackgroundJob: the test drives ticks itself instead of waiting on
    // the real 2-second interval.
    const state = {
        items: [{ rel: 'a.png', status: 'running' }],
        galleryWatchTimer: null,
    };
    const intervalCbs = [];
    const cleared = [];
    let loadCalls = 0;
    const helpers = {
        backgroundsState: state,
        loadBackgrounds: async () => {
            loadCalls += 1;
            if (loadCalls >= 2) state.items = [{ rel: 'a.png', status: 'done' }];
        },
        setInterval: (cb) => { intervalCbs.push(cb); return intervalCbs.length; },
        clearInterval: (id) => { cleared.push(id); },
    };

    const watch = liftFunction(js, 'watchBackgroundGalleryUntilSettled', helpers);
    watch();
    assert.equal(intervalCbs.length, 1, 'a running item must start exactly one watch interval');

    await intervalCbs[0](); // tick 1: loadBackgrounds still says running
    assert.equal(cleared.length, 0, 'must keep polling while an item is still running');
    assert.equal(loadCalls, 1);

    await intervalCbs[0](); // tick 2: loadBackgrounds now says the chain landed
    assert.deepEqual(cleared, [1], 'must stop the interval once nothing is running');
    assert.equal(state.galleryWatchTimer, null, 'must hand back its own timer slot');

    // A second call after settling must not think it is already watching.
    watch();
    assert.equal(intervalCbs.length, 1, 'nothing is running any more, so a second call starts nothing');
});

test('watchBackgroundGalleryUntilSettled does nothing when nothing is running', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    const state = { items: [{ rel: 'a.png', status: 'done' }], galleryWatchTimer: null };
    const setIntervalCalls = [];
    const watch = liftFunction(js, 'watchBackgroundGalleryUntilSettled', {
        backgroundsState: state,
        loadBackgrounds: async () => {},
        setInterval: (cb) => { setIntervalCalls.push(cb); return 1; },
        clearInterval: () => {},
    });
    watch();
    assert.equal(setIntervalCalls.length, 0, 'a settled gallery must not start an interval at all');
});

test('watchBackgroundGalleryUntilSettled does not stack a second interval while one is running', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    const state = { items: [{ rel: 'a.png', status: 'running' }], galleryWatchTimer: null };
    const setIntervalCalls = [];
    const watch = liftFunction(js, 'watchBackgroundGalleryUntilSettled', {
        backgroundsState: state,
        loadBackgrounds: async () => {},
        setInterval: (cb) => { setIntervalCalls.push(cb); return setIntervalCalls.length; },
        clearInterval: () => {},
    });
    watch();
    watch();
    watch();
    assert.equal(setIntervalCalls.length, 1, 'a second render finishing mid-watch must not start a duplicate');
});

test('startBackgroundRender watches the gallery after its own refresh, source assertion', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const body = js.slice(js.indexOf('async function startBackgroundRender('));
    assert.match(body.slice(0, 2500), /loadBackgrounds\(\)\s*\.then\(\(\) => watchBackgroundGalleryUntilSettled\(\)\)/,
        'onDone must watch for a chain still landing after its own one-shot refresh');
});
