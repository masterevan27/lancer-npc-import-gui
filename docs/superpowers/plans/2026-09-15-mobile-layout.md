# Mobile Layout Implementation Plan

> **Status, 2026-09-17: implemented and tested.** The phone layer, menu,
> overlay history, responsive controls, and mobile UI tests are on `main`.
> The unchecked tasks below are retained as historical implementation detail.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every tab, dialog and editor of the Import GUI usable on a 360–430px Android Chrome phone, without changing the desktop layout.

**Architecture:** One page, one stylesheet, one `app.js`. A phone layer is added: a single `@media (max-width: 700px)` block appended to `public/style.css`, plus a small amount of JS for behaviour that cannot be expressed in CSS (a ☰ menu, browser-back closing overlays, tap-to-zoom and swipe replacing hover and arrow keys). Nothing above 700px changes.

**Tech Stack:** Vanilla JS (no build step, no bundler, no dependencies), plain CSS with custom properties, Node stdlib tests (`node:test`, global `fetch`) against a real `server.js` child process.

**Spec:** `docs/superpowers/specs/2026-09-15-mobile-layout-design.md`

## Global Constraints

- **Zero new dependencies.** There is no `package.json` and CI runs bare `node --test`. Do not add one, and do not add a test framework, jsdom, Playwright or a CSS tool.
- **Breakpoint is exactly `@media (max-width: 700px)`.** All phone rules live in one block appended to the end of `public/style.css`. Existing 900px / 700px / 640px rules stay where they are.
- **Desktop layout above 700px must not change.**
- **Target:** Android Chrome, portrait, 360–430px wide. No iOS Safari workarounds, no tablet or landscape design.
- **Test ports are fixed and must be unique per file.** Ports already claimed: 5193–5242, 5245, 5251–5256, 5260–5266, 5291, 5292, 5296, 5297, 5349, 5399, 5401. This plan's one new test file uses **5270**.
- **Test style:** source assertions over the served `/`, `/app.js`, `/style.css` and `/secret-mode.js`, following `test/ui.gates.test.js`. They prove the code is present; the manual checks at the end of each phase prove it looks right.
- **Versioning (`AGENTS.md`):** bump `lib/version.js` by one subversion step **once per phase** (4 bumps in total), in the phase's last task. Current version is `1.0.6`, so the phases land on `1.0.7`, `1.0.8`, `1.0.9`, `1.0.10`. `test/version.test.js` asserts the version, so update it in the same commit.
- **Git:** work in a worktree per phase; fast-forward merge into local `main`; remove the worktree; never push.
- **`index.html` templating caveat:** `server.js:3881` does `.replace('__APP_VERSION__', APP_VERSION)` — a **single** replacement. Never add a second `__APP_VERSION__` to `index.html`; copy the text in JS instead (Task 2).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `public/style.css` | Modify (append) | One `@media (max-width: 700px)` block at the end, with a comment header per component group. Plus a few base rules that hide phone-only controls on desktop. |
| `public/index.html` | Modify | ☰ toggle and current-tab label in `.topbar`; NPC-sheet Prev/Next buttons; `<details class="mobile-filters">` wrappers; `.mobile-action-bar` wrappers; a version line in the Settings dialog; a "← Tables" back button. |
| `public/app.js` | Modify | `isPhone()`, the overlay history stack, hover/tap zoom gating, swipe handling, ☰ toggle wiring, the Tables two-screen class, phone defaults. |
| `public/secret-mode.js` | Modify | Register its two overlays with the shared overlay-closer list. |
| `test/ui.mobile.test.js` | Create | All source assertions for this work, on port 5270. |
| `lib/version.js`, `test/version.test.js` | Modify | One subversion bump per phase. |

---

# Phase 1 — Shared foundation

Worktree: `git worktree add ../mobile-phase-1 -b mobile-phase-1` from `G:\GIT-REPOS\lancer-npc-import-gui`.

### Task 1: The phone CSS block, `isPhone()`, and the test file

**Files:**
- Create: `test/ui.mobile.test.js`
- Modify: `public/style.css` (append at end), `public/app.js` (near the other top-level constants, after the `el` object ends around line 200)

**Interfaces:**
- Consumes: `startTestServer` from `test/helpers/testServer.js`
- Produces:
  - `isPhone(): boolean` in `app.js` — true when the viewport is ≤700px wide
  - `onPhoneChange(fn)` in `app.js` — calls `fn(isPhone())` whenever the breakpoint is crossed
  - `PHONE_QUERY` — the shared `MediaQueryList`
  - A `/* === Phone layer (<=700px) === */` marker comment at the end of `style.css` that later tasks append to
  - `test/ui.mobile.test.js` with the `fetchText` / `extractSource` helpers later tasks reuse

- [ ] **Step 1: Write the failing test**

Create `test/ui.mobile.test.js`:

```js
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — "style.css has no phone layer marker comment" and "app.js no longer defines isPhone". The viewport test passes already; that is fine, it is a guard.

- [ ] **Step 3: Add the CSS marker block**

Append to the end of `public/style.css`:

```css
/* === Phone layer (<=700px) === */
/*
 * Everything a portrait phone needs, in one block, grouped by component.
 * The breakpoint matches PHONE_QUERY in app.js - when one moves, both move.
 * Rules above this point are the desktop layout and must stay untouched:
 * this layer only ever overrides, never rewrites.
 */
@media (max-width: 700px) {
}
```

- [ ] **Step 4: Add `isPhone()` and `onPhoneChange()`**

In `public/app.js`, immediately after the `el` object's closing `};` (around line 200):

```js
/*
 * The phone breakpoint, shared with style.css's phone layer. Layout belongs
 * in the stylesheet; this exists only for behaviour CSS cannot express -
 * which handlers to attach, and what a control defaults to.
 */
const PHONE_QUERY = window.matchMedia("(max-width: 700px)");

function isPhone() {
  return PHONE_QUERY.matches;
}

/** Run `fn` now and again whenever the phone breakpoint is crossed. */
function onPhoneChange(fn) {
  fn(isPhone());
  PHONE_QUERY.addEventListener("change", () => fn(isPhone()));
}
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add test/ui.mobile.test.js public/style.css public/app.js
git commit -m "add the phone layer's stylesheet block and breakpoint helper"
```

---

### Task 2: Top bar and ☰ menu

**Files:**
- Modify: `public/index.html` (`.topbar`, around lines 11–40; the Settings dialog, around line 992)
- Modify: `public/app.js` (`switchTab` at 3660; `openSettings` at 9608)
- Modify: `public/style.css` (base rules + phone layer)
- Test: `test/ui.mobile.test.js`

**Interfaces:**
- Consumes: `isPhone()` (Task 1); the existing `switchTab(tab)` and `openSettings()`
- Produces:
  - `#tabs-toggle` (the ☰ button), `#current-tab` (the active tab's name), `#settings-version`
  - `closeTabsMenu()` in `app.js`
  - `#tabs.is-open` as the open state of the phone menu

- [ ] **Step 1: Write the failing test**

Append to `test/ui.mobile.test.js`:

```js
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — no `#tabs-toggle` in the page.

- [ ] **Step 3: Add the markup**

In `public/index.html`, inside `.topbar`, put the toggle and label directly after `<h1>NHP Uplink</h1>` and **before** `<nav class="tabs" id="tabs">`:

```html
  <!-- Phone-only, hidden above the breakpoint. Deliberately outside #tabs,
       exactly as the Settings button is: switchTab() loops over
       '#tabs button' and would otherwise treat the toggle as a tab. -->
  <button type="button" class="tabs-toggle" id="tabs-toggle"
          aria-controls="tabs" aria-expanded="false" aria-label="Menu">&#9776;</button>
  <span class="current-tab" id="current-tab">Import Generated Art</span>
```

In the Settings dialog (`#settings-overlay`, around line 992), add as the first child of `.detail.settings-dialog`, right after the close button:

```html
    <!-- The version lives in the top bar on desktop, which the phone layer
         hides. app.js copies the text across on open rather than templating
         it twice: server.js replaces __APP_VERSION__ only once. -->
    <p class="settings-version" id="settings-version"></p>
```

- [ ] **Step 4: Wire up the JS**

In `public/app.js`, beside the other element groups (just before `const tabState` at line 3654):

```js
const elNav = {
  toggle: document.getElementById("tabs-toggle"),
  tabs: document.getElementById("tabs"),
  currentTab: document.getElementById("current-tab"),
};

/** Shut the phone tab menu, if it is open. */
function closeTabsMenu() {
  elNav.tabs.classList.remove("is-open");
  elNav.toggle.setAttribute("aria-expanded", "false");
}

elNav.toggle.addEventListener("click", () => {
  const open = elNav.tabs.classList.toggle("is-open");
  elNav.toggle.setAttribute("aria-expanded", String(open));
});

// A tap anywhere else closes it. Capture, so it still fires when a handler
// on the target stops propagation.
document.addEventListener(
  "click",
  (e) => {
    if (!elNav.tabs.classList.contains("is-open")) return;
    if (elNav.tabs.contains(e.target) || elNav.toggle.contains(e.target)) return;
    closeTabsMenu();
  },
  true,
);
```

Inside `switchTab(tab)`, directly after the loop that toggles `active` on the buttons (after line 3672's closing `}`):

```js
  const active = document.querySelector(`#tabs button[data-tab="${tab}"]`);
  if (active) elNav.currentTab.textContent = active.textContent.trim();
  closeTabsMenu();
```

In `elSettings` (around line 9582), add:

```js
  version: document.getElementById("settings-version"),
```

and at the top of `openSettings()`, after `elSettings.overlay.hidden = false;`:

```js
  // Mirrors the top bar's line, which the phone layer hides.
  elSettings.version.textContent =
    document.querySelector(".release-version")?.textContent ?? "";
```

- [ ] **Step 5: Add the CSS**

Base rules (append near the existing `.tabs` rules, around line 205, **outside** any media query):

```css
.tabs-toggle,
.current-tab { display: none; }
.settings-version { margin: 0 0 var(--sp-2); color: var(--text-3); font-size: var(--fs-xs); }
```

Inside the phone block in the phone layer:

```css
  /* --- Top bar and tab menu --- */
  .topbar { gap: 0.6rem; padding: 0.5rem 0.75rem; position: sticky; }
  .topbar h1 { font-size: 0.95rem; }
  .release-version { display: none; }
  .tabs-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    color: var(--text);
    font-size: 1.1rem;
  }
  .current-tab {
    display: inline;
    color: var(--text-3);
    font-size: var(--fs-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tabs {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    flex-direction: column;
    gap: 0;
    padding: 0.4rem;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
    box-shadow: var(--shadow-dialog);
  }
  .tabs.is-open { display: flex; }
  .tabs button { width: 100%; min-height: 48px; height: auto; text-align: left; }
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js`
Expected: PASS (6 tests)

- [ ] **Step 7: Check nothing else broke**

Run: `node --test test/ui.tabs.test.js test/ui.settings.test.js 2>/dev/null || node --test test/`
Expected: PASS. If the whole suite is run, the create-presets / set-flag / table-bullets port collisions may fail; re-run those files alone to confirm they pass in isolation.

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/app.js public/style.css test/ui.mobile.test.js
git commit -m "fold the tab row into a phone menu behind a toggle"
```

---

### Task 3: Full-screen overlays

**Files:**
- Modify: `public/style.css` (phone layer)
- Test: `test/ui.mobile.test.js`

**Interfaces:**
- Consumes: the existing `.detail-overlay` / `.detail` / `.detail-close` / `.detail-images` markup
- Produces: phone rules only; no new IDs or functions

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — no `.detail` rule in the phone layer.

- [ ] **Step 3: Add the CSS**

Inside the phone block:

```css
  /* --- Sheets and dialogs ---
     Every overlay is full-screen on a phone: a centred card with a margin
     wastes the only 360px there is, and a sheet that scrolls its own body
     keeps the close button in reach. */
  .detail-overlay:not([hidden]) { padding: 0; align-items: stretch; }
  .detail {
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
    padding: 0.9rem;
    overflow-y: auto;
  }
  .detail-close {
    position: sticky;
    top: 0;
    float: right;
    z-index: 1;
    min-width: 44px;
    min-height: 44px;
  }
  .detail-images { flex-direction: column; gap: 0.6rem; }
  .detail-images img { max-width: 100%; max-height: 55vh; }
  .detail--background .detail-images img { max-width: 100%; }
  .detail-images img.secret-image-expanded { max-width: 100%; }
  .trait-image-sheet { width: 100%; }
  .detail-info h2 { font-size: var(--fs-xl); }
  .detail-title-row { flex-wrap: wrap; gap: 0.4rem; }
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add public/style.css test/ui.mobile.test.js
git commit -m "give every sheet the whole screen on a phone"
```

---

### Task 4: Browser back closes the top overlay

**Files:**
- Modify: `public/app.js` (beside `topmostOverlay()` at 3273)
- Modify: `public/secret-mode.js` (near its `keydown` handler at 621)
- Test: `test/ui.mobile.test.js`

**Interfaces:**
- Consumes: the existing `topmostOverlay()` and its `{ close }` shape
- Produces:
  - `window.__overlayClosers` — an array of `{ isOpen(), close() }`, which `secret-mode.js` pushes to and `topmostOverlay()` reads. `secret-mode.js` loads **before** `app.js` (index.html:1065–1066), so the array is created by whichever file touches it first.
  - `openOverlayCount(): number`
  - `syncOverlayHistory()` — pushes or unwinds history entries to match the open overlays
  - `overlayHistory` — `{ pushed, unwinding, suspend }`

- [ ] **Step 1: Write the failing test**

```js
test('opening an overlay adds a history entry and back closes the top one', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const count = extractSource(js, 'openOverlayCount');
    assert.match(count, /\.detail-overlay/, 'every sheet counts');
    assert.match(count, /image-zoom/, 'the zoom counts too');
    const sync = extractSource(js, 'syncOverlayHistory');
    assert.match(sync, /history\.pushState/, 'a newly open overlay pushes an entry');
    assert.match(sync, /history\.go\(-steps\)/, 'an overlay closed from the UI unwinds its entry');
    assert.match(sync, /overlayHistory\.suspend/, 'closing from popstate does not re-enter');
    assert.match(js, /new MutationObserver\(syncOverlayHistory\)/, 'visibility is observed, not hooked per call site');
    assert.match(js, /attributeFilter: \["hidden"\]/);
    assert.match(js, /addEventListener\("popstate"/, 'back is handled');
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — `app.js no longer defines openOverlayCount`.

- [ ] **Step 3: Add the overlay history to `app.js`**

Directly **above** `function topmostOverlay()` (line 3273):

```js
/*
 * Android's back gesture is how a phone closes things, and a site that
 * leaves on it is a site that loses your place. Every open overlay gets one
 * history entry, so back pops the topmost sheet the way Esc does.
 *
 * Visibility is observed rather than hooked: overlays are opened and closed
 * from dozens of call sites here and in secret-mode.js, all of them by
 * setting `hidden` directly. One MutationObserver over that attribute is the
 * only way to stay correct without rewriting every one of them.
 *
 * #preset-preview is deliberately NOT counted. It is nested inside the
 * Tables panel rather than being a top-level overlay, so its `hidden`
 * does not track real visibility - the same caveat topmostOverlay()
 * documents. Esc still closes it.
 */
const OVERLAY_SELECTOR = ".detail-overlay, .image-zoom";
const overlayHistory = { pushed: 0, unwinding: 0, suspend: false };

/** How many overlays are on screen right now. */
function openOverlayCount() {
  let open = 0;
  for (const node of document.querySelectorAll(OVERLAY_SELECTOR)) {
    if (!node.hidden) open += 1;
  }
  return open;
}

/** Make the history stack match what is on screen. */
function syncOverlayHistory() {
  if (overlayHistory.suspend) return;
  const depth = openOverlayCount();
  while (overlayHistory.pushed < depth) {
    overlayHistory.pushed += 1;
    history.pushState({ overlay: overlayHistory.pushed }, "");
  }
  if (overlayHistory.pushed > depth) {
    // Closed from the UI (a ✕, a backdrop tap, Esc): drop the entries it
    // owned, so back does not have to be pressed twice to leave the page.
    const steps = overlayHistory.pushed - depth;
    overlayHistory.pushed = depth;
    overlayHistory.unwinding += steps;
    history.go(-steps);
  }
}

window.addEventListener("popstate", () => {
  if (overlayHistory.unwinding > 0) {
    // Our own history.go(), not a real back press.
    overlayHistory.unwinding -= 1;
    return;
  }
  const top = topmostOverlay();
  if (!top) return;
  // suspend: closing here must not push the entry back or unwind another.
  overlayHistory.suspend = true;
  top.close();
  overlayHistory.suspend = false;
  overlayHistory.pushed = openOverlayCount();
});

const overlayObserver = new MutationObserver(syncOverlayHistory);
for (const node of document.querySelectorAll(OVERLAY_SELECTOR)) {
  overlayObserver.observe(node, { attributes: true, attributeFilter: ["hidden"] });
}
```

- [ ] **Step 4: Let `topmostOverlay()` see secret mode's overlays**

In `topmostOverlay()`, immediately before `return null;`:

```js
  // secret-mode.js loads first and owns its own sheets; it registers them
  // here so back and Esc can close them through the one path.
  for (const extra of window.__overlayClosers ?? []) {
    if (extra.isOpen()) return { close: () => extra.close() };
  }
```

- [ ] **Step 5: Register secret mode's overlays**

In `public/secret-mode.js`, beside its `keydown` handler (line 621), inside the same setup function:

```js
    // Shared with app.js's topmostOverlay(), so Esc and Android back close
    // these two the same way they close every other sheet.
    (window.__overlayClosers ||= []).push(
        { isOpen: () => !get('secret-detail-overlay').hidden, close: () => closeDetail() },
        {
            isOpen: () => !get('secret-login-overlay').hidden,
            close: () => {
                get('secret-login-overlay').hidden = true;
                get('secret-password').value = '';
            },
        },
    );
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js test/ui.secretMode.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/secret-mode.js test/ui.mobile.test.js
git commit -m "close the topmost sheet on the browser's back gesture"
```

---

### Task 5: Touch replaces hover and the arrow keys

**Files:**
- Modify: `public/index.html` (the `#detail-overlay` sheet, around lines 616–855)
- Modify: `public/app.js` (`attachImageZoom` at 3339; beside `stepDetail` at 3292)
- Modify: `public/style.css` (phone layer)
- Test: `test/ui.mobile.test.js`

**Interfaces:**
- Consumes: `stepDetail(offset)`, `el.imageZoom`, `el.imageZoomImg`, `isPhone()`
- Produces:
  - `#detail-prev` / `#detail-next` buttons in the NPC sheet, visible at every width
  - `attachSwipeNav(element)` in `app.js`
  - `attachImageZoom` gated on `(hover: hover)` with a tap path added

- [ ] **Step 1: Write the failing test**

```js
test('the NPC sheet can be navigated and zoomed without a keyboard', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    const js = await fetchText(server, '/app.js');
    assert.match(html, /id="detail-prev"/, 'the sheet has a Previous button');
    assert.match(html, /id="detail-next"/, 'and a Next button');
    const zoom = extractSource(js, 'attachImageZoom');
    assert.match(zoom, /\(hover: hover\)/, 'hover-to-zoom is only for devices that hover');
    assert.match(zoom, /addEventListener\("click"/, 'a tap zooms on the rest');
    const swipe = extractSource(js, 'attachSwipeNav');
    assert.match(swipe, /touchstart/);
    assert.match(swipe, /stepDetail\(/, 'a swipe moves through the grid order');
    assert.match(swipe, /60/, 'a swipe needs real horizontal travel');
    assert.match(js, /elDetailNav\.prev\.addEventListener\("click", \(\) => stepDetail\(-1\)\)/);
});

test('keyboard-only hints are hidden on a phone', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /\.detail-shortcuts \{[^}]*display: none/);
    assert.match(block, /\.trait-shortcuts \{[^}]*display: none/);
    assert.match(block, /\.regen-row \.hint \{[^}]*display: none/, 'the secret sheet hint mentions hover and Esc');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — no `#detail-prev` in the page.

- [ ] **Step 3: Add the navigation buttons**

In `public/index.html`, inside `#detail-overlay`'s `.detail`, directly after `<div class="detail-images">…</div>` closes:

```html
    <!-- The arrow keys' equivalent, shown at every width: a phone has no
         arrow keys, and a mouse user loses nothing by having buttons. -->
    <nav class="detail-nav" aria-label="NPC navigation">
      <button type="button" id="detail-prev">&larr; Previous</button>
      <button type="button" id="detail-next">Next &rarr;</button>
    </nav>
```

- [ ] **Step 4: Wire the buttons, the tap zoom and the swipe**

In `public/app.js`, replace `attachImageZoom` (line 3339) with:

```js
/*
 * Zoom an image. A mouse hovers; a phone has no hover, so the same image
 * takes a tap instead - and a second tap anywhere on the zoom closes it.
 * Gated on the media query rather than on isPhone(), because what matters
 * is whether the device can hover at all, not how wide it is.
 */
const CAN_HOVER = window.matchMedia("(hover: hover)");

function attachImageZoom(imgEl) {
  const show = () => {
    if (!imgEl.src) return;
    el.imageZoomImg.src = imgEl.src;
    el.imageZoomImg.alt = imgEl.alt;
    el.imageZoom.hidden = false;
  };
  const hide = () => {
    el.imageZoom.hidden = true;
  };
  imgEl.addEventListener("mouseenter", () => {
    if (!CAN_HOVER.matches) return;
    show();
  });
  imgEl.addEventListener("mouseleave", () => {
    if (!CAN_HOVER.matches) return;
    hide();
  });
  imgEl.addEventListener("click", () => {
    if (CAN_HOVER.matches) return;
    if (el.imageZoom.hidden) show();
    else hide();
  });
}
```

Directly after it, the zoom's own dismissal and the swipe:

```js
// The zoom is pointer-events: none on desktop, where leaving the image is
// what closes it. On a phone it is tapped, so it must take taps back.
el.imageZoom.addEventListener("click", () => {
  el.imageZoom.hidden = true;
});

/*
 * Swipe left/right through the grid order, the touch twin of the arrow
 * keys. Only on the image strip, and only for a clearly horizontal drag:
 * a sheet is tall, and flipping NPCs while someone scrolls it would be
 * worse than having no swipe at all.
 */
const SWIPE_MIN_X = 60;

function attachSwipeNav(element) {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  element.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      tracking = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    },
    { passive: true },
  );
  element.addEventListener(
    "touchend",
    (e) => {
      if (!tracking) return;
      tracking = false;
      // Never while something is stacked on the sheet - arrowing the list
      // out from under a delete confirmation is the same hazard the
      // keydown handler already refuses.
      if (topmostOverlay()) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dx) < Math.abs(dy) * 2) return;
      stepDetail(dx < 0 ? 1 : -1);
    },
    { passive: true },
  );
}

const elDetailNav = {
  prev: document.getElementById("detail-prev"),
  next: document.getElementById("detail-next"),
};
elDetailNav.prev.addEventListener("click", () => stepDetail(-1));
elDetailNav.next.addEventListener("click", () => stepDetail(1));
attachSwipeNav(document.querySelector("#detail-overlay .detail-images"));
```

- [ ] **Step 5: Add the CSS**

Base rule, beside `.detail-images` (around line 732):

```css
.detail-nav { display: flex; gap: 0.5rem; margin: 0 0 var(--sp-3); }
```

Inside the phone block:

```css
  /* --- Touch instead of hover and arrow keys --- */
  .detail-shortcuts,
  .trait-shortcuts,
  .regen-row .hint { display: none; }
  .detail-nav button { flex: 1; min-height: 44px; }
  .image-zoom { pointer-events: auto; }
  .image-zoom img { max-width: 96vw; max-height: 80vh; }
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js test/ui.detailRepaint.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/app.js public/style.css test/ui.mobile.test.js
git commit -m "navigate and zoom the NPC sheet by touch"
```

---

### Task 6: Controls, wide content, and the two shared phone patterns

**Files:**
- Modify: `public/style.css` (base + phone layer)
- Modify: `public/app.js` (beside `onPhoneChange`)
- Test: `test/ui.mobile.test.js`
- Modify: `lib/version.js`, `test/version.test.js` (phase bump to `1.0.7`)

**Interfaces:**
- Consumes: `isPhone()`, `onPhoneChange(fn)`
- Produces:
  - `.mobile-filters` — a `<details>` wrapper, closed on phones and forced open above the breakpoint
  - `.mobile-action-bar` — sticky at the bottom on phones, an ordinary row above
  - `syncMobileFilters()` in `app.js`

- [ ] **Step 1: Write the failing test**

```js
test('controls are thumb-sized and never zoom the page on focus', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /font-size: 16px/, 'Chrome zooms into any field under 16px');
    assert.match(block, /min-height: 44px/, 'tap targets are at least 44px');
    assert.match(block, /\.form-grid \{[^}]*grid-template-columns: 1fr/);
    assert.match(block, /overflow-x: auto/, 'wide tables and prompts scroll inside themselves');
    assert.match(block, /\.job-log \{[^}]*white-space: pre-wrap/);
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — `app.js no longer defines syncMobileFilters`.

- [ ] **Step 3: Add the shared JS**

In `public/app.js`, directly after `onPhoneChange` (Task 1):

```js
/*
 * The filter panels collapse on a phone, where four stacked filter rows
 * push the results themselves off the screen. Above the breakpoint they are
 * always open, so desktop keeps today's layout exactly.
 */
function syncMobileFilters() {
  const phone = isPhone();
  for (const panel of document.querySelectorAll(".mobile-filters")) {
    panel.open = !phone;
  }
}
onPhoneChange(syncMobileFilters);
```

- [ ] **Step 4: Add the CSS**

Base rules (append beside the `.filters` rules):

```css
/* A <details> wrapper the phone layer collapses; see syncMobileFilters. */
.mobile-filters > summary { cursor: pointer; padding: 0.35rem 0; color: var(--text-3); font-size: var(--fs-sm); }
.mobile-filters[open] > summary { margin-bottom: var(--sp-2); }
.mobile-action-bar { display: flex; gap: 0.5rem; flex-wrap: wrap; }
```

Inside the phone block:

```css
  /* --- Controls --- */
  input, select, textarea, button { font-size: 16px; }
  input, select, textarea { min-height: 44px; }
  button { min-height: 44px; }
  .form-grid { grid-template-columns: 1fr; }
  label { display: block; }

  /* --- Content too wide for 360px --- */
  #detail-traits,
  .secret-trait-table,
  .detail-files pre,
  .bg-prompt { display: block; max-width: 100%; overflow-x: auto; }
  .job-log { max-height: 50vh; overflow: auto; white-space: pre-wrap; }
  main { padding-left: 0.75rem; padding-right: 0.75rem; overflow-x: hidden; }

  /* --- The sticky action bar ---
     Its panel pays for it in padding, or the bar sits on top of the last
     field it is meant to submit. */
  .mobile-action-bar {
    position: sticky;
    bottom: 0;
    z-index: 4;
    padding: 0.5rem 0;
    background: var(--surface);
    border-top: 1px solid var(--line);
  }
  .mobile-action-bar button { flex: 1 1 45%; }
  .tab-panel { padding-bottom: 4.5rem; }
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js`
Expected: PASS

- [ ] **Step 6: Bump the version for the phase**

In `lib/version.js`: `const APP_VERSION = '1.0.7';`
In `test/version.test.js`: change the expected `1.0.6` to `1.0.7`.

Run: `node --test test/version.test.js`
Expected: PASS

- [ ] **Step 7: Verify in a browser**

Using claude-in-chrome, start the server (`node server.js`), open the site at 360×800 and 412×915 emulation, and check:
- The ☰ menu opens, lists every tab, and closes when a tab is chosen.
- Opening an NPC fills the screen; ✕ closes it; the back gesture closes it; Prev/Next work; tapping the portrait zooms and tapping again closes.
- `document.documentElement.scrollWidth <= window.innerWidth` on the Import tab.
- At 1440px the page still looks like the screenshot taken before the phase.

- [ ] **Step 8: Commit and merge the phase**

```bash
git add public/style.css public/app.js lib/version.js test/version.test.js test/ui.mobile.test.js
git commit -m "size controls for touch and add the shared phone patterns"
git switch main && git merge --ff-only mobile-phase-1
git worktree remove ../mobile-phase-1 && git branch -d mobile-phase-1
```

---

# Phase 2 — Import, Create NPC, Create Spaceship

Worktree: `git worktree add ../mobile-phase-2 -b mobile-phase-2`.

### Task 7: Import tab and the Secret gallery

**Files:**
- Modify: `public/index.html` (the `#tab-import` toolbar and filters, lines 99–122; the Secret gallery toolbar above it)
- Modify: `public/app.js` (wherever `#import-btn` / `#delete-btn` labels are refreshed)
- Modify: `public/style.css` (phone layer)
- Test: `test/ui.mobile.test.js`

**Interfaces:**
- Consumes: `.mobile-filters`, `.mobile-action-bar` (Task 6); the existing `#import-btn`, `#delete-btn`, `#select-all` handlers
- Produces: `#import-actions` — the action bar wrapping the two buttons

- [ ] **Step 1: Write the failing test**

```js
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
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — no `#import-filters` in the page.

- [ ] **Step 3: Restructure the Import markup**

In `public/index.html`, replace the `.filters` div at lines 118–122 with:

```html
  <div class="filters" id="filters">
    <input type="text" id="filter-search" placeholder="Search name, callsign, traits…" />
    <!-- Collapsed on a phone by syncMobileFilters; always open above 700px,
         where this reads exactly as the flat row it replaced. -->
    <details class="mobile-filters" id="import-filters" open>
      <summary>Filters</summary>
      <div class="filter-rows" id="filter-rows"></div>
      <button id="add-filter" type="button">+ Add filter</button>
    </details>
  </div>
```

And wrap the two action buttons at the end of the toolbar (lines 114–115):

```html
    <div class="mobile-action-bar" id="import-actions">
      <button id="import-btn" disabled>Import Selected (0)</button>
      <button id="delete-btn" class="danger" disabled>Delete Selected (0)</button>
    </div>
```

Apply the same `mobile-filters` treatment to the Secret gallery's `.toolbar` (`#secret-search` stays outside; `#secret-kind` and `#secret-sort` go inside a `<details class="mobile-filters" id="secret-filters" open>`).

- [ ] **Step 4: Add the CSS**

Inside the phone block:

```css
  /* --- Galleries --- */
  .grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.6rem; }
  .categories { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 0.3rem; }
  .categories button { flex: 0 0 auto; }
  .toolbar { flex-wrap: wrap; gap: 0.5rem; }
  .toolbar .status { flex-basis: 100%; }
  /* The card's checkbox is the one control on a 150px tile, so it gets a
     real target rather than the browser's 13px box. `.check` is the class
     the card renderer gives it (app.js:990); there is no wrapping label. */
  .card .check { width: 24px; height: 24px; }
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js test/ui.importBackgrounds.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/style.css public/app.js test/ui.mobile.test.js
git commit -m "give the galleries a phone toolbar and two-column cards"
```

---

### Task 8: Create NPC

**Files:**
- Modify: `public/index.html` (`#tab-create`, lines 130–256)
- Modify: `public/style.css` (phone layer)
- Test: `test/ui.mobile.test.js`

**Interfaces:**
- Consumes: `.mobile-action-bar`
- Produces: `.create-actions` also carrying `mobile-action-bar`

- [ ] **Step 1: Write the failing test**

```js
test('Create NPC sticks its generate buttons to the bottom on a phone', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    const create = html.slice(html.indexOf('id="tab-create"'), html.indexOf('id="tab-shipcreate"'));
    assert.match(create, /class="form-row create-actions mobile-action-bar"/);
    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /#override-rows .filter-row,[\s\S]{0,200}flex-direction: column/, 'override rows stack');
    assert.match(block, /\.create-presets-row \{[^}]*grid-template-columns: repeat\(2, 1fr\)/);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — `create-actions` has no `mobile-action-bar` class.

- [ ] **Step 3: Add the class**

In `public/index.html`, the Create NPC actions row becomes:

```html
    <div class="form-row create-actions mobile-action-bar">
```

- [ ] **Step 4: Add the CSS**

Inside the phone block:

```css
  /* --- Create forms --- */
  #override-rows .filter-row,
  #ship-override-rows .filter-row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
  }
  #override-rows .filter-row button,
  #ship-override-rows .filter-row button { width: 100%; }
  .create-presets-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
  .create-presets-row select,
  .create-presets-row .create-preset-status { grid-column: 1 / -1; }
  .secret-tables-content { max-height: 60vh; overflow-y: auto; }
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js test/ui.createPresets.test.js`
Expected: PASS. If `ui.createPresets` fails on a port collision, run it alone to confirm.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/style.css test/ui.mobile.test.js
git commit -m "stack the Create NPC form for a phone"
```

---

### Task 9: Create Spaceship

**Files:**
- Modify: `public/index.html` (`#tab-shipcreate`, lines 257–347)
- Modify: `lib/version.js`, `test/version.test.js` (phase bump to `1.0.8`)
- Test: `test/ui.mobile.test.js`

**Interfaces:**
- Consumes: the CSS from Task 8 (both forms share `#override-rows` / `#ship-override-rows` rules)
- Produces: nothing new

- [ ] **Step 1: Write the failing test**

```js
test('Create Spaceship gets the same phone treatment as Create NPC', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    const ship = html.slice(html.indexOf('id="tab-shipcreate"'), html.indexOf('id="tab-backgrounds"'));
    assert.match(ship, /class="form-row create-actions mobile-action-bar"/);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — the ship actions row has no `mobile-action-bar`.

- [ ] **Step 3: Add the class**

In `public/index.html`, the Create Spaceship actions row becomes:

```html
    <div class="form-row create-actions mobile-action-bar">
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js`
Expected: PASS

- [ ] **Step 5: Bump the version for the phase**

`lib/version.js` → `1.0.8`; update `test/version.test.js` to match.
Run: `node --test test/version.test.js` → PASS

- [ ] **Step 6: Verify in a browser**

At 360×800: Import (select two cards, check the action bar appears and imports), Create NPC (fill the form, add a trait override, run a dry run, read the job log), Create Spaceship (same). Confirm no sideways scrolling on any of the three, and that the sticky bar never covers the last field. Then check 1440px against the pre-phase screenshot.

- [ ] **Step 7: Commit and merge the phase**

```bash
git add public/index.html lib/version.js test/version.test.js test/ui.mobile.test.js
git commit -m "stack the Create Spaceship form for a phone"
git switch main && git merge --ff-only mobile-phase-2
git worktree remove ../mobile-phase-2 && git branch -d mobile-phase-2
```

---

# Phase 3 — Trait Imports and Create Background

Worktree: `git worktree add ../mobile-phase-3 -b mobile-phase-3`.

### Task 10: Trait Imports

**Files:**
- Modify: `public/index.html` (`#tab-traits`, lines 476–530)
- Modify: `public/app.js` (`readTraitView` at 5910; the trait row renderer)
- Modify: `public/style.css` (phone layer)
- Test: `test/ui.mobile.test.js`

**Interfaces:**
- Consumes: `isPhone()`, `.mobile-filters`, `.mobile-action-bar`
- Produces:
  - `readTraitView()` returning `"pictures"` on a phone when nothing is stored
  - `#trait-filters-panel`, `#trait-actions`

**What the keyboard shortcuts actually do:** `runTraitAction(context, action)` (app.js:6880) moves a cursor (`next` / `prev`), toggles the cursor row's selection (`toggle`) and opens its sheet (`open`). There is nothing to approve or reject. Every one of those already has a pointer equivalent: the row's checkbox selects, and the row's own click handler (app.js:6365) opens the sheet. So this task makes those two targets thumb-sized rather than adding buttons.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — `readTraitView` does not mention `isPhone`.

- [ ] **Step 3: Default to tiles on a phone**

In `public/app.js`, replace `readTraitView` (line 5910):

```js
function readTraitView() {
  try {
    const stored = localStorage.getItem(TRAIT_VIEW_STORAGE_KEY);
    if (stored === "pictures" || stored === "list") return stored;
  } catch {
    /* a locked-down browser falls through to the default */
  }
  // Tiles first on a phone: the list view's columns are unreadable at 360px,
  // and an explicit choice above still overrules this on the next visit.
  return isPhone() ? "pictures" : "list";
}
```

- [ ] **Step 4: Restructure the markup**

In `public/index.html`, wrap the filter controls (everything in `#trait-filters` except `#trait-search`) in:

```html
    <details class="mobile-filters" id="trait-filters-panel" open>
      <summary>Filters</summary>
      …the table, status and sort selects…
    </details>
```

and wrap the toolbar's buttons:

```html
    <div class="mobile-action-bar" id="trait-actions">
      <button type="button" class="trait-btn" id="trait-clear-btn" disabled>Clear selection</button>
      <button id="trait-import-btn" disabled>Import Selected (0)</button>
    </div>
```

- [ ] **Step 5: Add the CSS**

Inside the phone block:

```css
  /* --- Trait Imports ---
     No new buttons: the row's checkbox is what the Space shortcut toggles
     and the row itself is what Enter opens (app.js:6365). Both only need
     to survive a thumb. */
  .trait-row { flex-wrap: wrap; align-items: flex-start; row-gap: 0.3rem; padding: 0.6rem 0.5rem; }
  .trait-row input[type="checkbox"] { width: 24px; height: 24px; }
  .trait-row .trait-bullet { flex-basis: 100%; }
  .trait-tiles { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/app.js public/style.css test/ui.mobile.test.js
git commit -m "make trait candidates reviewable by thumb"
```

---

### Task 11: Create Background

**Files:**
- Modify: `public/index.html` (`#tab-backgrounds`, lines 348–475)
- Modify: `public/style.css` (phone layer)
- Modify: `lib/version.js`, `test/version.test.js` (phase bump to `1.0.9`)
- Test: `test/ui.mobile.test.js`

**Interfaces:**
- Consumes: `.mobile-action-bar`; the existing copy helper used by the detail sheet's Copy buttons
- Produces: `#bg-dynamic-actions` — the action bar holding Roll, Preview and Render

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — no `#bg-dynamic-actions`.

- [ ] **Step 3: Wrap the render row**

In `public/index.html`, the row holding `#bg-dynamic-preview-btn` and `#bg-dynamic-render` becomes:

```html
        <div class="filter-row mobile-action-bar" id="bg-dynamic-actions">
```

- [ ] **Step 4: Add the CSS**

Inside the phone block:

```css
  /* --- Create Background --- */
  .bg-render .filter-row { display: flex; flex-direction: column; align-items: stretch; gap: 0.4rem; }
  .bg-render .mobile-action-bar { flex-direction: row; }
  .bg-prompt { white-space: pre-wrap; max-height: 40vh; overflow-y: auto; }
  .bg-traits { grid-template-columns: 1fr; }
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js test/ui.backgrounds.test.js`
Expected: PASS

- [ ] **Step 6: Bump the version for the phase**

`lib/version.js` → `1.0.9`; update `test/version.test.js`.
Run: `node --test test/version.test.js` → PASS

- [ ] **Step 7: Verify in a browser**

At 360×800: approve and reject a trait candidate from a row's buttons, switch List/Pictures, open a reference image sheet; then roll a background, read the prompt preview, copy it. No sideways scroll on either tab. Check 1440px against the pre-phase screenshot.

- [ ] **Step 8: Commit and merge the phase**

```bash
git add public/index.html public/style.css lib/version.js test/version.test.js test/ui.mobile.test.js
git commit -m "stack the background form and free its prompt preview"
git switch main && git merge --ff-only mobile-phase-3
git worktree remove ../mobile-phase-3 && git branch -d mobile-phase-3
```

---

# Phase 4 — Tables and the Secret sheet

Worktree: `git worktree add ../mobile-phase-4 -b mobile-phase-4`.

### Task 12: The Tables tab becomes two screens

**Files:**
- Modify: `public/index.html` (`#tab-tables`, lines 531–600)
- Modify: `public/app.js` (`renderTableHeadingList` at 7450, the heading click at 7484, the group-jump click at 7632, `renderTableBullets` at 7546)
- Modify: `public/style.css` (phone layer)
- Test: `test/ui.mobile.test.js`

**Interfaces:**
- Consumes: `tablesState.selectedTable`, `isPhone()`, the overlay history from Task 4
- Produces:
  - `showTableBullets()` / `showTableHeadings()` in `app.js`
  - `.tables-layout.is-bullets` — the bullets screen is showing
  - `#tables-back` — the "← Tables" button

- [ ] **Step 1: Write the failing test**

```js
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
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — `app.js no longer defines showTableBullets`.

- [ ] **Step 3: Add the back button**

In `public/index.html`, as the first child of `.table-bullet-panel` (line 553):

```html
      <!-- Phone-only: the two panels are two screens below 700px, and this is
           how the bullets screen gets back to the headings. -->
      <button type="button" class="tables-back" id="tables-back">&larr; Tables</button>
```

- [ ] **Step 4: Add the screen switch**

In `public/app.js`, directly above `renderTableHeadingList` (line 7450):

```js
/*
 * Below the breakpoint the heading list and the bullet panel are two
 * screens rather than two columns - 260px of headings beside a bullet list
 * leaves neither usable at 360px. Above it, both classes are inert and the
 * layout is the flex row it has always been.
 */
function showTableBullets() {
  if (!isPhone()) return;
  document.querySelector(".tables-layout").classList.add("is-bullets");
  window.scrollTo(0, 0);
}

function showTableHeadings() {
  document.querySelector(".tables-layout").classList.remove("is-bullets");
}

document.getElementById("tables-back").addEventListener("click", showTableHeadings);
```

Call `showTableBullets()` at the end of both selection handlers — the heading click (after line 7487's `renderTableBullets();`) and the group-jump click (after line 7634's `renderTableBullets();`).

Add to `switchTab`, in the branch that leaves the Tables tab, next to the existing `cancelPresetPreview()` call:

```js
  if (tabState.current === "tables") showTableHeadings();
```

- [ ] **Step 5: Add the CSS**

Base rule:

```css
.tables-back { display: none; }
```

Inside the phone block:

```css
  /* --- Tables: two screens --- */
  .tables-layout { flex-direction: column; gap: 0.6rem; }
  .table-heading-list { flex: 1 1 auto; position: static; max-height: none; }
  .table-heading-row { min-height: 44px; display: flex; align-items: center; }
  .tables-back { display: inline-flex; align-items: center; min-height: 44px; margin-bottom: var(--sp-2); }
  .tables-layout.is-bullets .table-heading-list { display: none; }
  .tables-layout:not(.is-bullets) .table-bullet-panel { display: none; }
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js test/ui.tableBullets.test.js`
Expected: PASS. `ui.tableBullets` is one of the known port-flaky files; if it fails, run it alone to confirm.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/app.js public/style.css test/ui.mobile.test.js
git commit -m "split the Tables tab into a headings screen and a bullets screen"
```

---

### Task 13: Tables bullet rows, flags, gates and forms

**Files:**
- Modify: `public/app.js` (`renderBulletFlags`, called at 7640)
- Modify: `public/style.css` (phone layer)
- Test: `test/ui.mobile.test.js`

**Interfaces:**
- Consumes: the existing `renderBulletFlags(table, bullet)` return value
- Produces: `renderBulletFlags` wrapping its checkboxes in `<details class="bullet-flags-details">` with a summary counting the set flags

- [ ] **Step 1: Write the failing test**

```js
test('bullet flags collapse behind a summary that counts them', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const flags = extractSource(js, 'renderBulletFlags');
    assert.match(flags, /createElement\("details"\)/, 'a bullet with ten flags is a wall of checkboxes');
    assert.match(flags, /Flags/, 'the summary says what is inside');
    const block = phoneBlock(await fetchText(server, '/style.css'));
    assert.match(block, /\.table-bullet-row \{[^}]*flex-wrap: wrap/);
    assert.match(block, /\.gate-list label \{[^}]*min-height: 44px/);
    assert.match(block, /\.table-add-form \{[^}]*flex-direction: column/);
    assert.match(block, /\.presets-panel \{[^}]*flex-direction: column/);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — `renderBulletFlags` creates no `details`.

- [ ] **Step 3: Wrap the flags**

`renderBulletFlags` (app.js:7780) builds a `div.table-bullet-flags` named `strip` and has two returns: an early one at line 7799 for a group reference's theme tags, and the real one at line 7836 after the checkboxes, theme tags and the Role gate controls. Wrap **only the second**: the early return is a couple of read-only tags, and hiding those behind a summary would be worse than showing them.

Replace the final `return strip;` (line 7836) with:

```js
  // Backdrop carries fifteen gate flags, so a bullet's checkbox row is a
  // wall at any width and unreachable at 360px. Folded behind a summary
  // that says how many are set, which is the part you scan for.
  const set = strip.querySelectorAll('input[type="checkbox"]:checked').length;
  const details = document.createElement("details");
  details.className = "bullet-flags-details";
  const summary = document.createElement("summary");
  summary.textContent = set ? `Flags (${set} set)` : "Flags";
  details.appendChild(summary);
  details.appendChild(strip);
  return details;
```

`renderBulletFlags`'s caller (line 7640) appends whatever it returns, so it needs no change.

The existing `ui.setFlag` test asserts on the checkbox behaviour through `setBulletFlag`, not on the container, but run it in Step 5 to be sure.

- [ ] **Step 4: Add the CSS**

Base rule:

```css
.bullet-flags-details > summary { cursor: pointer; color: var(--text-4); font-size: var(--fs-xs); }
```

Inside the phone block:

```css
  /* --- Tables: bullet rows, gates, forms --- */
  .table-bullet-row { flex-wrap: wrap; align-items: flex-start; }
  .table-bullet-row .bullet-text { flex-basis: 100%; }
  .table-bullet-row input[type="checkbox"] { width: 22px; height: 22px; }
  .weight-input { max-width: 5rem; }
  .table-bullet-flags { display: grid; grid-template-columns: repeat(2, 1fr); margin-left: 0; }
  .gate-list label { display: flex; align-items: center; min-height: 44px; }
  .table-add-form,
  .gate-add-form,
  .presets-panel { display: flex; flex-direction: column; gap: 0.5rem; }
  .table-add-form input,
  .gate-add-form input { width: 100%; }
```

Two class names here were not verified against the renderer: the bullet's text span (used above as `.bullet-text`) and the gate panel's per-Role checkbox container. Read `renderTableBullets` (app.js:7546) and `renderRoleGateControls` for the real ones and use those, or drop the rule if the element already wraps. Everything else on this list exists today (`.table-bullet-row`, `.table-bullet-flags`, `.weight-input`, `.gate-list`, `.table-add-form`, `.gate-add-form`, `.presets-panel`).

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js test/ui.setFlag.test.js test/ui.gates.test.js`
Expected: PASS. `ui.setFlag` is port-flaky in a combined run; run it alone if it fails.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/style.css test/ui.mobile.test.js
git commit -m "fold bullet flags away and stack the table editor's forms"
```

---

### Task 14: The Secret mode sheet

**Files:**
- Modify: `public/style.css` (phone layer)
- Modify: `lib/version.js`, `test/version.test.js` (phase bump to `1.0.10`)
- Test: `test/ui.mobile.test.js`

**Interfaces:**
- Consumes: the full-screen `.detail` rules (Task 3); `#secret-detail-prev` / `#secret-detail-next`, which already exist
- Produces: nothing new

- [ ] **Step 1: Write the failing test**

```js
test('the secret sheet keeps its navigation in reach', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const block = phoneBlock(await fetchText(server, '/style.css'));
    // :first-of-type, because the sheet's Regenerate panel below uses the
    // same .regen-row class and must not stick too.
    assert.match(block, /#secret-detail-overlay \.regen-row:first-of-type \{[^}]*position: sticky/);
    assert.match(block, /#secret-detail-overlay \.regen-row:first-of-type \{[^}]*bottom: 0/);
    assert.match(block, /\.secret-trait-table td \{[^}]*word-break/);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/ui.mobile.test.js`
Expected: FAIL — no `#secret-detail-overlay` rule in the phone layer.

- [ ] **Step 3: Add the CSS**

Inside the phone block:

```css
  /* --- Secret mode sheet ---
     The Prev/Next nav sits at the top of a sheet that is now several
     screens tall, so on a phone it follows the scroll instead. Its hint
     line ("Hover to expand · Esc close") is already hidden above. */
  #secret-detail-overlay .regen-row:first-of-type {
    position: sticky;
    bottom: 0;
    z-index: 2;
    background: var(--surface);
    border-top: 1px solid var(--line);
    padding: 0.5rem 0;
  }
  #secret-detail-overlay .regen-row button { flex: 1; min-height: 44px; }
  .secret-trait-table td { word-break: break-word; }
  #secret-regen-panel .regen-row { flex-direction: column; align-items: stretch; }
```


- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test test/ui.mobile.test.js test/ui.secretMode.test.js`
Expected: PASS

- [ ] **Step 5: Bump the version for the phase**

`lib/version.js` → `1.0.10`; update `test/version.test.js`.
Run: `node --test test/version.test.js` → PASS

- [ ] **Step 6: Run the whole suite**

Run: `node --test --test-timeout=120000`
Expected: PASS apart from the known port collisions in the create-presets, set-flag and table-bullets files. Re-run each of those alone to confirm it passes in isolation, and say so in the report rather than calling a red run green.

- [ ] **Step 7: Verify in a browser and on the phone**

At 360×800: open Tables, pick a heading, toggle a bullet, open its Flags, edit a weight, use "← Tables" and the back gesture, add a custom value, open the gate panel on Gear. In Secret mode: log in, open an image, use Prev/Next, regenerate. Confirm no sideways scroll anywhere. Check 1440px against the pre-phase screenshot.

Then load the site on the Android phone over the LAN and walk every tab once.

- [ ] **Step 8: Commit and merge the phase**

```bash
git add public/style.css lib/version.js test/version.test.js test/ui.mobile.test.js
git commit -m "keep the secret sheet's navigation under the thumb"
git switch main && git merge --ff-only mobile-phase-4
git worktree remove ../mobile-phase-4 && git branch -d mobile-phase-4
```

---

## Where this plan departs from the spec

Three things changed once the plan was written against the real code. Each is a deliberate simplification, not an oversight.

1. **The filter panel's summary reads "Filters", not "Filters (n)".** A live count needs per-panel bookkeeping in three different renderers for a label nobody navigates by. Dropped.
2. **The Import action bar is always in the markup**, rather than appearing when a card is selected. Its two buttons are already `disabled` until something is selected, which reads the same and needs no new state.
3. **Trait Imports gains no Approve / Reject buttons.** The spec assumed the keyboard shortcuts were approve and reject actions; `runTraitAction` (app.js:6880) actually moves a cursor, toggles selection and opens a sheet. Selection and opening already have pointer equivalents on every row, so Task 10 enlarges those instead of inventing actions that do not exist.

## Notes for the implementer

- **Every class and function named here was read from the code, with two exceptions, both called out in Task 13:** the bullet's text span and the gate panel's per-Role checkbox container. Read `renderTableBullets` (app.js:7546) and `renderRoleGateControls` for those two, and use what is there. Do not invent a class the stylesheet has never seen.
- **Every phone rule goes inside the single `@media (max-width: 700px)` block.** If a rule needs to apply at every width (a new element that is hidden on desktop, a `<details>` summary's styling), put it with its component's other base rules and keep only the override in the phone layer.
- **Do not "tidy" desktop rules you pass through.** This work is additive.
- **The source assertions are a floor, not a ceiling.** A green `node --test` run does not mean the layout works; the browser checks at the end of each phase are what proves that.
