const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// The "N new NPCs finished generating" banner shipped visible on every page
// load, with an empty text span and no run behind it, and its dismiss button
// appeared to do nothing. Both symptoms were one cascade bug: index.html gives
// #batch-banner the `hidden` attribute, but .batch-banner sets `display: flex`,
// and an author declaration beats the browser's own `[hidden] { display: none }`
// before specificity is ever consulted - origin wins the cascade outright. So
// `hidden` was inert, and dismissBatchBanner() setting it back changed nothing
// on screen. The fix is a `.batch-banner[hidden]` guard, the same one every
// other `hidden`-toggled element in that stylesheet already carries.
//
// There is no DOM harness in this repo - every test drives the real server over
// HTTP, and the project carries no dependencies at all - so what is pinned here
// is that the served CSS still guards the rule and that app.js still refuses to
// announce an empty run. That catches the realistic regression (the guard
// dropped, or the count gate removed) without introducing jsdom to assert on a
// computed style.
const PORT = 5207;

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '',
].join('\n');

async function fetchText(server, path) {
    const res = await fetch(`${server.baseUrl}${path}`);
    assert.equal(res.status, 200, `${path} should be served`);
    return res.text();
}

test('the banner ships hidden and the stylesheet honours it', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/');
    assert.match(
        html, /<div class="banner batch-banner" id="batch-banner" hidden>/,
        'the banner no longer ships with the hidden attribute, so it paints on first load');

    const css = await fetchText(server, '/style.css');
    // Both halves matter. Without the guard the attribute is inert; without
    // `display: flex` the guard is vacuously satisfied by a banner that has no
    // layout at all, and the row - centred, with the dismiss button pushed over
    // by `margin-left: auto` - falls apart. Assert on both so the test cannot
    // be passed by deleting the display instead of guarding it.
    //
    // These declarations moved from `.batch-banner` to a shared `.banner` when
    // the regen banner arrived and the two were stacked on one sticky shelf -
    // see test/ui.regenBanner.test.js. Same rules, same cascade bug guarded
    // against, one class carrying it for both banners instead of two copies.
    assert.match(
        css, /\.banner\s*\{[^}]*display:\s*flex/,
        '.banner no longer lays out as a flex row');
    assert.match(
        css, /\.banner\[hidden\]\s*\{[^}]*display:\s*none/,
        'nothing hides .banner when it carries the hidden attribute, so `hidden` does nothing');
});

test('the dismiss control exists and app.js binds it', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/');
    assert.match(html, /id="batch-banner-dismiss"/, 'the banner ships no dismiss control');

    const js = await fetchText(server, '/app.js');
    assert.match(js, /batch-banner-dismiss/, 'app.js never looks the dismiss control up');
    assert.match(js, /dismissBatchBanner/, 'nothing in app.js dismisses the banner');
});

test('the banner is not announced for a run that produced nothing', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // The gate belongs inside announceBatchComplete, not at its one call site,
    // so a future caller cannot resurrect the empty banner. Source-regex in the
    // same spirit as ui.copyPrompts.test.js's data-copy-target check. The window
    // is wide because the guard is not the first thing in the function - the
    // grid refresh runs ahead of it, with the prose that explains why, and that
    // prose is the part likeliest to grow. It is a bound against the guard
    // migrating out of the function, not a budget for the comments.
    assert.match(
        js, /function announceBatchComplete\([\s\S]{0,2400}?count\s*>\s*0/,
        'announceBatchComplete does not guard on a positive count');
    assert.match(
        js, /job\.produced/,
        'app.js never reads the measured count, so it still announces what was requested');
});

test('a measured zero still reloads the grid', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // The count is a measurement of the manifest rather than something the
    // generator reports, so it can miss: generate-npc.py reuses an id for the
    // same name and seed and writes the second NPC to a suffixed folder, which
    // is why the server counts folders rather than ids (see npcEntriesSnapshot)
    // and why a zero is never proof that nothing landed. With the refresh below
    // the zero guard, a miss would leave the Import tab showing a stale grid and
    // the user with no hint that anything had appeared - the one case where a
    // reload is most worth its single request would be the case that skipped it.
    // So the refresh comes first, and the ordering is what is pinned here.
    // Both windows are bounds against the refresh or the guard migrating out
    // of the function, not budgets for the comments between them - the prose
    // above the guard is the part likeliest to grow.
    assert.match(
        js,
        /function announceBatchComplete\([\s\S]{0,1600}?refreshItems\(\)[\s\S]{0,1200}?count\s*>\s*0/,
        'refreshItems() no longer runs before the zero guard, so a measured zero leaves a stale grid');
});

test('dismissing the banner clears only the run it announces', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // The shortest way to write the banner's × is `{ all: true }`, which the
    // server resolves to every id in the manifest across every kind. That is a
    // much larger promise than the banner's own text makes: NPCs rolled at the
    // command line while this server was down stay flagged New across a reboot
    // by design, so a run of one can arrive on top of six unlooked-at tags and
    // that one click would take all seven away. Nothing in this UI can put a
    // tag back, so the × clears the run's own ids and nothing else.
    //
    // No DOM harness here (see the note at the top of this file), so the pin is
    // that nothing in the served app.js asks the server for a library-wide
    // clear, and that the dismiss path is wired to the run's own ids instead.
    // The server still answers `all` - it just has no caller here. Matched
    // against the request body rather than the bare words, because markBatchSeen
    // names that payload in the prose explaining why it does not send it.
    assert.doesNotMatch(
        js, /JSON\.stringify\(\{\s*all:/,
        'app.js still posts a library-wide clear, which a per-run banner must never do');
    assert.match(
        js, /job\.producedIds/,
        'app.js never reads the ids the run reported, so it cannot scope the clear to them');
    assert.match(
        js, /announceBatchComplete\(made, job\.producedIds\)/,
        'the banner is announced without the ids it would need to clear its own run');

    const dismiss = /elBanner\.dismiss\.addEventListener\([\s\S]*?\n\}\);/.exec(js);
    assert.ok(dismiss, 'the dismiss handler is no longer a top-level binding, so this check is vacuous');
    assert.match(
        dismiss[0], /markBatchSeen\(/,
        'the dismiss handler no longer clears the tags of the run it announced');

    // The ids the banner is holding have to come from the announcement itself,
    // not from whatever /api/items last returned - the grid only ever loads one
    // category, and the banner is visible from all four tabs.
    assert.match(
        js, /bannerState\.announcedIds = Array\.isArray\(ids\)/,
        'the banner does not record the ids it was announced with');
});
