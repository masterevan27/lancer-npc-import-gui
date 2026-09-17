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

test('the top bar fits a 360px phone in Secret mode', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    // Final review, A4: the spec wants the gear alone on a phone, so the word
    // is its own element and the button keeps an accessible name without it.
    assert.match(html, /id="settings-open"[^>]*aria-label="Settings"/, 'the button is still named when its label is hidden');
    assert.match(html, /<span class="settings-label">Settings<\/span>/, 'the word can be hidden on its own');
    const css = await fetchText(server, '/style.css');
    const block = phoneBlock(css);
    assert.match(block, /\.settings-label \{ display: none/, 'only the gear shows on a phone');
    assert.match(block, /#leave-secret \{[^}]*font-size: var\(--fs-sm\)/, 'Leave Secret keeps its label but gets compact');
    assert.match(block, /\.topbar-actions \{[^}]*flex-shrink: 1/, 'the actions may shrink rather than push the page sideways');
    assert.doesNotMatch(block, /\.topbar-actions \{[^}]*min-width: 0/, 'below min-content the actions would spill past the edge rather than wrap');
    // Final review, B2: the version line is phone-only - desktop keeps it in the top bar alone.
    assert.match(css.slice(0, css.indexOf('/* === Phone layer (<=700px) === */')), /\.settings-version \{[^}]*display: none/, 'desktop does not show the version twice');
    assert.match(block, /\.settings-version \{ display: block/, 'a phone shows it in Settings instead');
    // Final review, B3: the sticky Save row matches the phone sheet's padding, not the desktop 24px.
    assert.match(block, /\.settings-dialog \.confirm-actions \{[^}]*bottom: -0\.9rem/);
    assert.match(block, /\.settings-dialog \.confirm-actions \{[^}]*margin-bottom: -0\.9rem/);
});

test('the app places scroll itself, so closing an overlay cannot move the page', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    // Final review, A1: every close runs history.go(), and with "auto" the
    // browser would restore the offset that entry was pushed at over ours.
    assert.match(js, /history\.scrollRestoration = "manual"/);
    assert.ok(js.indexOf('history.scrollRestoration = "manual"') < js.indexOf('history.pushState'),
        'set before anything can push an entry');
    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /\.detail \{[^}]*overscroll-behavior: contain/, 'scrolling a sheet does not carry on into the page behind it');
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
    // Final review, B1: re-tapping the tab already open closes the menu too.
    const switching = extractSource(js, 'switchTab');
    const close = switching.indexOf('closeTabsMenu()');
    const same = switching.indexOf('if (tab === tabState.current) return;');
    assert.ok(close !== -1 && same !== -1 && close < same, 'the menu closes before the same-tab early return');
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
    // Final review, A3: the base rule's id specificity beats a bare .detail.
    assert.match(block, /#trait-detail-overlay \.detail \{[^}]*width: 100vw/, 'the Trait Imports sheet is full-screen too');
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
    // Final review, A6: sliced from the push, because the keydown handler
    // above it names both ids too.
    const push = js.slice(js.indexOf('__overlayClosers ||= ['));
    const trait = push.indexOf("'set-trait-overlay'");
    const detail = push.indexOf("'secret-detail-overlay'");
    assert.ok(trait !== -1 && detail !== -1 && trait < detail,
        'the set-trait picker sits on top of the secret sheet, so back closes it first');
});

test('the Secret tables start collapsed on a phone', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/secret-mode.js');
    // Final review, B10: through the existing collapse function, only on a
    // phone. isPhone() is app.js's; the disable-tables list sits inside the
    // same #secret-tables-content, so this collapses both.
    assert.match(js, /if \(typeof root\.isPhone === 'function' && root\.isPhone\(\)\) setSecretTablesCollapsed\(true\);/);
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
    assert.match(block, /\.mobile-filters::details-content \{ display: block; \}/, 'a closed panel must hide its contents on a phone');
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
    // Final review, A5: each loader's chain is cut at its own statement end
    // (the first `;` outside any bracket), so a lazy match cannot run on into
    // the next loader's .finally.
    const chain = (name) => {
        // The call itself, chained - not a comment that mentions it.
        const start = source.search(new RegExp(`${name}\\(\\)\\s*\\.`));
        assert.notEqual(start, -1, `switchTab no longer calls ${name}()`);
        let depth = 0;
        for (let i = start; i < source.length; i += 1) {
            if ('({['.includes(source[i])) depth += 1;
            if (')}]'.includes(source[i])) depth -= 1;
            if (source[i] === ';' && depth === 0) return source.slice(start, i + 1);
        }
        return source.slice(start);
    };
    const reapplies = /\.finally\(\(\) => reapplyTabScroll\(pendingScroll\)\);$/;
    assert.match(chain('refreshTraitCandidates'), reapplies, 'Trait Imports rebuilds on every visit, so it re-applies');
    assert.match(chain('loadBackgrounds'), reapplies, 'as does Create Background');
    assert.match(chain('ensureShipCreateForm'), reapplies, 'Create Spaceship re-renders its rows on every visit, so it re-applies too');
    assert.equal((source.match(/\.finally\(\(\) => reapplyTabScroll\(pendingScroll\)\)/g) || []).length, 5,
        'ship form, traits, backgrounds, tables and presets each re-apply the offset');
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
    const css = await fetchText(server, '/style.css');
    const block = phoneBlock(css);
    assert.match(block, /\.bg-render \.filter-row \{[^}]*flex-direction: column/);
    assert.match(block, /\.bg-prompt \{[^}]*white-space: pre-wrap/);
    // Fix round 1, finding 2: the spec puts Roll in the action bar too.
    assert.match(bg.slice(bg.indexOf('id="bg-dynamic-actions"')), /id="bg-dynamic-roll-bar"/, 'Roll is in the bar on a phone, as the spec asks');
    // Fix round 1, finding 4: the prompt preview gets a Copy button.
    assert.match(bg, /id="bg-dynamic-copy"/, 'the prompt preview has a Copy button');
    // Fix round 1, finding 1: the phone gap is the shared 0.5rem, not the
    // desktop-restoring base rule's 4px.
    assert.match(block, /\.bg-render \.filter-row\.mobile-action-bar \{[^}]*gap: 0\.5rem/, 'the phone gap is the shared 0.5rem, not the desktop 4px');
    // Fix round 1, finding 2: both phone-only controls are hidden on desktop.
    assert.match(css, /#bg-dynamic-roll-bar,\s*#bg-dynamic-copy \{ display: none; \}/, 'both are phone-only');
    // The real wiring lives in dynamic-backgrounds.js, a separate script tag
    // from app.js (index.html loads both) - that is where these ids and the
    // copy call actually appear.
    const dynamicJs = await fetchText(server, '/dynamic-backgrounds.js');
    assert.match(dynamicJs, /bg-dynamic-roll-bar/, 'the mirror is wired');
    assert.match(dynamicJs, /copyToClipboard\([^)]*textContent\)/, 'Copy reuses the existing helper');
    // Fix round 2: the two option labels share a line in the phone bar, so
    // their nowrap-by-default text needs to be able to wrap.
    assert.match(block, /#bg-dynamic-actions > label \{[^}]*white-space: normal/, 'the two option labels share a line, so their text must wrap');
});

test('the Tables tab is two screens on a phone', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    assert.match(html, /id="tables-back"/, 'the bullets screen can go back');
    const js = await fetchText(server, '/app.js');
    const show = extractSource(js, 'showTableBullets');
    assert.match(show, /classList\.add\("is-bullets"\)/);
    assert.match(show, /isPhone\(\)/, 'desktop keeps both panels side by side');
    assert.match(extractSource(js, 'showTableHeadings'), /classList\.remove\("is-bullets"\)/);
    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /\.tables-layout \{[^}]*flex-direction: column/);
    assert.match(block, /\.tables-layout\.is-bullets \.table-heading-list \{[^}]*display: none/);
    assert.match(block, /\.table-heading-list \{[^}]*flex: 1 1 auto/, 'the 260px basis goes');
    assert.match(block, /\.table-heading-row \{[^}]*min-height: 44px/);
    // Fix round 1, finding 1: flex-start (the base rule) would shrink each
    // screen to its content's width once the phone rule makes this a column.
    assert.match(block, /\.tables-layout \{[^}]*align-items: stretch/, 'both screens are full width');

    // Controller ruling: the bullets screen is wired into Task 4's overlay
    // history, rather than a second back-handling mechanism.
    assert.match(extractSource(js, 'openOverlayCount'), /is-bullets/, 'the bullets screen holds a history entry');
    assert.match(extractSource(js, 'closeOverlayForBack'), /showTableHeadings\(\)/, 'back returns to the headings screen');
    assert.match(js, /attributeFilter: \["class"\]/, 'the observer sees the screen change');
    const leave = extractSource(js, 'switchTab');
    const leaveIndex = leave.indexOf('showTableHeadings()');
    const scrollSaveIndex = leave.indexOf('tabState.scroll[tabState.current] = window.scrollY');
    assert.notEqual(leaveIndex, -1, 'switchTab must call showTableHeadings() when leaving Tables');
    assert.notEqual(scrollSaveIndex, -1, 'switchTab must still save the outgoing tab\'s scroll offset');
    assert.ok(leaveIndex < scrollSaveIndex,
        'leaving Tables resets its screen before its scroll offset is saved');

    // Fix round 1, finding 3: the headings screen remembers its own scroll
    // position, the same way each tab remembers its own (Task 15).
    assert.match(extractSource(js, 'showTableBullets'), /headingsScroll = window\.scrollY/, 'the heading list remembers its place');
    assert.match(extractSource(js, 'showTableHeadings'), /window\.scrollTo\(0, tablesState\.headingsScroll/, 'and back returns to it');
});

test('bullet flags collapse behind a summary that counts them', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const flags = extractSource(js, 'renderBulletFlags');
    assert.match(flags, /createElement\("details"\)/, 'a bullet with ten flags is a wall of checkboxes');
    assert.match(flags, /Flags/, 'the summary says what is inside');
    // Controller ruling (a): the wrapper also carries .mobile-filters, and its
    // open state is set at creation (not left to syncMobileFilters, which only
    // runs at load and on a breakpoint crossing) because this row is rebuilt
    // on every render.
    assert.match(flags, /bullet-flags-details mobile-filters/, 'desktop keeps the flags inline: the wrapper is display: contents above 700px');
    assert.match(flags, /\.open = !isPhone\(\)/, 'open on desktop, closed on a phone, from the moment it is built');

    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /\.table-bullet-row \{[^}]*flex-wrap: wrap/);
    // Corrected from the brief: the bullet's text span is .table-bullet-text
    // (app.js's renderTableBullets), not .bullet-text.
    assert.match(block, /\.table-bullet-row \.table-bullet-text \{[^}]*flex-basis: 100%/, 'the enable checkbox and weight input share the first line; the text wraps below');
    // Final review, B4: these two rules changed nothing, so they are gone.
    assert.doesNotMatch(block, /\.weight-input \{/);
    assert.doesNotMatch(block, /\.bg-traits \{/);
    // #gate-list carries the class "gate-list" too (index.html), so this
    // selector does reach every checkbox label in the gate panel.
    assert.match(block, /\.gate-list label \{[^}]*min-height: 44px/);
    // Controller ruling (c): the category/Role checkboxes under one gate
    // (renderGateRow's .gate-bucket-roles lists) become a two-column grid.
    assert.match(block, /grid-template-columns: repeat\(2, 1fr\)/, 'gate checkboxes are two columns on a phone');
    assert.match(block, /\.gate-bucket-roles \{[^}]*grid-template-columns: repeat\(2, 1fr\)/);
    // .table-add-form, .gate-add-form and .presets-panel are comma-grouped
    // onto one shared rule body, so only the last is immediately followed by
    // "{" - these look past the other selector names for it, as the phone
    // layer's own .detail-shortcuts/.trait-shortcuts test does above.
    assert.match(block, /\.table-add-form[^{]*\{[^}]*flex-direction: column/);
    assert.match(block, /\.gate-add-form[^{]*\{[^}]*flex-direction: column/);
    assert.match(block, /\.presets-panel[^{]*\{[^}]*flex-direction: column/);
    // Final review, B5: one full-width column, as the spec says.
    assert.match(block, /\.presets-panel \{[^}]*align-items: stretch/);
    assert.match(block, /\.gate-add-form input \{ max-width: none/);

    // Final review, B11: a kind change drops back to the headings screen.
    const kindStart = js.indexOf('elTables.kindSelect.addEventListener("change"');
    assert.notEqual(kindStart, -1, 'the Tables kind-change handler moved');
    const kindHandler = js.slice(kindStart, js.indexOf('\n});', kindStart));
    assert.match(kindHandler, /showTableHeadings\(\)/, 'a new kind never leaves the bullets screen showing another kind\'s table');
});

test('a stale flag summary is kept current after a toggle, since setBulletFlag does not re-render the row', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    // setBulletFlag() only patches bullet.text and queues odds - it never
    // calls renderTableBullets() or renderBulletFlags() again - so the
    // summary text would otherwise go stale the moment a box is ticked.
    assert.doesNotMatch(extractSource(js, 'setBulletFlag'), /renderTableBullets\(\)|renderBulletFlags\(/, 'confirms the row is not re-rendered on a flag write');
    const flags = extractSource(js, 'renderBulletFlags');
    assert.match(flags, /strip\.addEventListener\("change"/, 'the strip recounts its own checked boxes instead');
    assert.match(flags, /summary\.textContent = describeFlags\(countSet\(\)\)/);
    // Final review, A2: a Role row's strip also holds the "works for nobody"
    // gate box, which is not a flag.
    assert.match(flags, /\.flag-toggle input:checked/, 'only the flag boxes are counted');
    assert.doesNotMatch(flags, /input\[type="checkbox"\]:checked/);
});

test('the secret sheet keeps its navigation in reach', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /#secret-detail-overlay \.detail > nav\.regen-row \{[^}]*position: fixed/, 'the nav stays at the bottom of a full-screen sheet');
    assert.match(block, /#secret-detail-overlay \.detail > nav\.regen-row \{[^}]*bottom: 0/);
    assert.doesNotMatch(block, /\.regen-row:first-of-type/, ':first-of-type would also catch the regenerate panel\'s first row');
    assert.match(block, /#secret-detail-overlay \.detail \{[^}]*padding-bottom/, 'the sheet leaves room for the nav');
    assert.match(block, /\.secret-trait-table td \{[^}]*word-break/);
});
