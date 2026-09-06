const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// The detail sheet shows an NPC's portrait and token but never said where on
// disk they were, so finding the source files meant guessing the generator's
// <category>/<name> nesting. A Files block now names the folder, beneath the
// "Generated <when>" line and above the Regenerate panel - grouped with the
// other facts about where this NPC came from, and visible without scrolling
// past two panels and a trait table.
//
// A browser cannot open a local folder from an http page (Chrome refuses
// file:// navigation from one), so the path is text to read and copy rather
// than a link, and it reuses the prompts' Copy button - the same LAN clipboard
// fallback included. There is no DOM harness in this repo, so what is pinned
// is that the page ships the block, that app.js fills it from the fields
// /api/items now carries, and that the copy delegation actually reaches it.
const PORT = 5214;

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

test('the detail sheet ships a Files block naming the folder and its filenames', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/');

    assert.match(html, /<pre id="detail-folder-path"/,
        'the sheet renders nowhere to put the folder path');
    assert.match(html, /id="detail-file-names"/,
        'the sheet names no filenames beside the folder');
    assert.match(html, /data-copy-target="detail-folder-path"/,
        'the folder path ships without a Copy button, which is the only way to get it off the page');
});

test('the Files block sits between the generated line and the Regenerate panel', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/');

    const generated = html.indexOf('id="detail-generated"');
    const files = html.indexOf('id="detail-files"');
    const regen = html.indexOf('id="regen-panel"');
    const traits = html.indexOf('id="detail-traits"');
    assert.ok(generated >= 0 && files >= 0 && regen >= 0 && traits >= 0, 'fixture is vacuous');
    assert.ok(generated < files, 'the Files block was moved above the generated line');
    assert.ok(files < regen && files < traits,
        'the Files block sank below the Regenerate panel or the trait table, where it needs scrolling to find');
});

test('app.js fills the Files block from the fields /api/items carries', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');

    // includes() rather than assert.match() throughout this file: app.js is
    // 120KB, and a failed match prints the entire `actual` string, which buries
    // the one line of the failure that says anything.
    for (const field of ['folderPath', 'portraitFile', 'tokenFile']) {
        assert.ok(js.includes(`item.${field}`),
            `app.js never reads item.${field}, so the Files block ships empty`);
    }
    assert.ok(js.includes('detail-folder-path'),
        'app.js never looks up the folder-path element');
});

// The Files block's Copy button sits above the trait table, outside
// #detail-prompts. The delegation was bound to that pane alone, so a button
// added anywhere else on the sheet ships inert - which looks exactly like a
// working button until it is clicked.
test('the copy delegation covers the whole sheet, not just the prompts pane', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');

    assert.ok(/el\.overlay\.addEventListener\(\s*'click'/.test(js),
        'no click delegation on the sheet itself, so a copy button outside #detail-prompts does nothing');
    assert.ok(!/el\.detailPrompts\.addEventListener\(\s*'click'/.test(js),
        'the copy delegation is still bound to the prompts pane alone');
});
