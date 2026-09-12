const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// The Backgrounds category on the Import tab, and the banner a background
// render raises. Backgrounds arrive as /api/items rows under synthetic
// `bg:<rel>` ids (see backgroundGridItem in server.js), so the grid, its
// checkboxes and Delete Selected need no new code paths of their own - what
// is pinned here is the handful of places the client does branch: the
// label, the empty-grid text, the disabled Import button, the reduced sheet
// and the render poller's banner call. No DOM harness in this repo; same
// source-assertion approach as ui.backgrounds.test.js.
const PORT = 5240;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

// Top-level only: anchored to the start of a line, so an inner helper that
// happens to share the name (openSetTrait has its own render()) is skipped.
function functionBody(js, name) {
    const m = new RegExp(`(?:^|\\n)(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`).exec(js);
    assert.ok(m, `app.js no longer defines ${name} as a top-level function`);
    return m[0];
}

test('the category is labelled and the empty grid points at the Create Background tab', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    assert.match(js, /const CATEGORY_LABELS = \{[^}]*background: 'Backgrounds'/,
        'the banner and the category button fall back to CATEGORY_LABELS, so it must know the kind');
    assert.match(js, /const BACKGROUND_KIND = 'background';/);
    assert.match(functionBody(js, 'render'), /render one on the Create Background tab/,
        'an empty Backgrounds grid must not tell the user to run a generator script');
});

test('Import Selected is off for backgrounds, in the toolbar and at the click', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    assert.match(functionBody(js, 'updateToolbar'),
        /el\.importBtn\.disabled = state\.selected\.size === 0 \|\| noImport/,
        'the toolbar must disable Import for the backgrounds category');
    const click = /el\.importBtn\.addEventListener\('click'[\s\S]{0,300}?state\.category === BACKGROUND_KIND\) return;/.exec(js);
    assert.ok(click, 'the Import click handler must refuse the backgrounds category too');
});

test('the sheet is reduced for a background and hands the still to the Create Background tab', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/index.html');
    assert.match(html, /<button id="detail-open-background" type="button" hidden>Open in Create Background<\/button>/);

    const js = await fetchText(server, '/app.js');
    assert.match(functionBody(js, 'openDetail'),
        /el\.detailSheet\.classList\.toggle\('detail--background', isBackground\)[\s\S]*?openBackgroundDetail\(item\)/,
        'openDetail must mark the sheet and hand a background to openBackgroundDetail');
    // The poll tick repaints through renderDetailFor, so it has to branch too
    // or a loop that lands while the sheet is open would repaint as an NPC.
    assert.match(functionBody(js, 'renderDetailFor'), /renderBackgroundDetail\(item\)/);
    const open = functionBody(js, 'openBackgroundDetail');
    for (const panel of ['regenPanel', 'model3dPanel', 'animatePanel']) {
        assert.match(open, new RegExp(`el\\.${panel}\\.hidden = true`), `${panel} must be hidden by hand`);
    }
    assert.match(open, /markSeen\(\[item\.id\]\)/, 'opening a background must mark it seen like an NPC');

    const css = await fetchText(server, '/style.css');
    assert.match(css, /\.detail--background #detail-traits,\s*\.detail--background #detail-prompts/,
        'the traits and prompts must be hidden on a background sheet');
    assert.match(css, /\.card--background img \{[^}]*aspect-ratio: 16 \/ 9/,
        'a background card must not crop its still to a square');

    const jump = /el\.detailOpenBackground\.addEventListener\('click'[\s\S]*?\n\}\);/.exec(js);
    assert.ok(jump, 'no click handler for the Open in Create Background button');
    assert.match(jump[0], /switchTab\('backgrounds'\)[\s\S]*?await loadBackgrounds\(\);\s*openBackgroundAnimate\(rel\)/,
        'the jump must load the gallery before selecting the still in it');
});

test('a finished render raises the batch banner with the background kind', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const body = js.slice(js.indexOf('async function startBackgroundRender('));
    const onDone = /onDone: \(job\) => \{[\s\S]*?\n    \},/.exec(body);
    assert.ok(onDone, 'startBackgroundRender no longer has an onDone');
    assert.match(onDone[0], /announceBatchComplete\(job\.produced, job\.producedIds, BACKGROUND_KIND\)/,
        'the render poller must announce through the same banner NPC and ship runs use');
    // Inside the produced branch, not before the zero and error checks: a
    // failed run is not "finished generating".
    const failedFirst = onDone[0].indexOf("job.status === 'error'");
    const announceAt = onDone[0].indexOf('announceBatchComplete(');
    assert.ok(failedFirst !== -1 && failedFirst < announceAt, 'the error check must come before the announce');
});
