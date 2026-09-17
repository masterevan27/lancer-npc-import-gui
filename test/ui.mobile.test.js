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
    assert.match(extractSource(js, 'openSettings'), /elSettings\.version\.textContent/, 'Settings shows the version text');
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

test('the phone layer makes every sheet full-screen', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /\.detail \{[^}]*height: 100dvh/, 'a sheet fills the viewport');
    assert.match(block, /\.detail \{[^}]*border-radius: 0/);
    assert.match(block, /\.detail-close \{[^}]*position: sticky/, 'the close button stays reachable');
    assert.match(block, /\.detail-images \{[^}]*flex-direction: column/, 'images stack');
    assert.match(block, /\.detail-images img \{[^}]*max-width: 100%/, 'no 32vw cap on a phone');
    assert.match(block, /\.detail--background \.detail-images img \{[^}]*max-width: 100%/, 'nor the 44vw one');
    assert.match(block, /\.trait-image-sheet \{[^}]*width: 100%/);
});

test('opening an overlay adds a history entry and back closes the top one', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const count = extractSource(js, 'openOverlayCount');
    assert.match(js, /const OVERLAY_SELECTOR = "\.detail-overlay, \.image-zoom"/, 'every sheet counts, and the zoom too');
    assert.match(count, /OVERLAY_SELECTOR/, 'counted through the one selector, not a second copy of it');
    const sync = extractSource(js, 'syncOverlayHistory');
    assert.match(sync, /history\.pushState/, 'a newly open overlay pushes an entry');
    assert.match(sync, /history\.go\(-steps\)/, 'an overlay closed from the UI unwinds its entry');
    assert.match(js, /new MutationObserver\(syncOverlayHistory\)/, 'visibility is observed, not hooked per call site');
    assert.match(js, /attributeFilter: \["hidden"\]/);
    assert.match(js, /addEventListener\("popstate"/, 'back is handled');
    const back = extractSource(js, 'closeOverlayForBack');
    assert.match(back, /topmostOverlay\(\)/, 'a stacked sheet closes first');
    assert.match(back, /el\.overlay\.hidden = true/, 'then the NPC sheet, which topmostOverlay() does not cover');
    const handle = extractSource(js, 'handleOverlayBack');
    assert.match(handle, /history\.pushState/, 'a closer that declines gets its entry put back');
    assert.match(handle, /overlayHistory\.pushed = after/, 'and the stack resyncs to what is actually open');
    assert.match(extractSource(js, 'topmostOverlay'), /__overlayClosers/, 'secret-mode overlays are closable too');
});

test('secret mode registers its overlays with the shared closer list', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/secret-mode.js');
    assert.match(js, /window\.__overlayClosers/, 'it pushes onto the shared list');
    assert.match(js, /secret-detail-overlay/);
    assert.match(js, /secret-login-overlay/);
});

test('the NPC sheet can be navigated and zoomed without a keyboard', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    const js = await fetchText(server, '/app.js');
    assert.match(html, /id="detail-prev"/, 'the sheet has a Previous button');
    assert.match(html, /id="detail-next"/, 'and a Next button');
    const zoom = extractSource(js, 'attachImageZoom');
    // CAN_HOVER is declared once, above the function, not inside it - so the
    // media query itself is checked against the whole file, and only its
    // use (CAN_HOVER.matches) is checked against the function body.
    assert.match(js, /CAN_HOVER = window\.matchMedia\("\(hover: hover\)"\)/, 'hover-to-zoom is only for devices that hover');
    assert.match(zoom, /CAN_HOVER\.matches/, 'the zoom checks hover capability before showing');
    assert.match(zoom, /addEventListener\("click"/, 'a tap zooms on the rest');
    const swipe = extractSource(js, 'attachSwipeNav');
    assert.match(swipe, /touchstart/);
    assert.match(swipe, /stepDetail\(/, 'a swipe moves through the grid order');
    // SWIPE_MIN_X is declared once, above the function, not inside it.
    assert.match(js, /SWIPE_MIN_X = 60/, 'a swipe needs real horizontal travel');
    assert.match(swipe, /SWIPE_MIN_X/, 'the function uses that threshold');
    assert.match(swipe, /identifier/, 'only the finger that started the gesture can end it');
    assert.match(swipe, /touchcancel/, 'an interrupted gesture is dropped');
    assert.match(js, /elDetailNav\.prev\.addEventListener\("click", \(\) => stepDetail\(-1\)\)/);
});

test('keyboard-only hints are hidden on a phone', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const block = phoneBlock(await fetchText(server, '/style.css'));
    // .detail-shortcuts and .trait-shortcuts share a rule body with
    // .regen-row .hint (comma-grouped selectors), so only the last of the
    // three is immediately followed by "{" - these two look past the
    // other selector names for the shared "{ display: none".
    assert.match(block, /\.detail-shortcuts[^{]*\{[^}]*display: none/);
    assert.match(block, /\.trait-shortcuts[^{]*\{[^}]*display: none/);
    assert.match(block, /\.regen-row \.hint \{[^}]*display: none/, 'the secret sheet hint mentions hover and Esc');
});

test('the zoom helper stays extractable by the secret-mode test', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    // ui.secretMode.test.js slices this exact span, from `const CAN_HOVER`
    // to `attachImageZoom(el.detailPortrait)`, and evaluates it in a bare
    // `new Function('el', 'window', ...)` bound to a stubbed window whose
    // only member is matchMedia. This span must stay identical to that one.
    const span = js.slice(js.indexOf('const CAN_HOVER'), js.indexOf('attachImageZoom(el.detailPortrait)'));
    assert.doesNotMatch(span, /\bdocument\b/, 'nothing in this span may touch document');
    assert.doesNotMatch(span.replace(/window\.matchMedia/g, ''), /\bwindow\b/, 'the only window use allowed here is matchMedia, the one thing the stub provides');
});

test('controls are thumb-sized and never zoom the page on focus', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /font-size: 16px/, 'Chrome zooms into any field under 16px');
    assert.match(block, /min-height: 44px/, 'tap targets are at least 44px');
    assert.match(block, /\.form-grid \{[^}]*grid-template-columns: 1fr/);
    assert.match(block, /overflow-x: auto/, 'wide tables and prompts scroll inside themselves');
    assert.match(block, /\.job-log \{[^}]*white-space: pre-wrap/);
    assert.match(block, /main \{[^}]*overflow-x: clip/, 'clip, not hidden: hidden would stop the sticky action bar from sticking');
    assert.doesNotMatch(block, /overflow-x: hidden/, 'nothing in the phone layer may create a scroll container around the action bar');
    assert.match(block, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/, 'checkboxes and radios keep their own size');
});

test('the shared filter panel and action bar exist', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const css = await fetchText(server, '/style.css');
    const block = phoneBlock(css);
    assert.match(block, /\.mobile-action-bar \{[^}]*position: sticky/);
    assert.match(block, /\.mobile-action-bar \{[^}]*bottom: 0/);
    assert.match(block, /padding-bottom/, 'a panel leaves room for its own bar');
    assert.match(css, /\.mobile-filters > summary \{/, 'the wrapper has a summary at every width');
    const js = await fetchText(server, '/app.js');
    const sync = extractSource(js, 'syncMobileFilters');
    assert.match(sync, /isPhone\(\)/, 'closed on a phone, open above the breakpoint');
    assert.match(sync, /\.open = /);
    assert.match(js, /onPhoneChange\(syncMobileFilters\)/, 'and it follows the breakpoint');
});

test('the import toolbar splits into a filter panel and an action bar', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    const gallery = html.slice(html.indexOf('id="public-gallery"'), html.indexOf('id="tab-create"'));
    assert.match(gallery, /<details class="mobile-filters" id="import-filters"/, 'the filter rows collapse');
    // Search stays outside the panel: it is the one filter worth a permanent slot.
    const panel = gallery.slice(gallery.indexOf('id="import-filters"'));
    assert.doesNotMatch(panel.slice(0, panel.indexOf('</details>')), /id="filter-search"/);
    assert.match(gallery, /<div class="mobile-action-bar" id="import-actions"/);
    assert.match(gallery.slice(gallery.indexOf('id="import-actions"')), /id="import-btn"/);
});

test('the phone layer reflows the galleries', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /\.grid \{[^}]*minmax\(150px, 1fr\)/, 'two columns at 360px');
    assert.match(block, /\.categories \{[^}]*flex-wrap: nowrap/, 'category pills scroll sideways');
    assert.match(block, /\.card \.check \{[^}]*width: 24px/, 'the card checkbox gets a real tap target');
    assert.match(block, /\.toolbar > \.mobile-action-bar \{[^}]*position: fixed/, 'a bar inside a one-row toolbar is fixed, since a sticky one could not leave the toolbar');
    assert.match(block, /\.toolbar > \.mobile-action-bar \{[^}]*bottom: 0/);
});

test('each tab comes back at its own scroll position', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    assert.match(js, /const tabState = \{[^}]*scroll: \{\}/, 'tabState keeps one offset per tab');
    const source = extractSource(js, 'switchTab');
    // The page scrolls at the document, so the offset is shared unless
    // switchTab saves it on the way out and restores it on the way in.
    assert.match(source, /tabState\.scroll\[tabState\.current\] = window\.scrollY/, 'the tab being left records where it was');
    assert.match(source, /window\.scrollTo\(0, tabState\.scroll\[tab\] \?\? 0\)/, 'the tab being opened returns there, or to the top');
    const save = source.indexOf('tabState.scroll[tabState.current] = window.scrollY');
    const assign = source.indexOf('tabState.current = tab');
    const restore = source.indexOf('window.scrollTo(0, tabState.scroll[tab]');
    const unhide = source.indexOf('panel.hidden = panel.id !== `tab-${tab}`');
    assert.ok(save !== -1 && save < assign, 'save before tabState.current moves to the new tab');
    assert.ok(unhide !== -1 && restore > unhide, 'restore only after the new panel is showing, or there is nothing to scroll');
    const reapply = extractSource(js, 'reapplyTabScroll');
    assert.match(reapply, /tabState\.current !== pending\.tab/, 'only while still on that tab');
    assert.match(reapply, /window\.scrollY !== pending\.landed/, 'and only if the user has not scrolled since');
    assert.match(source, /refreshTraitCandidates\(\)[\s\S]*?\.finally\(\(\) => reapplyTabScroll\(pendingScroll\)\)/, 'Trait Imports rebuilds on every visit, so it re-applies');
    assert.match(source, /loadBackgrounds\(\)[\s\S]*?\.finally\(\(\) => reapplyTabScroll\(pendingScroll\)\)/, 'as does Create Background');
    assert.match(source, /ensureShipCreateForm\(\)[\s\S]*?\.finally\(\(\) => reapplyTabScroll\(pendingScroll\)\)/, 'Create Spaceship re-renders its rows on every visit, so it re-applies too');
});

test('Create NPC sticks its generate buttons to the bottom on a phone', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    const create = html.slice(html.indexOf('id="tab-create"'), html.indexOf('id="tab-shipcreate"'));
    assert.match(create, /class="form-row create-actions mobile-action-bar"/);
    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /#override-rows .filter-row,[\s\S]{0,200}flex-direction: column/, 'override rows stack');
    assert.match(block, /\.create-presets-row \{[^}]*grid-template-columns: repeat\(2, 1fr\)/);
    assert.match(block, /#override-rows \.filter-row > button/, 'only the row\'s own buttons go full width');
    assert.doesNotMatch(block, /#override-rows \.filter-row button/, 'a descendant selector would also stretch the nested Clear button');
    assert.doesNotMatch(block, /\.create-presets-row \.create-preset-status/, 'the status line is a sibling of the row, so that selector matches nothing');
});

test('Create Spaceship gets the same phone treatment as Create NPC', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    const ship = html.slice(html.indexOf('id="tab-shipcreate"'), html.indexOf('id="tab-backgrounds"'));
    assert.match(ship, /class="form-row create-actions mobile-action-bar"/);
});

test('Trait Imports defaults to tiles on a phone but remembers a choice', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const read = extractSource(js, 'readTraitView');
    assert.match(read, /localStorage\.getItem\(TRAIT_VIEW_STORAGE_KEY\)/, 'a stored choice still wins');
    assert.match(read, /isPhone\(\)/, 'with nothing stored, a phone starts on tiles');
});

test('Trait Imports puts its filters and actions where a thumb can reach', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    const traits = html.slice(html.indexOf('id="tab-traits"'), html.indexOf('id="tab-tables"'));
    assert.match(traits, /<details class="mobile-filters" id="trait-filters-panel"/);
    assert.match(traits, /<div class="mobile-action-bar" id="trait-actions"/);
    const block = phoneBlock(await fetchText(server, '/style.css'));
    // The shortcuts' pointer equivalents already exist: the row checkbox
    // selects and the row itself opens the sheet. They just need to be big.
    assert.match(block, /\.trait-row input\[type="checkbox"\] \{[^}]*width: 24px/);
    assert.match(block, /\.trait-row \{[^}]*flex-wrap: wrap/);
});

test('Create Background sticks its render buttons to the bottom', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    const bg = html.slice(html.indexOf('id="tab-backgrounds"'), html.indexOf('id="tab-traits"'));
    assert.match(bg, /<div class="filter-row mobile-action-bar" id="bg-dynamic-actions"/);
    assert.match(bg.slice(bg.indexOf('id="bg-dynamic-actions"')), /id="bg-dynamic-render"/);
    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /\.bg-render \.filter-row \{[^}]*flex-direction: column/);
    assert.match(block, /\.bg-prompt \{[^}]*white-space: pre-wrap/);
});
