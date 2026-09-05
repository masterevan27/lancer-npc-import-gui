const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// The prompts are the reason to open an NPC's detail panel at all: they get
// pasted into ComfyUI or Krea by hand. They were rendered into bare <pre>
// blocks, so getting one out meant a click-drag across a 2000-character
// paragraph, and missing the last line silently truncated the style tail.
//
// There is no DOM harness in this repo - every test drives the real server
// over HTTP, and the project carries no dependencies at all - so what is
// pinned here is that the served page still ships the controls and that
// app.js still binds them to the right <pre>. That catches the realistic
// regression (a control quietly dropped, or its target renamed) without
// introducing jsdom to test a clipboard call.
const PORT = 5206;

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

test('the detail panel ships a copy control for each prompt', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/');

    for (const target of ['detail-portrait-prompt', 'detail-token-prompt']) {
        assert.match(
            html, new RegExp(`data-copy-target="${target}"`),
            `no copy control targets #${target}`);
    }
    assert.match(html, /data-copy-both/, 'no control copies both prompts at once');
});

test('every copy control names a <pre> the page actually renders', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/');

    const targets = [...html.matchAll(/data-copy-target="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(targets.length > 0, 'fixture is vacuous - no copy targets found at all');
    for (const id of targets) {
        assert.match(
            html, new RegExp(`<pre id="${id}"`),
            `copy control targets #${id}, which the page does not render`);
    }
});

test('app.js binds the copy controls rather than shipping them inert', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');

    assert.match(js, /data-copy-target|copyTarget/,
        'app.js never reads the copy-target attribute, so the buttons do nothing');
    assert.match(js, /clipboard/,
        'app.js never reaches the clipboard');
});
