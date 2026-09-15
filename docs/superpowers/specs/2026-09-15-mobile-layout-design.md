# Mobile Layout — Design

**Status:** Approved design, not yet implemented
**Repo:** this one (the Import GUI)
**Target:** Android Chrome, portrait phones 360–430px wide. Landscape phones
and tablets must not break, but are not designed for.

## Summary

Make every part of the GUI usable from a phone on the LAN (`config.json`
already binds `0.0.0.0`): all tabs, every dialog, the Tables editor, Secret
mode and Backgrounds. Full parity, not a read-only subset.

The approach is a **responsive retrofit of the existing single page**. There is
one `index.html`, one `app.js` and one `style.css`, and a phone layer is added
on top. Desktop layout above the breakpoint does not change.

## Non-goals

- A separate mobile site or page (`/m`). `app.js` is bound to `index.html`'s
  element IDs, so a second page would mean forking ~9.8k lines of JS.
- A mobile-first rewrite of `style.css`.
- Designing for tablets or landscape phones as their own targets.
- iOS Safari–specific workarounds.
- Browser-automation tests in CI. The suite stays Node stdlib only.
- Installable PWA, offline support, push notifications.

## Architecture

### Breakpoint

- **One phone breakpoint: `@media (max-width: 700px)`.** It lives in a single
  block appended to the end of `public/style.css`, grouped by component with a
  comment header per group. 700px already exists as a breakpoint in the file.
- **The existing narrow-screen rules stay.** The 900px, 700px and 640px rules
  already in the file are kept, and the new block builds on them.
- **JS helper `isPhone()`.** Defined in `app.js` as
  `matchMedia('(max-width: 700px)').matches`. It is used only where behaviour
  must differ, not merely layout. Any listener that depends on it re-evaluates
  on the media query's `change` event.

### Shared overlay stack (back button + Esc)

Opening any overlay pushes a `history` entry (`history.pushState({ overlay: id })`).
Overlays are `.detail-overlay`, the Settings dialog, the secret login form,
confirm dialogs, the image zoom, and the Tables bullet screen.

- **Closing:** Android back (`popstate`) and Esc both close the **topmost**
  overlay through one shared function. It extends the existing
  `topmostOverlay()` logic in `app.js` and does not replace it.
- **Closing from the UI:** closing an overlay any other way (✕ button, backdrop
  tap, Esc) calls `history.back()`, so no stale history entries build up.
- **Stacking:** a confirm dialog over a detail sheet is two entries, and back
  closes the confirm first.
- **Where it applies:** this behaviour is active at every width, so desktop's
  browser back also closes overlays. It stays consistent, and it is harmless.

## Section 1 — Shared foundation

### Top bar and navigation (≤700px)

- **Top bar:** one row with "NHP Uplink", the current tab's name, a ☰ toggle
  button, and ⚙ (icon only, text label hidden).
- **Version number:** `.release-version` is hidden in the top bar and shown
  inside the Settings dialog instead.
- **Tab list:** `#tabs` is hidden by default. ☰ adds `is-open`, which shows it
  as a full-width dropdown panel under the sticky top bar: one tab per row,
  each button at least 48px tall.
- **Picking a tab:** it switches through the existing `switchTab` and then
  removes `is-open`. Tapping outside the panel or pressing ☰ again also closes
  it.
- **Markup stays compatible.** The ☰ button sits outside `#tabs`, as Settings
  already does, so `switchTab`'s button handling never sees it.
  `data-kind` / `data-feature` removal of tab buttons keeps working unchanged.
- **Current-tab label:** updated inside `switchTab`.

### Overlays and detail sheets (≤700px)

- **Full-screen:** `.detail` is `width: 100vw; height: 100dvh; border-radius: 0`
  and scrolls internally.
- **Close button:** `.detail-close` is sticky at the top of the sheet.
- **Images:** `.detail-images` stacks vertically, and images are
  `max-width: 100%` instead of `32vw` / `44vw`.
- **Other dialogs:** the Settings dialog, the secret login form and confirm
  dialogs use the same full-screen treatment.

### Touch replacements

| Desktop interaction | Phone replacement |
|---|---|
| Hover image to zoom (`attachImageZoom`, `mouseenter`/`mouseleave`) | Tap image opens zoom, tap zoom closes it. Zoom is an overlay, so back closes it. |
| ← → arrow keys on the NPC detail sheet (`stepDetail`) | New ← Previous / Next → buttons on the NPC sheet, matching the Secret sheet's existing ones, plus left/right swipe on the image area |
| "Hover to expand · Esc close" hints, `.detail-shortcuts` | Hidden |
| Trait Imports keyboard shortcuts (`traitKeyAction`) | The same actions as visible buttons on each candidate card; `#trait-shortcuts` hidden |

- **On desktop:** the Prev/Next buttons on the NPC sheet are visible at every
  width.
- **Hover zoom:** the `mouseenter` / `mouseleave` handlers are attached only
  when `matchMedia('(hover: hover)')` matches. Tap handling is attached when it
  does not.
- **Swipe rules:** swipe responds only to touches that start on
  `.detail-images`, and only when horizontal travel is at least 60px and more
  than twice the vertical travel. That way vertical scrolling of a tall sheet
  never triggers navigation.
- **Swipe and stacked overlays:** swipe is ignored when an overlay is stacked
  above the sheet, the same rule the arrow keys follow today.

### Forms and controls (≤700px)

- **Tap targets:** buttons, selects, and checkbox/radio labels are at least
  44px tall.
- **Font size:** `input`, `select` and `textarea` use `font-size: 16px` or
  more, so Chrome doesn't zoom in on focus.
- **Fixed widths:** the 14 fixed widths of 3+ digits (`min-width` / `minmax`
  such as `minmax(320px, 2fr)`) collapse to a single `1fr` column or to
  `min-width: 0`.
- **Wide content:** trait tables (`#detail-traits`, `.secret-trait-table`) and
  `<pre>` blocks (`.job-log`, `.detail-files pre`, `.bg-prompt`) scroll
  sideways inside their own container.
- **Page width:** the document itself must never scroll sideways.

### Shared patterns

- **Collapsible filter panel.** A `<details class="mobile-filters">` wrapper
  with a summary reading "Filters (n)", where n is the number of active
  filters. It is closed by default on phones and always open above 700px, set
  by `isPhone()` when the page loads and when the breakpoint changes. Search
  fields stay outside it and always visible.
- **Sticky action bar.** `.mobile-action-bar` is `position: sticky; bottom: 0`
  with the surface background and a top border. Its panel gets
  `padding-bottom` equal to the bar's height, so the bar never covers the last
  fields. Above 700px it is an ordinary inline row, matching today's layout.

## Section 2 — Per-tab designs (≤700px)

### Import Generated Art (the Secret gallery follows the same rules)

- **Cards:** `.grid` becomes 2 columns (`repeat(auto-fill, minmax(150px, 1fr))`).
- **Category pills:** `.categories` is one row with `overflow-x: auto` and no
  wrapping.
- **Toolbar:** sort and search stay visible. `#filters` goes into the
  collapsible filter panel.
- **Selecting cards:** each card has a checkbox in its corner with at least a
  44px tap area. Tapping the card body still opens the detail sheet.
- **Action bar:** once at least one card is selected, a sticky action bar
  shows "Import n" and "Delete", wired to the existing `#import-btn` /
  `#delete-btn` handlers. The toolbar buttons stay for desktop.

### Create NPC and Create Spaceship

- **Form layout:** `.form-grid` is one column. Width×height pairs stay side by
  side.
- **Override rows:** `#override-rows` / `#ship-override-rows` stack each row's
  trait select over its value, with a full-width remove button.
- **Collapsible sections:** the Secret tables and disable-tables sections keep
  their existing collapse controls and are collapsed by default.
- **Preset buttons:** `.create-presets-row` wraps its buttons into a 2-column
  grid.
- **Action bar:** `.create-actions` (Dry run, Generate) becomes a sticky
  action bar.
- **Job log:** `.job-log` gets `max-height: 50vh`, scrolls internally, and uses
  `white-space: pre-wrap`.

### Create Background

- **Form layout:** `.filter-row` groups are one column.
- **Trait lock rows:** they build on the existing 640px rule, so each value
  takes its own full-width line.
- **Prompt preview:** `#bg-dynamic-preview` wraps its text and has a Copy
  button, reusing the existing copy helper.
- **Action bar:** Roll, Preview and Render become a sticky action bar.

### Trait Imports

- **List view:** each candidate is a card showing table, value, status, and
  Approve / Reject buttons. These are the same actions the keyboard shortcuts
  trigger.
- **Filters:** search, table, status and sort go into the collapsible filter
  panel, with search outside it.
- **Default view:** on phones the view toggle defaults to tiles. A user's
  explicit choice is still respected.
- **Action bar:** Select all, "Import selected" and "Clear" become a sticky
  action bar.

### Tables

- **Two screens instead of two panels.** `.tables-layout` becomes a single
  column showing one screen at a time:
  - **Headings screen:** `#table-heading-list` at full width, with its
    `flex: 0 0 260px` basis and sticky positioning removed.
  - **Bullets screen:** tapping a heading, or a search result, adds
    `is-bullets` to `.tables-layout`. That hides the heading list, shows
    `.table-bullet-panel` at full width, and pushes an overlay history entry.
    A "← Tables" button at the top of the panel, or Android back, returns to
    the headings screen.
- **Bullet rows:** the enable checkbox and weight input share one line, and
  the bullet text wraps below. `.table-bullet-flags` goes into a closed
  `<details>` whose summary reads "Flags (n set)".
- **Gate panel:** its `<details>` stay as they are. Category and Role
  checkboxes become a 2-column grid.
- **Forms:** `#table-add-form`, `#gate-add-form` and `.presets-panel` stack
  into a single full-width column.

### Secret mode detail sheet

- Uses the full-screen sheet from Section 1.
- The existing `.regen-row` Prev/Next nav is sticky at the bottom of the sheet,
  and its hint text is hidden.
- The secret-mode handlers in `secret-mode.js` use the shared overlay stack.

## Testing

### Automated

New file `test/ui.mobile.test.js`, on a fixed port not used by any other test
file (check `grep -rn "PORT = " test` before choosing). It follows the existing
`ui.*` pattern: start a server with `startTestServer`, fetch `/`, `/app.js`,
`/style.css` and `/secret-mode.js`, and check the source text. Where a check
needs a function body, it uses a brace-balanced `extractSource` helper like the
one in `ui.gates.test.js`. It checks:

- `index.html` has the viewport meta tag, the ☰ toggle, the current-tab label,
  the NPC-sheet Prev/Next buttons, the collapsible filter panels and the sticky
  action bars.
- `style.css` has a `@media (max-width: 700px)` block containing the rules for:
  `#tabs` hidden unless `.is-open`, `.detail` at `100dvh`, 16px input font,
  one-column `.form-grid`, `.tables-layout.is-bullets`, and `.mobile-action-bar`
  sticky positioning.
- `app.js` defines `isPhone`, the shared close-topmost-overlay function used by
  both the `popstate` and `keydown` handlers, and `pushState` on open.
  `attachImageZoom` is gated on `(hover: hover)`, and a touch swipe handler
  calls `stepDetail`.
- The existing `ui.*` tests keep passing. Esc, arrow keys, `switchTab` and
  `topmostOverlay` behaviour stay intact.

These tests prove the code is there, not that the layout looks right, so the
manual checks below are required for every phase.

### Manual, per phase

- **Emulator:** Chrome DevTools phone emulation at 360×800 and 412×915, driven
  through claude-in-chrome.
- **For each tab touched:**
  - `document.documentElement.scrollWidth <= innerWidth`
  - no content cut off
  - the main flow works: open a sheet, tap to zoom, swipe, back closes the top
    overlay, select and import, generate, toggle a bullet and its flags
- **Desktop:** screenshots at 1440px before and after each phase are compared
  to catch desktop changes. Esc and arrow keys are rechecked.
- **Real device:** the user loads the site on their Android phone over the LAN
  at the end of each phase.

### Known flaky tests

A combined `node --test` run has pre-existing port collisions in the
create-presets, set-flag and table-bullets files. They are unrelated to this
work. When they fail, re-run those files on their own to confirm.

## Delivery

Four phases. Each is built in its own git worktree, fast-forward merged into
local `main`, then the worktree is removed. Nothing is pushed. Each phase
increments `lib/version.js` by one subversion step, as `AGENTS.md` requires.

1. **Foundation:** breakpoint block, `isPhone()`, top bar and ☰ menu, overlay
   stack and back button, full-screen sheets, touch replacements, form and
   control sizing, shared filter-panel and action-bar patterns.
2. **Import** (plus the Secret gallery), **Create NPC**, **Create Spaceship**.
3. **Trait Imports**, **Create Background**.
4. **Tables**, **Secret mode detail sheet**.

## Risks

| Risk | Mitigation |
|---|---|
| History entries fight Esc or stacked overlays | One shared close-topmost function for Esc, `popstate` and ✕. Non-back closes call `history.back()`. |
| Sticky action bars cover the last form fields | Panel `padding-bottom` equals the bar's height |
| Swipe fires during vertical scrolling | Only on `.detail-images`, with a ≥60px horizontal travel threshold at 2× vertical |
| Desktop changes | All layout rules scoped to ≤700px, plus before/after screenshots at 1440px |
| Tabs removed by `data-kind` / `data-feature` | ☰ menu lists `#tabs`' remaining buttons, so the existing removal carries over |
