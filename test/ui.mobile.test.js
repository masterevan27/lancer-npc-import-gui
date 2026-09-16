const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// The phone layer: one max-width 700px block in style.css plus the JS that
// backs it. Source assertions over index.html, app.js, style.css and
// secret-mode.js, as the other ui.* files. See
// docs/superpowers/specs/2026-09-15-mobile-layout-design.md.
const PORT = 5270;
const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

/** Pull one top-level function's source (brace-balanced) out of app.js, unevaluated. */
function extractSource(js, name) {
    const start = js.search(new RegExp(`(?:async )?function ${name}\\(`));
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
    return js.slice(start, end);
}

/** The text of the one phone block, which every phone rule must live inside. */
function phoneBlock(css) {
    const marker = '/* === Phone layer (<=700px) === */';
    const start = css.indexOf(marker);
    assert.notEqual(start, -1, 'style.css has no phone layer marker comment');
    return css.slice(start);
}

test('the page declares a device-width viewport', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
});

test('style.css carries one phone layer at the 700px breakpoint', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const css = await fetchText(server, '/style.css');
    const block = phoneBlock(css);
    assert.match(block, /@media \(max-width: 700px\)/, 'the phone layer opens with the 700px query');
});

test('app.js exposes the phone breakpoint to behaviour that needs it', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    assert.match(js, /matchMedia\("\(max-width: 700px\)"\)/, 'PHONE_QUERY uses the same breakpoint as the CSS');
    const source = extractSource(js, 'isPhone');
    assert.match(source, /PHONE_QUERY\.matches/);
    assert.match(js, /PHONE_QUERY\.addEventListener\("change"/, 'onPhoneChange re-runs when the breakpoint is crossed');
});

module.exports = { PORT, TABLES_FIXTURE, fetchText, extractSource, phoneBlock };

test('the top bar carries a menu toggle and the current tab name', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    assert.match(html, /id="tabs-toggle"[^>]*aria-controls="tabs"/, 'the toggle names the list it opens');
    assert.match(html, /id="tabs-toggle"[^>]*aria-expanded="false"/, 'the toggle starts closed');
    assert.match(html, /id="current-tab"/, 'the top bar shows which tab is open');
    // Outside #tabs, like the Settings button: switchTab's button loop must
    // never see the toggle as a tab.
    const tabsNav = html.slice(html.indexOf('<nav class="tabs"'), html.indexOf('</nav>'));
    assert.doesNotMatch(tabsNav, /tabs-toggle/, 'the toggle must not sit inside #tabs');
    assert.match(html, /id="settings-version"/, 'the Settings dialog shows the release version');
});

test('the menu opens, closes on a tab choice, and never adds a second version placeholder', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    const js = await fetchText(server, '/app.js');
    // server.js replaces __APP_VERSION__ once, so a second copy would ship raw.
    assert.equal(html.split('__APP_VERSION__').length - 1, 0, 'the served page has no unreplaced placeholder');
    assert.match(js, /classList\.toggle\("is-open"/, 'the toggle flips #tabs.is-open');
    assert.match(extractSource(js, 'switchTab'), /closeTabsMenu\(\)/, 'choosing a tab closes the menu');
    assert.match(extractSource(js, 'switchTab'), /elNav\.currentTab\.textContent/, 'choosing a tab updates the label');
    assert.match(extractSource(js, 'openSettings'), /settingsVersion\.textContent/, 'Settings shows the version text');
});

test('the phone layer turns the tab row into a dropdown', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /\.tabs \{[^}]*display: none/, 'the tab row is hidden until opened');
    assert.match(block, /\.tabs\.is-open \{[^}]*display: flex/, 'is-open shows it');
    assert.match(block, /\.tabs button \{[^}]*min-height: 48px/, 'menu rows are thumb-sized');
    assert.match(block, /\.release-version \{[^}]*display: none/, 'the version leaves the top bar');
});
