const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// The "Import into SillyTavern" button, in the two places a background is
// looked at: the Create Background tab's Animate panel and the Import tab's
// detail sheet. Same source-assertion approach as ui.importBackgrounds.test.js
// - no DOM harness here - with the one pure function lifted and run.
const PORT = 5242;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

function functionBody(js, name) {
    const m = new RegExp(`(?:^|\\n)(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`).exec(js);
    assert.ok(m, `app.js no longer defines ${name} as a top-level function`);
    return m[0];
}

/** Copied from ui.backgrounds.test.js: app.js touches `document` as it loads. */
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

async function serve(t) {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    return server;
}

test('a gallery card says when its still is already in SillyTavern', async (t) => {
    const server = await serve(t);
    const backgroundPills = liftFunction(await fetchText(server, '/app.js'), 'backgroundPills');
    assert.deepEqual(backgroundPills({ sillyTavern: { imported: true } }), ['In SillyTavern']);
    assert.deepEqual(backgroundPills({ sillyTavern: { imported: false } }), []);
    assert.deepEqual(backgroundPills({}), [], 'an item with no record is not marked');
    // After the loop, which is the fact about the still itself.
    assert.deepEqual(backgroundPills({ animation: {}, sillyTavern: { imported: true } }),
        ['Animated', 'In SillyTavern']);
});

test('the Animate panel carries the button and hides it when there is nowhere to copy to', async (t) => {
    const server = await serve(t);
    const html = await fetchText(server, '/index.html');
    const js = await fetchText(server, '/app.js');

    assert.match(html, /<button type="button" id="bg-st-import-btn">Import into SillyTavern<\/button>/);
    assert.match(html, /<p class="regen-status" id="bg-st-import-status"><\/p>/);
    assert.match(js, /stImportBtn: document\.getElementById\('bg-st-import-btn'\)/);

    // The panel's opener is what decides visibility, off the flag the
    // gallery load stored, so a config.json edit is noticed on the next visit.
    assert.match(functionBody(js, 'loadBackgrounds'),
        /backgroundsState\.sillyTavern = data\.sillyTavern \|\| \{ available: false, dir: '' \}/);
    assert.match(functionBody(js, 'openBackgroundAnimate'),
        /elBackgrounds\.stImportBtn\.hidden = !backgroundsState\.sillyTavern\.available/);
});

test('the Animate panel button posts the rel and refreshes the gallery', async (t) => {
    const server = await serve(t);
    const js = await fetchText(server, '/app.js');
    const body = functionBody(js, 'importBackgroundToSillyTavern');
    assert.match(body, /api\('\/api\/backgrounds\/import',\s*\{\s*method: 'POST'/);
    assert.match(body, /body: JSON\.stringify\(\{ rel/);
    assert.match(body, /await reload\(\)/, 'the In SillyTavern pill comes from a reload, not a local flip');
    const click = /elBackgrounds\.stImportBtn\.addEventListener\('click'[\s\S]*?\n\}\);/.exec(js);
    assert.ok(click, 'no click handler for the Animate panel button');
    assert.match(click[0], /reload: loadBackgrounds/, 'the panel reloads the gallery');
});

test('the Import tab sheet offers the same button for a background only', async (t) => {
    const server = await serve(t);
    const html = await fetchText(server, '/index.html');
    const js = await fetchText(server, '/app.js');

    assert.match(html, /<button id="detail-import-sillytavern" type="button" hidden>Import into SillyTavern<\/button>/);
    assert.match(js, /detailImportSillyTavern: document\.getElementById\('detail-import-sillytavern'\)/);
    // Hidden for an NPC or a ship, and for a background with no folder to go to.
    assert.match(functionBody(js, 'openDetail'),
        /el\.detailImportSillyTavern\.hidden = !isBackground \|\| !item\.background\?\.sillyTavern\?\.available/);
    // The sheet's own line says what it is called over there.
    assert.match(functionBody(js, 'renderBackgroundDetail'), /In SillyTavern as/);
    assert.match(js, /el\.detailImportSillyTavern\.addEventListener\('click'/);
});
