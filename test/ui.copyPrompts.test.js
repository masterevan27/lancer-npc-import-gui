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

// The copy buttons and the Re-roll buttons sit a few centimetres apart in the
// same detail sheet, and styled separately they read as two different classes
// of control - a ghost button beside a filled one - which is the complaint that
// put them in one rule. Sharing the rule is the only arrangement that cannot
// drift, so that is what this pins, rather than any particular colour: a future
// repaint of the pair passes and a quiet re-split does not.
test('the copy buttons share Re-roll\'s rule rather than restating it', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const css = await fetchText(server, '/style.css');

    assert.match(
        css, /\.reroll-btn,\s*\.copy-btn\s*\{[^}]*background:/,
        '.copy-btn no longer shares .reroll-btn\'s rule, so the two can drift apart again');
    // The shared rule opens on a line of its own - `.reroll-btn,` then
    // `.copy-btn {` - so "does the class start a rule" cannot tell the joined
    // rule from a re-split one. Count instead: one opening is the shared rule
    // the assertion above just matched, and a second would be a private base
    // colour of the kind the sharing exists to prevent.
    const baseRules = css.match(/^\.copy-btn\s*\{/gm) || [];
    assert.equal(
        baseRules.length, 1,
        '.copy-btn opens a base rule of its own again beside the shared one');
    // The flash states overpaint the shared fill for 1200ms. A border and a
    // text colour alone were enough while the button underneath was
    // transparent; over a filled one they are not, so each state has to bring
    // its own background or the flash says nothing.
    for (const state of ['copied', 'copy-failed']) {
        assert.match(
            css, new RegExp(`\\.copy-btn\\.${state}\\s*\\{[^}]*background:`),
            `.copy-btn.${state} sets no background, so the flash cannot be read over the button's fill`);
    }
});
