const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// A finished regenerate used to speak in exactly one place: the "Done - new
// seed N" line inside the detail sheet, written by renderRegenPanel() for
// whichever item the overlay happened to be showing. A regen takes minutes, so
// the overwhelmingly likely thing for a user to do is close the sheet and go
// and do something else - and then nothing on the page ever said the art had
// landed. That is the same complaint the batch banner was built to answer for
// a generate run, so a regen gets a banner of its own on the same shelf.
//
// There is no DOM harness in this repo and no dependencies at all - every test
// drives the real server over HTTP - so what is pinned here is that the served
// index.html, style.css and app.js still carry the wiring. Same approach, and
// same reasoning, as test/ui.batchBanner.test.js and test/ui.newBadge.test.js.
const PORT = 5212;

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

test('the regen banner ships hidden and the stylesheet honours it', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/');
    assert.match(
        html, /<div class="banner regen-banner" id="regen-banner" hidden>/,
        'the regen banner no longer ships with the hidden attribute, so it paints on first load');

    const css = await fetchText(server, '/style.css');
    // The same pair of assertions ui.batchBanner.test.js makes, and for the
    // same cascade reason: `display: flex` is an author declaration and beats
    // the browser's own `[hidden] { display: none }` outright, so without the
    // guard the markup's `hidden` attribute is inert and the banner paints
    // empty on every load. Assert on both halves so the test cannot be passed
    // by deleting the display instead of guarding it.
    assert.match(
        css, /\.banner\s*\{[^}]*display:\s*flex/,
        '.banner no longer lays out as a flex row');
    assert.match(
        css, /\.banner\[hidden\]\s*\{[^}]*display:\s*none/,
        'nothing hides .banner when it carries the hidden attribute, so `hidden` does nothing');
});

test('the two banners share one sticky shelf', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/');
    // Both banners inside one wrapper, in that order. Stacking two separately
    // sticky siblings would have the second slide under the first; hanging the
    // stickiness on the shared parent keeps them as one shelf whatever
    // combination of them is up, and an empty shelf has no height and no
    // background, so nothing paints when neither is showing.
    assert.match(
        html,
        /<div class="banner-stack">[\s\S]{0,600}?id="batch-banner"[\s\S]{0,600}?id="regen-banner"[\s\S]{0,400}?<\/div>\s*<\/div>/,
        'the two banners are no longer wrapped in one .banner-stack shelf');

    const css = await fetchText(server, '/style.css');
    assert.match(
        css, /\.banner-stack\s*\{[^}]*position:\s*sticky/,
        'the shelf is not sticky, so the banners scroll away with the page');
    // The banners are announcements about a run whose end the user cannot see,
    // so they must be readable from all four tabs - which is only true while
    // they live outside every .tab-panel, i.e. ahead of <main>.
    const stackAt = html.indexOf('class="banner-stack"');
    const mainAt = html.indexOf('<main>');
    assert.ok(stackAt !== -1 && mainAt !== -1 && stackAt < mainAt,
        'the banner shelf moved inside <main>, so it is no longer visible from every tab');
});

test('a regen is announced on a transition, never on a status seen once', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // The whole correctness of this banner is the transition. regenStatus is
    // read off an in-memory server map that keeps a finished job for the life
    // of the process, so a page opened an hour after a regen still sees `done`
    // on that item - and announcing on `=== 'done'` alone would raise a banner
    // for a job the user watched finish yesterday, on every load, forever.
    // So the previous status has to be recorded and the announcement gated on
    // having actually watched it go from running to something else.
    assert.match(
        js, /regenSeen/,
        'app.js keeps no record of the previous regen status, so it cannot detect a transition');
    assert.match(
        js, /function detectRegenFinished\(/,
        'the transition scan is no longer its own function');
    const detect = /function detectRegenFinished\([\s\S]*?\n\}/.exec(js);
    assert.ok(detect, 'detectRegenFinished is no longer a top-level function, so this check is vacuous');
    assert.match(
        detect[0], /previous !== 'running'/,
        'the scan does not require the previous status to have been running, so it announces stale jobs');
});

test('the scan runs over every item, not just the one whose sheet is open', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // state.regenLastStatus - what renderRegenPanel() uses for its "Done - new
    // seed N" line - tracks exactly one item, the open one, and is reset every
    // time openDetail() runs. Reusing it here would mean the banner only ever
    // fires for a sheet that is still open, which is the case that already
    // works and precisely not the one this banner exists for. The scan reads
    // the whole list instead.
    //
    // It hangs off refreshItems() rather than off the poll tick, which is not
    // just tidiness. refreshItems() reloads whichever category is selected and
    // the poller stops itself as soon as nothing in *that* category is pending,
    // so a regen left running while the user looks at Mechs takes the poller
    // down with it and the finish is never seen. Scanning on every list load
    // means switching back to NPCs picks the transition up, because regenSeen
    // is keyed by id and is never pruned - see the note on it.
    // Non-greedy to the first `}` in column one, which is the function's own -
    // every brace inside it is indented. Written as `\n\}` rather than
    // `\n\}\n`, because the served file has CRLF endings and the trailing `\n`
    // would have to be `\r\n`.
    const refresh = /async function refreshItems\(\)[\s\S]*?\n\}/.exec(js);
    assert.ok(refresh, 'refreshItems is no longer a top-level function, so this check is vacuous');
    assert.match(
        refresh[0], /detectRegenFinished\(state\.items\)/,
        'refreshItems no longer scans the reloaded item list for finished regens');
    // After the locallySeen re-application and before render(), so a banner is
    // never raised over a list the page has not finished reconciling.
    assert.match(
        refresh[0], /detectRegenFinished\(state\.items\)[\s\S]*?render\(\)/,
        'the scan runs after render(), so the banner and the grid can disagree for a frame');
});

test('the banner announces failures as well as finishes', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // A regen that died after ten minutes of nothing visible happening is at
    // least as worth interrupting someone for as one that worked. Today a
    // failure leaves a "Regen failed" badge on a card the user may never scroll
    // back to, and the reason only inside the sheet.
    assert.match(
        js, /finished regenerating/,
        'nothing in app.js announces a finished regen');
    assert.match(
        js, /failed to regenerate/,
        'nothing in app.js announces a failed regen');

    const css = await fetchText(server, '/style.css');
    assert.match(
        css, /\.banner\.error/,
        'the failure announcement is not visually distinguished from a success');
    assert.match(
        js, /classList\.toggle\('error'/,
        'app.js never switches the banner into its failure colours');
});

test('the regen banner has its own dismiss and show controls, wired up', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/');
    assert.match(html, /id="regen-banner-dismiss"/, 'the regen banner ships no dismiss control');
    assert.match(html, /id="regen-banner-show"/, 'the regen banner ships no show control');

    const js = await fetchText(server, '/app.js');
    assert.match(js, /regen-banner-dismiss/, 'app.js never looks the regen dismiss control up');
    assert.match(js, /dismissRegenBanner/, 'nothing in app.js dismisses the regen banner');

    // The x on this banner hides it and does nothing else. It deliberately does
    // NOT reach for markBatchSeen: a regenerated NPC is one the user already
    // knows about and it carries no New tag to clear, so borrowing the batch
    // banner's dismiss would clear tags this banner never announced.
    const dismiss = /elRegenBanner\.dismiss\.addEventListener\([\s\S]*?\n\}\);/.exec(js);
    assert.ok(dismiss, 'the regen dismiss handler is no longer a top-level binding');
    assert.doesNotMatch(
        dismiss[0], /markBatchSeen|markSeen/,
        'the regen banner dismiss clears New tags, which it has no business touching');
});
