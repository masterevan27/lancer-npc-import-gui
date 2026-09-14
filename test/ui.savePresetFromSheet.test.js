const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// The "Save as Create preset…" button on an NPC's sheet. Same source-assertion
// approach as ui.sillyTavernImport.test.js - there is no DOM harness in this
// repo (see ui.rerollConfirm.test.js for why) - with the one pure function
// lifted out and run. The route itself is covered by
// api.createPresetFromItem.test.js.
const PORT = 5266;

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

/** Copied from ui.sillyTavernImport.test.js: app.js touches `document` as it loads. */
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

/** The click handler's source, from its addEventListener to the closing `});`. */
function clickHandler(js) {
    const m = /el\.detailSavePreset\.addEventListener\('click'[\s\S]*?\n\}\);/.exec(js);
    assert.ok(m, 'no click handler for the sheet\'s Save as Create preset button');
    return m[0];
}

async function serve(t) {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    return server;
}

test('the sheet carries the button beside Delete, and a status line of its own', async (t) => {
    const server = await serve(t);
    const html = await fetchText(server, '/index.html');
    const js = await fetchText(server, '/app.js');

    assert.match(html, /<button id="detail-save-preset" type="button"[^>]*>Save as Create preset&hellip;<\/button>/);
    assert.match(html, /<p class="detail-preset-status" id="detail-preset-status" hidden><\/p>/);
    assert.match(js, /detailSavePreset: document\.getElementById\('detail-save-preset'\)/);
    assert.match(js, /detailPresetStatus: document\.getElementById\('detail-preset-status'\)/);
});

test('openDetail hides the button for a background and clears the last outcome', async (t) => {
    const server = await serve(t);
    const body = functionBody(await fetchText(server, '/app.js'), 'openDetail');
    // A background has no traits, seed or Create tab; an NPC or a ship does.
    assert.match(body, /el\.detailSavePreset\.hidden = isBackground/);
    // Re-enabled and blanked on every open, so a sheet opened after a failed
    // save elsewhere does not arrive greyed out or wearing the wrong message.
    assert.match(body, /el\.detailSavePreset\.disabled = false/);
    assert.match(body, /setDetailPresetStatus\(''\)/);
});

test('the click posts the item id and a prompted name, then refreshes the right tab', async (t) => {
    const server = await serve(t);
    const click = clickHandler(await fetchText(server, '/app.js'));

    // The prompt defaults to the NPC's name as a label, and a cancelled
    // prompt (null) posts nothing.
    assert.match(click, /window\.prompt\('Name this preset', item\.name \|\| ''\)/);
    assert.match(click, /if \(name === null\) return/);
    assert.match(click, /api\('\/api\/create-presets\/from-item',\s*\{\s*method: 'POST'/);
    assert.match(click, /body: JSON\.stringify\(\{ id: item\.id, name \}\)/);
    // Never a background: the route would 404 and the button is hidden anyway.
    assert.match(click, /item\.kind === BACKGROUND_KIND\) return/);
    // The dropdown on the tab of the item's own kind, with the new preset chosen.
    assert.match(click, /item\.kind === 'spaceship'\) await refreshShipCreatePresets\(slug\)/);
    assert.match(click, /else await refreshCreatePresets\(slug\)/);
    // The button comes back whichever way the save went.
    assert.match(click, /finally \{\s*el\.detailSavePreset\.disabled = false/);
});

test('the saved message names the tab the preset actually went to', async (t) => {
    const server = await serve(t);
    const presetSavedMessage = liftFunction(await fetchText(server, '/app.js'), 'presetSavedMessage');

    assert.equal(presetSavedMessage('Like Vela', 3, 'npc'),
        'Saved “Like Vela” with 3 overrides. Load it from the Create NPC tab\'s Presets.');
    assert.equal(presetSavedMessage('Kestrel class', 1, 'spaceship'),
        'Saved “Kestrel class” with 1 override. Load it from the Create Spaceship tab\'s Presets.');
    // An item with no kind is an NPC, the same default the server takes.
    assert.match(presetSavedMessage('Blank', 0, undefined), /0 overrides.*Create NPC/);
});
