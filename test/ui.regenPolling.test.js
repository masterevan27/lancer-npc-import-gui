const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// Two things a user reported, one root cause between them: the "Regenerating…"
// pill on a card never went away until the page was reloaded, and the "finished
// regenerating" banner only turned up later, when something unrelated happened
// to reload the item list.
//
// Neither was a rendering bug. Nothing on this page learns that a regen has
// finished except startPolling(), which re-reads /api/items every two seconds -
// and the two trait handlers started a regen job and never started it. The pill
// was painted once and then nothing ever looked again; the banner's transition
// gate was already primed, so the next list load from any source announced a
// finish that had happened minutes earlier.
//
// The handlers now stage rather than render (see ui.detailRepaint.test.js), so
// what is pinned here is that every path which still starts a real regen job
// starts the poller too, does it before the list reload that can throw, and
// records the job as started so a failure that beats the first poll is still
// announced. Plus the two ways the poller used to quit on a job that was still
// running.
//
// There is no DOM harness in this repo - see ui.rerollConfirm.test.js for why -
// so what is read is the served source text of /app.js, the same technique
// ui.regenBanner.test.js documents.
const PORT = 5222;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

/**
 * The body of one `x.addEventListener('click', async () => { … });` binding.
 *
 * Brace-matched from the arrow's `{` rather than regexed to a `}` in column
 * one: these handlers are top-level bindings whose closing brace is indented,
 * so the trick refreshItems() is lifted with does not work on them.
 */
function liftHandler(js, binding) {
    const start = js.indexOf(binding);
    assert.notEqual(start, -1, `app.js no longer binds ${binding}`);
    let depth = 0;
    for (let i = js.indexOf('{', start); i < js.length; i += 1) {
        if (js[i] === '{') depth += 1;
        if (js[i] === '}') {
            depth -= 1;
            if (depth === 0) return js.slice(start, i + 1);
        }
    }
    throw new Error(`could not find the end of ${binding}`);
}

/** One top-level function's source, brace-matched from its own `function` keyword. */
function liftSource(js, name) {
    const start = js.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `app.js no longer defines ${name}`);
    // From past the parameter list, not from the first `{` after the name: a
    // function taking a destructured options object opens a brace in its own
    // signature, and matching that one lifts nothing but the parameter names.
    const body = js.indexOf('{', js.indexOf(')', start));
    let depth = 0;
    for (let i = body; i < js.length; i += 1) {
        if (js[i] === '{') depth += 1;
        if (js[i] === '}') {
            depth -= 1;
            if (depth === 0) return js.slice(start, i + 1);
        }
    }
    throw new Error(`could not find the end of ${name}`);
}

async function appJs(t) {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    return fetchText(server, '/app.js');
}

test('the Regenerate button starts the poller', async (t) => {
    const js = await appJs(t);
    const handler = liftHandler(js, "el.regenBtn.addEventListener('click'");
    assert.match(handler, /startPolling\(\)/,
        'pressing Regenerate queues a job that nothing then watches, so the card keeps its '
        + '"Regenerating…" pill until the page is reloaded');
});

test('the 3D build starts the poller', async (t) => {
    const js = await appJs(t);
    const handler = liftHandler(js, "el.model3dBtn.addEventListener('click'");
    assert.match(handler, /startPolling\(\)/, 'a 3D build is left unwatched');
});

test('the poller is started before the list reload, not after', async (t) => {
    const js = await appJs(t);
    // The ordering is the whole point. refreshItems() goes through api(), which
    // throws on any non-OK response, and both handlers wrap their tail in a
    // try/catch - so a 202 followed by one failing /api/items lands in the
    // catch and skips whatever came after the await. That is precisely the case
    // where a poller is most needed: the job really is running.
    for (const binding of ["el.regenBtn.addEventListener('click'",
        "el.model3dBtn.addEventListener('click'"]) {
        const handler = liftHandler(js, binding);
        const polls = handler.indexOf('startPolling()');
        const reloads = handler.indexOf('await refreshItems()');
        assert.notEqual(polls, -1, `${binding} does not start the poller`);
        assert.notEqual(reloads, -1, `${binding} no longer reloads the list`);
        assert.ok(polls < reloads,
            `${binding} starts the poller after the list reload, so a transient /api/items `
            + 'failure leaves a running job with nothing watching it');
    }
});

test('a started regen is recorded, so a failure that beats the first poll is still announced', async (t) => {
    const js = await appJs(t);
    // The banner announces a transition, and needs a `before` to do it. The
    // server records status:'error' synchronously when the spawn itself fails
    // and the route still answers 202, so the job can be over before the first
    // /api/items lands - and the gate, seeing no previous status for the item,
    // drops it. Seeding from the click is what closes that.
    assert.match(js, /function noteRegenStarted\(/,
        'nothing records that this page started a regen, so a spawn failure is silent');
    const note = liftSource(js, 'noteRegenStarted');
    assert.match(note, /regenSeen\.set\(id, 'running'\)/,
        'noteRegenStarted does not seed the transition gate detectRegenFinished reads');

    const handler = liftHandler(js, "el.regenBtn.addEventListener('click'");
    assert.match(handler, /noteRegenStarted\(/, 'the Regenerate button records nothing');
    const notes = handler.indexOf('noteRegenStarted(');
    assert.ok(notes < handler.indexOf('await refreshItems()'),
        'the job is recorded after the list reload that can throw, so it may never be recorded');
});

test('renderRegenPanel does not overwrite a trait-specific message', async (t) => {
    const js = await appJs(t);
    // The panel repaints on every poll tick, and its running branch used to
    // write the generic sentence unconditionally - so "Re-rolling Hair…",
    // written by the click, survived exactly two seconds. Fixing the poller
    // without fixing this turns every trait-named message into dead code.
    const panel = liftSource(js, 'renderRegenPanel');
    assert.match(panel, /state\.regenRunningMessage\s*\r?\n?\s*\|\|/,
        'the running branch writes the generic line over whatever the click said');
    assert.match(panel, /'Regenerating… this can take a few minutes/,
        'the generic line is gone entirely, so a plain Regenerate now says nothing');
});

test('the poll cap allows for the generator\'s own timeout', async (t) => {
    const js = await appJs(t);
    const poll = liftSource(js, 'startPolling');
    // 600 ticks was 20 minutes. A regen queues a portrait, a token and the
    // background-removal pass, each with generate-npc.py's own 1800s default,
    // so the cap cut off runs that were still perfectly fine - and nothing
    // re-arms the poller afterwards.
    assert.doesNotMatch(poll, /ticks > \(building3d \? 1800 : 600\)/,
        'the poller still gives a regen 20 minutes against a job allowed 90');
    const cap = /const cap = (\d+)/.exec(poll);
    assert.ok(cap, 'startPolling no longer names its tick cap, so this check is vacuous');
    assert.ok(Number(cap[1]) >= 2700,
        `the cap is ${cap[1]} ticks, which is under the 90 minutes a regen may legally take`);
    // And it says so rather than stopping silently: the card keeps its pill
    // either way, and nothing else on the page would explain it.
    assert.match(poll, /Still working after 90 minutes/,
        'the poller gives up without saying anything');
});

test('a momentarily empty item list does not stop the poller', async (t) => {
    const js = await appJs(t);
    const poll = liftSource(js, 'startPolling');
    // generate-npc.py rewrites the whole manifest at the very end of a regen
    // and the server answers [] for a half-written one, so the tick most likely
    // to read empty is the one landing on exactly the transition this poller
    // exists to see. An empty list read as "nothing is pending" clears the
    // interval with the job still running.
    assert.match(poll, /state\.items\.length === 0/,
        'an unreadable item list is still treated as "nothing is pending"');
    assert.match(poll, /!stillPending && !listUnreadable/,
        'the stop condition does not consult whether the list was readable');
});

test('a job started while a tick is in flight does not take the poller down', async (t) => {
    const js = await appJs(t);
    const poll = liftSource(js, 'startPolling');
    // A tick spends most of its two seconds awaiting /api/items, and
    // startPolling() is a no-op while a timer exists - so a job started inside
    // that window is absent from the list the tick is holding, and the tick
    // would clear the interval over a job it never saw.
    assert.match(poll, /state\.pollWanted \+= 1/,
        'startPolling does not record that polling was asked for again');
    assert.match(poll, /const wantedAtEntry = state\.pollWanted/,
        'the tick takes no snapshot to compare against');
    assert.match(poll, /state\.pollWanted === wantedAtEntry/,
        'the tick clears the interval without checking whether a job started under it');
});
