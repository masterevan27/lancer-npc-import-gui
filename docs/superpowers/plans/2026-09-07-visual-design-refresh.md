# Visual design refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the design spec — tokens, contrast fixes, the four cascade
bugs, hover/selected/focus states, and per-tab rhythm — without changing what
any control does.

**Architecture:** Three static files (`public/style.css`, `public/app.js`,
`public/index.html`). Almost everything is CSS. One `app.js` template literal
changes (the spaceship card body). `index.html` does not change at all.

**Tech Stack:** Plain CSS custom properties, vanilla JS. No build step.

**Spec:** `docs/superpowers/specs/2026-09-07-visual-design-refresh-design.md`

**Test command** (from README → Development; there is no package.json):

```bash
node --test --test-concurrency=4 --test-timeout=120000 "test/*.test.js"
```

Expect `tests 599` with **one** known failure, `every flag the live tables use
has a checkbox` in `test/tableFlags.test.js` — it compares against the live
generator tables and is failing before this work starts. Any *other* failure
is yours. CI runs bare `node --test --test-timeout=120000` and counts one
higher.

## Global Constraints

- **Make no design decisions.** Every value is written out below. If a task
  seems to need a value it does not give, stop and ask — do not pick one.
- **Do not restart or kill the dev server.** It is running at
  http://localhost:5089/ and serves the main checkout. If you are in a
  worktree, the browser shows main until your branch is merged or you point
  a second server at your tree on another port; verification steps say
  "reload the page" assuming the served tree is the edited one.
- **Never toggle a checkbox, edit a weight, or click a flag on the Tables
  tab, and never press Regenerate, Re-roll, Set and regen, Import, Delete
  Permanently, or Generate.** Those write to disk or spawn the generator.
  Cancel is always safe. Opening a sheet or dialog is safe.
- **Quote-and-replace exactly.** Each task shows `Current` and `Replace
  with`. Use an exact-string edit; if the current text does not match the
  file, stop — the file has drifted and the task needs re-reading, not
  improvising.
- **The test pins listed under each task are load-bearing.** They name the
  selector shapes `test/ui.*.test.js` regex-match against the served CSS.
  Keep those shapes byte-for-byte where the task says so.
- **CSS comments stay.** Where a task replaces a rule, the comment above it is
  not part of the quoted `Current` block unless shown; leave it in place. If
  a comment names a hex value the task changes, edit the number in the
  comment to match (the comment's argument stays true).
- Source files here carry long comments explaining *why*. New rules you add
  get a one- or two-line comment in that register (copy the ones given).

---

## File Structure

| File | Change |
|---|---|
| `public/style.css` | tokens block; ~60 rule edits; ~15 new rules |
| `public/app.js` | one template literal in `render()` (Task 1.5) |
| `public/index.html` | **no change** |
| `test/*` | **no change** — if a test breaks, the CSS shape drifted; fix the CSS |

---

## Phase 0 — Foundation (tokens, focus, motion)

Ships on its own: after this phase the page looks identical except for
keyboard focus rings, a body line-height, and button fonts. Every later phase
depends on it.

### Task 0.1: Add the token block

**File:** `public/style.css`

- [ ] **Step 1:** Insert the following immediately after line 1
  (`* { box-sizing: border-box; }`), before `body {`:

```css
/* ---- Design tokens ----
   One place for every colour, radius, size and timing the sheet uses, so a
   value changes once. Contrast figures are WCAG ratios against the surface
   named in the comment; every text token here clears 4.5:1 on the surfaces
   it is used on except --text-disabled, which only ever labels a disabled
   control (AA-exempt). See the spec for what each replaced. */
:root {
  --bg:            #14161b;
  --bg-sunken:     #0e0f13;
  --surface:       #1c1f26;
  --surface-2:     #262a33;
  --surface-3:     #2f343f;
  --selected-bg:   #1e2637;

  --line:          #2c2f38;
  --line-strong:   #363b47;
  --line-hover:    #454b5a;

  --text:          #e6e6e6;
  --text-2:        #b3bac6;
  --text-3:        #9aa1ad;
  --text-4:        #8a919e;
  --text-disabled: #7a8291;
  --text-on-accent: #ffffff;

  --accent:        #3566e6;
  --accent-hover:  #3d6ef0;
  --accent-muted:  #2b4a9e;
  --accent-soft:   #33406b;
  --accent-text:   #7fb3ff;
  --accent-ring:   rgba(127, 179, 255, 0.45);
  --accent-border: #3d6ef0;

  --ok:            #177a42;
  --warn:          #d18f2a;
  --on-warn:       #1a1200;
  --warn-hover:    #e0a458;
  --warn-text:     #e0a458;
  --danger:        #c0392b;
  --danger-hover:  #a5311f;
  --danger-text:   #e8a798;
  --info:          #2b6cb0;
  --info-border:   #3b7fc4;
  --stale:         #7d5ba6;
  --neutral-badge: #384357;

  --banner-ok-bg:       #1d3324;
  --banner-ok-line:     #2f6b45;
  --banner-ok-text:     #d6f2e0;
  --banner-ok-btn:      #2f6b45;
  --banner-ok-btn-hover: #3f8a5b;
  --banner-ok-dismiss:  #b9dcc7;
  --banner-err-bg:      #33201d;
  --banner-err-line:    #6b3a2f;
  --banner-err-text:    #f2ded6;
  --banner-err-btn:     #6b3a2f;
  --banner-err-btn-hover: #8a4f3f;
  --banner-err-dismiss: #d9b9ae;

  --r-sm:   4px;
  --r-md:   6px;
  --r-lg:   8px;
  --r-xl:   12px;
  --r-pill: 999px;

  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-8: 32px;

  --fs-2xs:  0.68rem;
  --fs-xs:   0.75rem;
  --fs-sm:   0.8125rem;
  --fs-md:   0.875rem;
  --fs-lg:   1rem;
  --fs-xl:   1.25rem;
  --fs-2xl:  1.5rem;
  --lh-tight: 1.25;
  --lh-body:  1.45;
  --track-caps: 0.08em;

  --control-h:    2rem;
  --control-h-sm: 1.75rem;

  --shadow-card:   0 6px 18px rgba(0, 0, 0, 0.45);
  --shadow-dialog: 0 24px 64px rgba(0, 0, 0, 0.6);

  --t-fast: 120ms;
  --t-base: 180ms;
  --ease:   cubic-bezier(0.2, 0.7, 0.3, 1);

  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent-text);
}
```

### Task 0.2: Body line-height and form-control font

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #14161b;
  color: #e6e6e6;
}
```

Replace with:

```css
body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: var(--lh-body);
  background: var(--bg);
  color: var(--text);
}
/* Buttons and inputs otherwise pick up the browser's own control font, which
   on Windows is a different face at 13.33px from the page's. Only the family
   is inherited: sizes are set per rule below so nothing silently grows. */
button, input, select, textarea { font-family: inherit; }
```

### Task 0.3: Focus rings

**File:** `public/style.css`

- [ ] **Step 1:** Insert directly after the `button, input, select, textarea`
  line added in Task 0.2:

```css
/* One focus treatment for the keyboard. The browser's own ring is a white
   outline that vanishes against light art and reads as an error on a dark
   surface; a two-tone ring (page colour, then the accent) stays visible on
   every ground in the sheet. Inputs take the accent on their own border
   instead so the ring does not fight the border they already have. */
:focus-visible { outline: none; box-shadow: var(--focus-ring); }
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}
input[type="checkbox"],
input[type="radio"] { accent-color: var(--accent); }
```

### Task 0.4: Motion

**File:** `public/style.css`

- [ ] **Step 1:** Insert directly after the block added in Task 0.3:

```css
/* Hover and focus changes ease rather than snap. Cards get their own, longer
   transition in .card. Anyone who has asked their OS for less motion gets
   none at all. */
button, a, label, select, input {
  transition: background-color var(--t-fast) var(--ease),
              border-color var(--t-fast) var(--ease),
              color var(--t-fast) var(--ease),
              box-shadow var(--t-fast) var(--ease);
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
  }
}
```

### Phase 0 verification

- [ ] Run the test suite. Expected: `tests 599`, one known failure only.
- [ ] Reload http://localhost:5089/. The page should look the same as
  before. Click into the search box, then press Tab repeatedly: every
  control that takes focus shows a blue two-tone ring; the search box shows
  a blue border with a soft halo. No white outlines anywhere.
- [ ] Tests that could break: none read these rules. `ui.batchBanner` and
  `ui.regenBanner` regex `.banner {` — the token block is above it and does
  not interfere.

**Rollback:** `git checkout -- public/style.css`.

---

## Phase 1 — P1 fixes

Independent of every other phase except Phase 0. Each task is one bug.

### Task 1.1: The Set… picker's orphan checkbox (D2)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
#set-trait-release-row {
  display: block;
  margin-top: 0.7rem;
  font-size: 0.85rem;
  color: #d7dae0;
  cursor: pointer;
}
```

Replace with:

```css
#set-trait-release-row {
  display: block;
  margin-top: 0.7rem;
  font-size: var(--fs-md);
  color: var(--text);
  cursor: pointer;
}
/* Same guard .banner[hidden] carries, for the same reason: the display above
   is an author declaration and beats the browser's [hidden] outright, which
   left an unlabelled checkbox sitting under the list for every value that
   conflicts with nothing. */
#set-trait-release-row[hidden] { display: none; }
```

### Task 1.2: The three native buttons (G3 / C1 / TB5)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
#add-filter {
  background: #262a33;
  border: 1px solid #363b47;
  color: #e6e6e6;
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
}
```

Replace with:

```css
/* The three "add a row" buttons share one rule: the two override-row ones on
   the Create tabs shipped with no rule at all and painted as the browser's
   grey default in the middle of a dark form. */
#add-filter,
#add-override,
#add-ship-override {
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  color: var(--text);
  height: var(--control-h);
  padding: 0 0.8rem;
  border-radius: var(--r-md);
  cursor: pointer;
  font-size: var(--fs-md);
}
#add-filter:hover:not(:disabled),
#add-override:hover:not(:disabled),
#add-ship-override:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--line-hover);
}
#add-filter:disabled,
#add-override:disabled,
#add-ship-override:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 2:** Current:

```css
.preset-import-label {
  background: #262a33;
  border: 1px solid #363b47;
  color: #e6e6e6;
  padding: 0.5rem 0.9rem;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
}
```

Replace with:

```css
/* #preset-save-btn joins the label it sits beside on the Tables tab - it had
   no rule of its own and painted native grey next to a styled Import. */
#preset-save-btn,
.preset-import-label {
  display: inline-flex;
  align-items: center;
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  color: var(--text);
  height: var(--control-h);
  padding: 0 0.9rem;
  border-radius: var(--r-md);
  font-size: var(--fs-md);
  cursor: pointer;
}
#preset-save-btn:hover,
.preset-import-label:hover {
  background: var(--surface-3);
  border-color: var(--line-hover);
}
```

### Task 1.3: "Delete Permanently" is grey (D1)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.confirm-actions button {
  background: #262a33;
  border: 1px solid #363b47;
  color: #e6e6e6;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.88rem;
}
```

Replace with:

```css
.confirm-actions button {
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  color: var(--text);
  padding: 0.5rem 1rem;
  border-radius: var(--r-md);
  cursor: pointer;
  font-size: var(--fs-md);
}
.confirm-actions button:hover { background: var(--surface-3); border-color: var(--line-hover); }
/* button.danger is earlier in this file at the same specificity, so the grey
   above was winning on source order and the one irreversible button in the
   app looked exactly like Cancel. Restated here, after it, on purpose. */
.confirm-actions button.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #ffffff;
  font-weight: 600;
}
.confirm-actions button.danger:hover { background: var(--danger-hover); border-color: var(--danger-hover); }
```

### Task 1.4: The ship form's Generate button (C2)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
#create-generate-btn { background: #3d6ef0; border-color: #3d6ef0; font-weight: 600; }
```

Replace with:

```css
#create-generate-btn,
#create-ship-generate-btn { background: var(--accent); border-color: var(--accent); font-weight: 600; }
#create-generate-btn:hover:not(:disabled),
#create-ship-generate-btn:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
```

### Task 1.5: Spaceship cards (I1)

**Files:** `public/app.js`, `public/style.css`

- [ ] **Step 1 (app.js, in `render()`, ~line 865):** Current:

```js
    body.innerHTML = `<div class="name">${escapeHtml(item.name)}</div>
      <div class="sub">${escapeHtml(item.callsign || '')}</div>
      ${item.traits?.Role ? `<div class="role">${escapeHtml(item.traits.Role)}</div>` : ''}
      ${item.roleCategory ? `<div class="role-category">${escapeHtml(item.roleCategory)}</div>` : ''}
      ${item.traits?.['Ship type'] ? `<div class="role">${escapeHtml(item.traits['Ship type'])}</div>` : ''}
      ${item.traits?.Size ? `<div class="role-category">${escapeHtml(item.traits.Size)}</div>` : ''}`;
```

Replace with:

```js
    // A ship's Ship type and Size are whole sentences, not a two-word role
    // and a one-word category, so they take two clamped text lines rather
    // than the NPC's role line and uppercase pill - the pill turned a Size
    // bullet into a five-line uppercase blob. The full text is in the title
    // and on the sheet.
    body.innerHTML = `<div class="name">${escapeHtml(item.name)}</div>
      <div class="sub">${escapeHtml(item.callsign || '')}</div>
      ${item.traits?.Role ? `<div class="role">${escapeHtml(item.traits.Role)}</div>` : ''}
      ${item.roleCategory ? `<div class="role-category">${escapeHtml(item.roleCategory)}</div>` : ''}
      ${item.traits?.['Ship type'] ? `<div class="role ship-line" title="${escapeHtml(item.traits['Ship type'])}">${escapeHtml(item.traits['Ship type'])}</div>` : ''}
      ${item.traits?.Size ? `<div class="sub ship-line" title="${escapeHtml(item.traits.Size)}">${escapeHtml(item.traits.Size)}</div>` : ''}`;
```

- [ ] **Step 2 (style.css):** Current:

```css
.card--spaceship .thumb { aspect-ratio: 16 / 9; }
```

Replace with:

```css
.card--spaceship .thumb { aspect-ratio: 16 / 9; }
/* Two lines, then an ellipsis: enough to tell a destroyer from a cruiser at
   a glance, and the sheet has the rest. */
.card .ship-line {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  margin-top: var(--sp-1);
  line-height: 1.35;
}
```

- [ ] **Step 3 (style.css):** Current:

```css
.card .badge.hex-badge {
  top: auto;
  right: auto;
  bottom: 0.4rem;
  left: 0.4rem;
  background: #384357;
}
```

Replace with:

```css
.card .badge.hex-badge {
  top: 1.9rem;
  right: auto;
  bottom: auto;
  left: 0.4rem;
  background: var(--neutral-badge);
}
```

Also edit the comment directly above that rule: change `its own corner,
bottom-left, so it never collides with the top corners' status and New
badges` to `its own slot, top-left under the select checkbox (0.4rem +
1.15rem tall + a gap), so it never collides with the New tag beside the box
or the status badge opposite, and never sits on the body text`.

### Task 1.6: Hint grey (G1)

**File:** `public/style.css`. Each line is a find-and-replace of the colour
only; everything else in each rule stays.

- [ ] `.hint { color: #6b7280; ...` → `.hint { color: var(--text-4); ...`
- [ ] `.detail-generated { margin-top: -0.5rem; font-size: 0.8rem; color: #6b7280; }` → `... color: var(--text-4); }`
- [ ] In `.detail-shortcuts { ... color: #6b7280; ...}` → `color: var(--text-4);`
- [ ] `.filter-row .override-search::placeholder { color: #6b7280; }` → `{ color: var(--text-4); }`
- [ ] In `.override-search-note { ... color: #8b93a1; ...}` → `color: var(--text-4);`
- [ ] In `.chance-note { ... color: #8b93a1; }` → `color: var(--text-4);`
- [ ] In `.table-bullet-flags { ... color: #8b93a1; }` → `color: var(--text-4);`
- [ ] In `.model3d-files { ... color: #7f8794; }` → `color: var(--text-4);`
- [ ] `.trait-option-disabled { color: #8b93a1; font-style: italic; }` → `{ color: var(--text-4); font-style: italic; }`
- [ ] Disabled labels — in each of these four rules change `color: #6b7280` to `color: var(--text-disabled)`:
  `#import-btn:disabled`, `button.danger:disabled`,
  `#regen-btn:disabled,\n#model3d-btn:disabled`, and
  `.reroll-btn:disabled,\n.set-trait-btn:disabled`.

### Task 1.7: Status fills (G2)

**File:** `public/style.css`

- [ ] **Step 1:** In `.card .badge {` change `background: #1f9d55;` to
  `background: var(--ok);`.
- [ ] **Step 2:** Current:

```css
.card .badge.error { background: #c0392b; }
.card .badge.pending { background: #b7791f; }
```

Replace with:

```css
.card .badge.error { background: var(--danger); }
/* Dark text on the amber, not white: white on this amber is 3.6:1 and the
   pill is 11px tall. The dark-on-amber pair is 6.8:1 and reads as a warning
   label should. */
.card .badge.pending { background: var(--warn); color: var(--on-warn); }
```

- [ ] **Step 3:** Current:

```css
#regen-btn.accent { background: #b7791f; }
#regen-btn.accent:hover { background: #d18f2a; }
```

Replace with:

```css
#regen-btn.accent { background: var(--warn); color: var(--on-warn); }
#regen-btn.accent:hover { background: var(--warn-hover); }
```

- [ ] **Step 4:** `.regen-stale { color: #b7791f; ...` → `.regen-stale { color: var(--warn-text); ...` (keep every other declaration; **do not add `display:`** — `ui.detailRepaint` forbids it).
- [ ] **Step 5:** `.card .badge.stale { background: #7d5ba6; }` → `{ background: var(--stale); }`. In `.card .badge.new {` change `background: #2b6cb0;` → `background: var(--info);` (keep `right: auto; left: 1.85rem;` exactly — `ui.newBadge` regexes this rule for `background:` and `left:`). `.card.is-new { border-color: #3b7fc4; }` → `{ border-color: var(--info-border); }`.

### Task 1.8: A base `.badge` rule (T2)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.card .badge {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  background: var(--ok);
  color: white;
  font-size: 0.68rem;
  padding: 0.15rem 0.4rem;
  border-radius: 999px;
}
```

(After Task 1.7 Step 1 it reads `var(--ok)`; if it still reads `#1f9d55`,
do 1.7 first.) Replace with:

```css
/* The pill itself, wherever it appears. Only .card ever styled it before, so
   the Imported badge on a Trait Imports row painted as bare text. .card adds
   the corner; nothing else needs to. */
.badge {
  display: inline-block;
  background: var(--ok);
  color: #ffffff;
  font-size: var(--fs-2xs);
  line-height: 1.3;
  padding: 0.15rem 0.45rem;
  border-radius: var(--r-pill);
  white-space: nowrap;
}
.card .badge {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
}
```

### Phase 1 verification

- [ ] Run the test suite. Expected: `tests 599`, one known failure.
  Tests at risk: `ui.newBadge` (`.card .badge.new` must still contain
  `background:` and `left:`; `.card.is-new` must contain `border-color:`),
  `ui.detailRepaint` (`.regen-stale {` exists and has no `display:`),
  `ui.kindVocab` / `ui.rerollConfirm` / `ui.setTraitPicker` lift
  `renderDetailTraits` and `traitControlCells` — untouched, but Task 1.5
  edited the same file, so any syntax slip there fails these.
- [ ] Browser, Import tab → **Spaceships (3)**: each ship card shows name,
  callsign, then two lines of ship type and two lines of size in muted grey,
  each ending in "…"; the `2◇`/`5◇` pill sits on the image just under the
  checkbox; nothing overlaps.
- [ ] Tick a ship card, click **Delete Selected (1)**: the dialog's right
  button is solid red. Press **Cancel**.
- [ ] NPCs → open any card → click **Set…** on *Outfit* → wait for the list:
  no bare checkbox appears under the list. Click a value with a "would
  clash" note if there is one: the labelled checkbox appears. **Cancel**,
  close the sheet.
- [ ] Create NPC / Create Spaceship: **+ Add trait override** is a dark
  grey button like **+ Add filter**; the ship tab's **Generate** is blue.
- [ ] Tables: scroll to Presets: **Save current as preset…** matches
  **Import preset…**.
- [ ] Trait Imports: "Imported" is a green pill on every imported row.
- [ ] Zoom on any card's grey hint text ("(blank = random)" on Create): it
  is visibly lighter than before.

**Rollback:** `git checkout -- public/style.css public/app.js` (or revert
the phase commit).

---

## Phase 2 — Import grid

Depends on Phase 0 and Task 1.8.

### Task 2.1: Card hover, selected state, checkbox (I2, I6)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.card {
  background: #1c1f26;
  border: 1px solid #2c2f38;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  position: relative;
}
.card.imported { opacity: 0.55; }
```

Replace with:

```css
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  overflow: hidden;
  cursor: pointer;
  position: relative;
  transition: border-color var(--t-base) var(--ease),
              box-shadow var(--t-base) var(--ease),
              transform var(--t-base) var(--ease);
}
/* Before .card.is-new in the file on purpose: same specificity, so the later
   rule wins and a new card keeps its blue border while hovered. */
.card:hover {
  border-color: var(--line-hover);
  box-shadow: var(--shadow-card);
  transform: translateY(-2px);
}
/* The ticked card. A lighter, glowing ring rather than the primary blue, so
   it cannot be mistaken for .card.is-new's 1px border - "selected" and "new"
   are independent and a card is often both. */
.card:has(.check:checked) {
  border-color: var(--accent-text);
  box-shadow: 0 0 0 1px var(--accent-text);
}
.card:has(.check:checked) .body { background: var(--selected-bg); }
/* Imported: the art dims and the text quietens, but the text stays legible
   (the old whole-card opacity took the callsign to 3:1) and the badge stays
   at full strength, since it is the thing that says why the card is dim. */
.card.imported img { opacity: 0.55; }
.card.imported .name,
.card.imported .role,
.card.imported .ship-line { color: var(--text-3); }
```

- [ ] **Step 2:** Current:

```css
.card .check {
  position: absolute;
  top: 0.4rem;
  left: 0.4rem;
  width: 1.15rem;
  height: 1.15rem;
}
```

Replace with:

```css
.card .check {
  position: absolute;
  top: 0.4rem;
  left: 0.4rem;
  width: 1.15rem;
  height: 1.15rem;
  margin: 0;
  cursor: pointer;
  /* Portraits run light at the top-left corner often enough that a white box
     with no edge disappeared into them. */
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
}
```

### Task 2.2: Card thumbnail and body rhythm (I4)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.card img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  display: block;
  background: #0e0f13;
}
.card .body { padding: 0.5rem 0.6rem 0.65rem; }
.card .name { font-weight: 600; font-size: 0.92rem; }
.card .sub { font-size: 0.78rem; color: #9aa1ad; }
.card .role-category {
  display: inline-block;
  margin-top: 0.3rem;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #7c8ba1;
  background: #262a33;
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
}
.card .role { font-size: 0.76rem; color: #b3bac6; margin-top: 0.2rem; }
```

Replace with:

```css
.card img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  display: block;
  background: var(--bg-sunken);
  transition: opacity var(--t-base) var(--ease);
}
.card .body { padding: var(--sp-2) 10px 10px; }
.card .name { font-weight: 600; font-size: 0.92rem; line-height: var(--lh-tight); }
.card .sub { font-size: 0.78rem; line-height: 1.35; color: var(--text-3); margin-top: 2px; }
.card .role-category {
  display: inline-block;
  margin-top: var(--sp-2);
  font-size: var(--fs-2xs);
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #98a6bd;
  background: var(--surface-2);
  border-radius: var(--r-pill);
  padding: 0.1rem 0.45rem;
}
.card .role { font-size: 0.78rem; line-height: 1.35; color: var(--text-2); margin-top: 6px; }
```

(`#98a6bd` is 5.8:1 on `--surface-2`; the old `#7c8ba1` was 4.15:1 at
10.9px uppercase.)

- [ ] **Step 2:** `.grid { ... gap: 0.9rem; }` → `gap: var(--sp-4);` (keep
  the `grid-template-columns` line as is).

### Task 2.3: Empty state (I5)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.empty { color: #9aa1ad; margin-top: 2rem; }
```

Replace with:

```css
/* A panel rather than a stray sentence at the left margin, so an emptied grid
   reads as a state the page is in and not as a line that failed to render. */
.empty {
  color: var(--text-3);
  margin: 2.5rem auto 0;
  max-width: 32rem;
  padding: var(--sp-8) var(--sp-6);
  text-align: center;
  border: 1px dashed var(--line-strong);
  border-radius: var(--r-lg);
  font-size: var(--fs-md);
}
```

### Task 2.4: Toolbar controls at one height (G5, G6)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.sort-by select,
.filter-by select {
  background: #262a33;
  border: 1px solid #363b47;
  color: #e6e6e6;
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
  font-size: 0.82rem;
}
#import-btn {
  background: #3d6ef0;
  border: none;
  color: white;
  padding: 0.55rem 1.1rem;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}
#import-btn:disabled { background: #2c2f38; color: var(--text-disabled); cursor: default; }

button.danger {
  background: #c0392b;
  border: 1px solid #c0392b;
  color: white;
  padding: 0.55rem 1.1rem;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}
button.danger:hover { background: #a5311f; }
button.danger:disabled { background: #2c2f38; border-color: #363b47; color: var(--text-disabled); cursor: default; }
```

(`var(--text-disabled)` is what Task 1.6 left there; if a rule still says
`#6b7280`, do 1.6 first.) Replace with:

```css
.sort-by select,
.filter-by select {
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  color: var(--text);
  height: var(--control-h);
  padding: 0 0.5rem;
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
}
#import-btn {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: var(--text-on-accent);
  height: var(--control-h);
  padding: 0 1.1rem;
  border-radius: var(--r-md);
  font-weight: 600;
  font-size: var(--fs-md);
  cursor: pointer;
}
#import-btn:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
#import-btn:disabled { background: #2c2f38; border-color: #2c2f38; color: var(--text-disabled); cursor: default; }

button.danger {
  background: var(--danger);
  border: 1px solid var(--danger);
  color: white;
  height: var(--control-h);
  padding: 0 1.1rem;
  border-radius: var(--r-md);
  font-weight: 600;
  font-size: var(--fs-md);
  cursor: pointer;
}
button.danger:hover:not(:disabled) { background: var(--danger-hover); border-color: var(--danger-hover); }
button.danger:disabled { background: #2c2f38; border-color: var(--line-strong); color: var(--text-disabled); cursor: default; }
```

- [ ] **Step 2:** Current:

```css
#filter-search {
  background: #1c1f26;
  border: 1px solid #363b47;
  color: #e6e6e6;
  padding: 0.4rem 0.7rem;
  border-radius: 6px;
  font-size: 0.85rem;
  min-width: 240px;
}
```

Replace with:

```css
#filter-search,
#trait-search {
  background: var(--surface);
  border: 1px solid var(--line-strong);
  color: var(--text);
  height: var(--control-h);
  padding: 0 0.7rem;
  border-radius: var(--r-md);
  font-size: var(--fs-md);
  min-width: 240px;
}
#filter-search::placeholder,
#trait-search::placeholder { color: var(--text-4); }
```

- [ ] **Step 3:** Current:

```css
.filter-row select,
.filter-row input {
  background: #262a33;
  border: 1px solid #363b47;
  color: #e6e6e6;
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
  font-size: 0.82rem;
}
.filter-row .filter-value { min-width: 160px; }
.filter-row .filter-remove {
  background: none;
  border: none;
  color: #9aa1ad;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0 0.2rem;
}
.filter-row .filter-remove:hover { color: #e6e6e6; }
```

Replace with:

```css
.filter-row select,
.filter-row input {
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  color: var(--text);
  height: var(--control-h-sm);
  padding: 0 0.5rem;
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
}
.filter-row .filter-value { min-width: 160px; }
/* A real hit area: the glyph alone was ~12px wide. */
.filter-row .filter-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  background: none;
  border: none;
  border-radius: var(--r-sm);
  color: var(--text-3);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0;
}
.filter-row .filter-remove:hover { color: var(--text); background: var(--surface-2); }
```

Note: the `height: var(--control-h-sm)` above also reaches the Create tabs'
override rows (their table select, search box, value select and custom-text
input are all `.filter-row select` / `.filter-row input`). That is intended —
28px is the in-row control height everywhere — and Task 4.3 Step 5 gives
`.override-clear` the same height so the pair stays level. Colours and
paddings on those override controls still come from their own, later rules.
The `.override-cell .filter-value` comment about source order still holds —
do not move rules.

### Task 2.5: Tabs and category pills (I7)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.tabs button {
  background: none;
  border: 1px solid #363b47;
  color: #9aa1ad;
  padding: 0.4rem 0.9rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.88rem;
}
.tabs button.active { background: #262a33; border-color: #3d6ef0; color: #e6e6e6; }
```

Replace with:

```css
.tabs button {
  background: none;
  border: 1px solid var(--line-strong);
  color: var(--text-3);
  height: var(--control-h);
  padding: 0 0.9rem;
  border-radius: var(--r-md);
  cursor: pointer;
  font-size: var(--fs-md);
}
.tabs button:hover:not(.active) { color: var(--text); border-color: var(--line-hover); background: var(--surface-2); }
.tabs button.active { background: var(--surface-2); border-color: var(--accent-border); color: var(--text); }
```

- [ ] **Step 2:** Current:

```css
.categories button {
  background: #262a33;
  border: 1px solid #363b47;
  color: #e6e6e6;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  cursor: pointer;
  font-size: 0.9rem;
}
.categories button.active { background: #3d6ef0; border-color: #3d6ef0; }
.categories button:disabled { opacity: 0.4; cursor: default; }
```

Replace with:

```css
.categories button {
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  color: var(--text);
  height: var(--control-h);
  padding: 0 0.9rem;
  border-radius: var(--r-pill);
  cursor: pointer;
  font-size: var(--fs-md);
}
.categories button:hover:not(.active):not(:disabled) { background: var(--surface-3); border-color: var(--line-hover); }
.categories button.active { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); }
.categories button:disabled { opacity: 0.4; cursor: default; }
```

- [ ] **Step 3:** `.topbar {` — change `background: #1c1f26;` →
  `background: var(--surface);` and `border-bottom: 1px solid #2c2f38;` →
  `border-bottom: 1px solid var(--line);`. `.topbar h1 { font-size: 1.1rem;
  margin: 0; white-space: nowrap; }` → add `letter-spacing: 0.02em;` after
  `margin: 0;`.
- [ ] **Step 4:** `.status { color: #9aa1ad; font-size: 0.85rem; flex: 1; }`
  → `.status { color: var(--text-3); font-size: var(--fs-md); flex: 1; }`.
  `.select-all { ... font-size: 0.9rem; }` → `font-size: var(--fs-md);`.
  `.sort-by,\n.filter-by { ... font-size: 0.9rem; }` → `font-size: var(--fs-md);`.
  `.toolbar { ... margin-bottom: 1rem; }` → `margin-bottom: var(--sp-3);`.
  `.filters { ... margin-bottom: 1rem; }` → `margin-bottom: var(--sp-4);`.
  `.categories { display: flex; gap: 0.5rem; margin-bottom: 1rem; }` → `gap: var(--sp-2); margin-bottom: var(--sp-4);`.

### Phase 2 verification

- [ ] Test suite: `tests 599`, one known failure. At risk: `ui.newBadge`
  (Task 2.1 must leave `.card.is-new {` after `.card:hover` and unchanged).
- [ ] Import tab, NPCs: hover a card — it lifts 2px, gains a soft shadow and
  a lighter border; move off and it settles over ~180ms. Tick a card — a
  pale-blue 2px ring and a slightly blue body. A card with the blue "New"
  pill keeps its blue border when hovered. Imported cards (if any) show a
  dimmed portrait, grey text, and a full-green Imported pill.
- [ ] Zoom the toolbar row: search box, **+ Add filter**, the sort select,
  **Import Selected**, **Delete Selected**, every tab and both category
  pills are all exactly 32px tall and align top and bottom.
- [ ] Type `zzzzqq` into search: a centred dashed panel says "No items match
  the current filters." Clear the box.
- [ ] Press Tab from the search box: the ring lands on **+ Add filter**, then
  on the first card's checkbox, each with the two-tone ring.

**Rollback:** revert the phase commit; nothing later depends on these
values except Task 5.3 (which reuses `#trait-search` from Task 2.4 Step 2 —
if Phase 2 is rolled back, remove `#trait-search` from that selector list
and restore the original `#trait-search` rule).

---

## Phase 3 — Detail sheet and dialogs

Depends on Phase 0 and Phase 1.

### Task 3.1: The sheet frame (D6)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.detail {
  background: #1c1f26;
  border: 1px solid #2c2f38;
  border-radius: 10px;
  padding: 1.25rem;
  max-width: 90vw;
  max-height: 90vh;
  overflow: auto;
  position: relative;
}
```

Replace with:

```css
.detail {
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-xl);
  padding: var(--sp-6);
  max-width: 90vw;
  max-height: 90vh;
  overflow: auto;
  position: relative;
  box-shadow: var(--shadow-dialog);
}
```

- [ ] **Step 2:** `.detail-overlay { ... background: rgba(0, 0, 0, 0.7); ...}` → `background: rgba(0, 0, 0, 0.72);` (unchanged otherwise; keep `.detail-overlay[hidden]` and `:not([hidden])` rules exactly).
- [ ] **Step 3:** `.detail-images img { max-height: 40vh; max-width: 32vw; border-radius: 6px; background: #0e0f13; cursor: zoom-in; }` → `.detail-images img { max-height: 40vh; max-width: 32vw; border-radius: var(--r-lg); border: 1px solid var(--line); background: var(--bg-sunken); cursor: zoom-in; }`.
  `.detail-images figcaption { font-size: 0.75rem; color: #9aa1ad; margin-top: 0.25rem; }` → `{ font-size: var(--fs-xs); color: var(--text-3); margin-top: var(--sp-2); }`.

### Task 3.2: Close button (D5)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.detail-close {
  position: absolute;
  top: 0.6rem;
  right: 0.8rem;
  background: none;
  border: none;
  color: #9aa1ad;
  font-size: 1.4rem;
  cursor: pointer;
}
```

Replace with:

```css
.detail-close {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  width: 2rem;
  height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: var(--r-md);
  color: var(--text-3);
  font-size: 1.4rem;
  line-height: 1;
  padding: 0;
  cursor: pointer;
}
.detail-close:hover { background: var(--surface-2); color: var(--text); }
```

### Task 3.3: Titles and eyebrow headings (D4, G9)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.detail-info h2 { margin: 0 0 0.15rem; }
.detail-info p { margin: 0 0 0.75rem; color: #9aa1ad; }
```

Replace with:

```css
.detail-info h2 { margin: 0 0 0.15rem; font-size: var(--fs-2xl); line-height: var(--lh-tight); }
.detail-info p { margin: 0 0 0.75rem; color: var(--text-3); }
```

- [ ] **Step 2:** `.regen-panel h3 { margin: 0 0 0.5rem; font-size: 0.85rem; color: #b3bac6; }` → 

```css
.regen-panel h3 {
  margin: 0 0 var(--sp-2);
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--track-caps);
  color: var(--text-3);
}
```

- [ ] **Step 3:** `#detail-prompts h3,\n.detail-files h3 { font-size: 0.82rem; color: #9aa1ad; margin: 0; }` →

```css
#detail-prompts h3,
.detail-files h3 {
  margin: 0;
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--track-caps);
  color: var(--text-3);
}
```

- [ ] **Step 4:** `.trait-detail-info h3 { font-size: 0.82rem; color: #9aa1ad; margin: 0.9rem 0 0.3rem; }` →

```css
.trait-detail-info h3 {
  margin: var(--sp-4) 0 var(--sp-1);
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--track-caps);
  color: var(--text-3);
}
```

- [ ] **Step 5:** `.confirm-dialog h2 { margin: 0 0 0.6rem; }` → `.confirm-dialog h2 { margin: 0 0 0.6rem; font-size: var(--fs-xl); line-height: var(--lh-tight); }`.
  `.set-trait-dialog h2 { margin: 0 0 0.6rem; }` → `.set-trait-dialog h2 { margin: 0 0 0.6rem; font-size: var(--fs-xl); line-height: var(--lh-tight); }`.
  `.confirm-dialog p { color: #d7dae0; }` → `{ color: var(--text); }`.
  Both `.confirm-warning` rules: `color: #e0a458; font-size: 0.85rem;` → `color: var(--warn-text); font-size: var(--fs-md);`.

### Task 3.4: Trait table (D3)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
#detail-traits { border-collapse: collapse; font-size: 0.85rem; }
#detail-traits td { padding: 0.15rem 0.6rem 0.15rem 0; vertical-align: top; }
```

Replace with:

```css
#detail-traits { border-collapse: collapse; font-size: var(--fs-md); width: 100%; margin-top: var(--sp-3); }
#detail-traits td { padding: 0.3rem 0.6rem 0.3rem 0; vertical-align: top; border-top: 1px solid var(--line); }
#detail-traits tr:first-child td { border-top: 0; }
```

- [ ] **Step 2:** `#detail-traits td:nth-child(3) { color: #9aa1ad; white-space: nowrap; }` → `#detail-traits td:nth-child(3) { color: var(--text-3); white-space: nowrap; }`. **Keep the selector and `white-space: nowrap` exactly** (`ui.traitColumns`). Do not touch `td.reroll-cell, td.set-cell` or `td:last-child`.
- [ ] **Step 3:** In the shared rule that starts `.set-trait-btn,\n.reroll-btn,\n.copy-btn {` change only values: `background: #2b4a9e;` → `background: var(--accent-muted);`, `border: 1px solid #2b4a9e;` → `border: 1px solid var(--accent-muted);`, `color: #dbe4ff;` → `color: #e3eaff;`, `border-radius: 5px;` → `border-radius: var(--r-sm);`, `padding: 0.05rem 0.4rem;` → `padding: 0.1rem 0.45rem;`. **Keep the three selector lines in that order and keep `background:` inside the block** (`ui.copyPrompts`). In the hover/focus rule below it, `#3d6ef0` (×2) → `var(--accent-hover)`. `.set-trait-btn { background: #33406b; border-color: #33406b; }` → `{ background: var(--accent-soft); border-color: var(--accent-soft); }`.
- [ ] **Step 4:** `#detail-prompts pre,\n.detail-files pre {` — `background: #0e0f13;` → `var(--bg-sunken)`, `border: 1px solid #2c2f38;` → `1px solid var(--line)`, `border-radius: 6px;` → `var(--r-md)`, `font-size: 0.82rem;` → `var(--fs-sm)`. Add `line-height: 1.5;` after `font-size`.
  `.detail-file-names { ... color: #9aa1ad; }` → `color: var(--text-3);`.
- [ ] **Step 5:** `.regen-panel { background: #14161b; border: 1px solid #2c2f38; border-radius: 8px; padding: 0.7rem 0.8rem; margin-bottom: 0.9rem; }` → `.regen-panel { background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-lg); padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-3); }`.
  `.regen-row { ... font-size: 0.82rem; ...}` → `font-size: var(--fs-sm);`.
  `.regen-status { margin: 0.5rem 0 0; font-size: 0.8rem; color: #b3bac6; }` → `{ margin: var(--sp-2) 0 0; font-size: var(--fs-sm); color: var(--text-2); }`.
  In `#regen-btn,\n#model3d-btn {` — `background: #3d6ef0;` → `var(--accent)`, `border-radius: 6px;` → `var(--r-md)`, `font-size: 0.82rem;` → `var(--fs-sm)`. Add after that rule: `#regen-btn:hover:not(:disabled):not(.accent),\n#model3d-btn:hover:not(:disabled) { background: var(--accent-hover); }`.

### Task 3.5: Set… picker rows (D7)

**File:** `public/style.css`

- [ ] **Step 1:** `#set-trait-filter {` — `background: #14161c;` → `var(--bg)`, `border: 1px solid #2c2f38;` → `1px solid var(--line-strong)`, `border-radius: 5px;` → `var(--r-sm)`, `color: #d7dae0;` → `var(--text)`, `padding: 0.3rem 0.45rem;` → `padding: 0 0.6rem; height: var(--control-h);`.
- [ ] **Step 2:** `.set-trait-list {` — `border: 1px solid #2c2f38;` → `1px solid var(--line)`, `border-radius: 5px;` → `var(--r-md)`, `padding: 0.35rem 0.5rem;` → `padding: var(--sp-1) var(--sp-2);`, `color: #d7dae0;` → `var(--text)`.
- [ ] **Step 3:** Current:

```css
.set-trait-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0 0.45rem;
  align-items: baseline;
  padding: 0.2rem 0;
  cursor: pointer;
}
.set-trait-label { font-size: 0.85rem; }
.set-trait-label em { color: #7fb3ff; font-style: normal; }
```

Replace with:

```css
.set-trait-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0 0.6rem;
  align-items: baseline;
  padding: 0.3rem 0.4rem;
  border-radius: var(--r-sm);
  cursor: pointer;
}
.set-trait-row:hover { background: var(--surface-2); }
.set-trait-label { font-size: var(--fs-md); }
.set-trait-label em { color: var(--accent-text); font-style: normal; }
```

- [ ] **Step 4:** `.set-trait-note { ... color: #e0a458; }` → `color: var(--warn-text);`; `.set-trait-row-greyed .set-trait-label { color: #9aa1ad; }` → `{ color: var(--text-3); }`; `.set-trait-heading { ... color: #9aa1ad; ...}` → `color: var(--text-3);` (keep `text-transform: none;`).
- [ ] **Step 5:** `#reroll-confirm-ok { background: #2b4a9e; border-color: #2b4a9e; color: #dbe4ff; }` → `{ background: var(--accent-muted); border-color: var(--accent-muted); color: #e3eaff; }`; its hover/focus `#3d6ef0` (×2) → `var(--accent-hover)`.

### Phase 3 verification

- [ ] Test suite: `tests 599`, one known failure. At risk: `ui.copyPrompts`
  (the `.reroll-btn,\n.copy-btn {` pair must still be adjacent with a
  `background:` inside; grep the file for `^\.copy-btn\s*\{` and confirm
  exactly one match), `ui.traitColumns` (`td:nth-child(3)` keeps
  `white-space: nowrap`; no `td:nth-child(2) {` anywhere).
- [ ] Open any NPC. The sheet has a soft drop shadow and rounder corners;
  the name is large and tight; "REGENERATE ART", "3D MODEL", "FILES",
  "PORTRAIT PROMPT" are small uppercase grey labels; trait rows have hairline
  separators and breathe; Re-roll/Set… still sit in two fixed gutters with
  no wrapping. Hover the × top-right: a grey square appears behind it.
- [ ] Click **Set…** on Outfit: rows highlight on hover; the filter box is a
  32px input. **Cancel**.
- [ ] Tick a card → **Delete Selected** → dialog title is 20px; **Cancel**.

**Rollback:** revert the phase commit.

---

## Phase 4 — Create NPC / Create Spaceship

Depends on Phase 0 and Tasks 1.2, 1.4.

### Task 4.1: Form frame and fields (C4)

**File:** `public/style.css`

- [ ] **Step 1:** `.create-form { background: #1c1f26; border: 1px solid #2c2f38; border-radius: 8px; padding: 1rem 1.25rem 1.25rem; max-width: 760px; }` → `.create-form { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); padding: var(--sp-5) var(--sp-6) var(--sp-6); max-width: 760px; }`.
- [ ] **Step 2:** `.form-grid { ... gap: 0.8rem; margin-bottom: 0.9rem; }` → `gap: var(--sp-4); margin-bottom: var(--sp-4);`.
- [ ] **Step 3:** `.form-field { ... gap: 0.3rem; font-size: 0.82rem; color: #b3bac6; }` → `gap: var(--sp-1); font-size: var(--fs-sm); color: var(--text-2);`.
- [ ] **Step 4:** In `.form-field input, .form-field select {` — `background: #262a33;` → `var(--surface-2)`, `border: 1px solid #363b47;` → `1px solid var(--line-strong)`, `color: #e6e6e6;` → `var(--text)`, `border-radius: 4px;` → `var(--r-sm)`, `font-size: 0.85rem;` → `var(--fs-md)`. Keep `height: 2rem;` and `margin-top: auto;` and the comment.
- [ ] **Step 5:** `.form-row { ... font-size: 0.85rem; margin-bottom: 0.6rem; }` → `font-size: var(--fs-md); margin-bottom: var(--sp-2);`.
- [ ] **Step 6:** Current:

```css
.create-actions { margin-top: 1rem; }
.create-actions button {
  background: #262a33;
  border: 1px solid #363b47;
  color: #e6e6e6;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.88rem;
}
```

Replace with:

```css
.create-actions { margin-top: var(--sp-4); }
.create-actions button {
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  color: var(--text);
  height: var(--control-h);
  padding: 0 1rem;
  border-radius: var(--r-md);
  cursor: pointer;
  font-size: var(--fs-md);
}
.create-actions button:hover:not(:disabled) { background: var(--surface-3); border-color: var(--line-hover); }
```

(The `#create-generate-btn, #create-ship-generate-btn` rule from Task 1.4
follows and still wins on specificity — leave it where it is.)

- [ ] **Step 7:** `.job-log {` — `background: #0e0f13;` → `var(--bg-sunken)`, `border: 1px solid #2c2f38;` → `1px solid var(--line)`, `border-radius: 6px;` → `var(--r-md)`, `font-size: 0.78rem;` → `var(--fs-sm)`, `color: #b3bac6;` → `var(--text-2)`. Add `line-height: 1.5;` after `font-size`.

### Task 4.2: "Trait overrides" heading (C3)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.create-form h3 { font-size: 0.9rem; color: #b3bac6; margin: 1.1rem 0 0.5rem; }
.create-form h3 .hint { font-weight: normal; }
```

Replace with:

```css
.create-form h3 {
  margin: var(--sp-5) 0 var(--sp-2);
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--track-caps);
  color: var(--text-3);
}
/* The hint is a sentence with an example in it; uppercasing it would shout
   "e.g. Role = a field medic". */
.create-form h3 .hint { font-weight: normal; text-transform: none; letter-spacing: 0; }
```

### Task 4.3: Presets strip and override rows

**File:** `public/style.css`

- [ ] **Step 1:** `.create-presets { margin-top: 1.2rem; border-top: 1px solid #363b47; padding-top: 0.9rem; }` → `{ margin-top: var(--sp-5); border-top: 1px solid var(--line); padding-top: var(--sp-4); }`.
  `.create-presets-row { ... gap: 0.6rem; font-size: 0.85rem; color: #b3bac6; }` → `gap: var(--sp-2); font-size: var(--fs-md); color: var(--text-2);`.
- [ ] **Step 2:** In `.create-presets-row select {` — `background: #262a33;` → `var(--surface-2)`, `border: 1px solid #363b47;` → `1px solid var(--line-strong)`, `color: #e6e6e6;` → `var(--text)`, `padding: 0.35rem 0.5rem;` → `padding: 0 0.5rem; height: var(--control-h);`, `border-radius: 4px;` → `var(--r-sm)`, `font-size: 0.85rem;` → `var(--fs-md)`.
- [ ] **Step 3:** Current:

```css
.create-presets-row button {
  background: #262a33;
  border: 1px solid #363b47;
  color: #e6e6e6;
  padding: 0.4rem 0.9rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
}
.create-presets-row button:disabled { opacity: 0.5; cursor: default; }
```

Replace with:

```css
.create-presets-row button {
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  color: var(--text);
  height: var(--control-h);
  padding: 0 0.9rem;
  border-radius: var(--r-md);
  cursor: pointer;
  font-size: var(--fs-md);
}
.create-presets-row button:hover:not(:disabled) { background: var(--surface-3); border-color: var(--line-hover); }
.create-presets-row button:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 4:** `.create-preset-status { margin: 0.5rem 0 0; font-size: 0.8rem; color: #9aa1ad; }` → `{ margin: var(--sp-2) 0 0; font-size: var(--fs-sm); color: var(--text-3); }`. `.create-preset-status.is-error { color: #e8a798; }` → `{ color: var(--danger-text); }`.
- [ ] **Step 5:** Override cell colours (values only; keep every selector and comment):
  `.filter-row .override-search {` — `background: #14161c;` → `var(--bg)`, `border: 1px solid #2c2f38;` → `1px solid var(--line)`, `color: #b3bac6;` → `var(--text-2)`, `border-radius: 4px;` → `var(--r-sm)`, `font-size: 0.78rem;` → `var(--fs-sm)`.
  `.override-clear {` — `background: #262a33;` → `var(--surface-2)`, `border: 1px solid #363b47;` → `1px solid var(--line-strong)`, `color: #b3bac6;` → `var(--text-2)`, `border-radius: 4px;` → `var(--r-sm)`, `padding: 0.3rem 0.6rem;` → `padding: 0 0.6rem; height: var(--control-h-sm);`, `font-size: 0.78rem;` → `var(--fs-sm)`. (Task 2.4 Step 3 gave the select beside it the same height.)
  `.override-clear:hover:not(:disabled) { background: #2f343f; color: #e6e6e6; }` → `{ background: var(--surface-3); color: var(--text); }`.
  `.override-full {` — `border-left: 2px solid #363b47;` → `2px solid var(--line-strong)`, `font-size: 0.78rem;` → `var(--fs-sm)`, `color: #9aa1ad;` → `var(--text-3)`.
  `.override-note { ... font-size: 0.75rem; ... color: #9aa1ad; }` → `font-size: var(--fs-xs); ... color: var(--text-3);`.
  `.trait-option-unavailable { color: #c2925a; ...}` — unchanged (deliberately dimmed; 5.2:1).

### Phase 4 verification

- [ ] Test suite: `tests 599`, one known failure. At risk: `ui.overrideRow`
  counts `className = 'override-clear'` (2) and `'override-search-note'` in
  app.js — untouched by this phase; `ui.shipCreate` reads index.html —
  untouched.
- [ ] Create NPC: "TRAIT OVERRIDES (force specific rolled traits…)" — label
  uppercase, hint sentence-case. Click **+ Add trait override**: the row
  appears with the grey search box above the select; click its ×. Every
  button in the Presets strip and the two action buttons are 32px tall;
  **Generate** is blue on both Create tabs and lightens on hover. Field
  inputs and selects share one height and top/bottom edges.

**Rollback:** revert the phase commit.

---

## Phase 5 — Trait Imports

Depends on Phase 0, Task 1.8, and Task 2.4 Step 2 (`#trait-search`).

### Task 5.1: Row badges (T2)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.trait-row .table-badge {
  position: static;
  background: #262a33;
  color: #7c8ba1;
  white-space: nowrap;
  flex-shrink: 0;
}
.trait-row .badge { position: static; }
.trait-row .date-badge { background: #262a33; color: #7c8ba1; }
.trait-bullet { flex: 1; font-size: 0.85rem; color: #d7dae0; }
```

Replace with:

```css
.trait-row .table-badge {
  position: static;
  background: var(--surface-2);
  color: #98a6bd;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  flex-shrink: 0;
}
.trait-row .badge { position: static; }
/* A date is a fact, not a status: plain quiet text, so the row carries one
   pill for the table, one for Imported, and nothing else shaped like one. */
.trait-row .date-badge {
  background: none;
  padding: 0;
  border-radius: 0;
  color: var(--text-4);
  font-size: var(--fs-xs);
  white-space: nowrap;
}
.trait-bullet { flex: 1; font-size: var(--fs-md); color: var(--text); }
```

### Task 5.2: Rows and the imported state (T1, T3)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.trait-list { display: flex; flex-direction: column; gap: 0.4rem; }
.trait-row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  background: #1c1f26;
  border: 1px solid #2c2f38;
  border-radius: 6px;
  padding: 0.5rem 0.7rem;
  cursor: pointer;
}
.trait-row.imported { opacity: 0.55; }
```

Replace with:

```css
.trait-list { display: flex; flex-direction: column; gap: var(--sp-2); }
.trait-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-3);
  cursor: pointer;
  transition: border-color var(--t-fast) var(--ease);
}
.trait-row:hover { border-color: var(--line-hover); }
/* Imported rows mute the bullet rather than the whole row: on a settled
   library every row is imported, and at 55% the tab read as disabled. The
   green pill already says why the text is grey. */
.trait-row.imported .trait-bullet { color: var(--text-3); }
.trait-row.imported .table-badge { opacity: 0.7; }
```

### Task 5.3: Filter bar (T4)

**File:** `public/style.css`

- [ ] **Step 1:** Delete this whole rule (its values now live in Task 2.4
  Step 2's `#filter-search, #trait-search`):

```css
#trait-search {
  background: #1c1f26;
  border: 1px solid #363b47;
  color: #e6e6e6;
  padding: 0.4rem 0.7rem;
  border-radius: 6px;
  font-size: 0.85rem;
  min-width: 240px;
}
```

- [ ] **Step 2:** Current:

```css
#trait-table-filter {
  background: #262a33;
  border: 1px solid #363b47;
  color: #e6e6e6;
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
  font-size: 0.82rem;
}
```

Replace with:

```css
#trait-table-filter {
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  color: var(--text);
  height: var(--control-h);
  padding: 0 0.5rem;
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
}
```

Keep the comment above it; change its last sentence to "The values below are
.sort-by select's, copied rather than invented; the search box shares
#filter-search's rule outright."

- [ ] **Step 3:** `.trait-detail-info pre {` — `background: #0e0f13;` → `var(--bg-sunken)`, `border: 1px solid #2c2f38;` → `1px solid var(--line)`, `border-radius: 6px;` → `var(--r-md)`, `font-size: 0.82rem;` → `var(--fs-sm)`; add `line-height: 1.5;`. `.trait-detail-info p { margin: 0; font-size: 0.85rem; color: #d7dae0; }` → `{ margin: 0; font-size: var(--fs-md); color: var(--text); }`. `.trait-detail-image { ... border: 1px solid #2c2f38; border-radius: 6px; ...}` → `border: 1px solid var(--line); border-radius: var(--r-lg);`.

### Phase 5 verification

- [ ] Test suite: `tests 599`, one known failure. At risk: `ui.traitStatusFilter` reads app.js only — untouched.
- [ ] Trait Imports: rows are full-brightness with grey bullet text, a small
  uppercase "BACKDROP" pill, a green "Imported" pill, and two plain grey
  dates; rows brighten their border on hover. The search box, table select,
  status select and sort select are all 32px. Open a row: headings "BULLET",
  "PLACEMENT HINT" etc. are uppercase eyebrows. Close it.

**Rollback:** revert the phase commit; if Phase 2 was also reverted, restore
the deleted `#trait-search` rule from Step 1.

---

## Phase 6 — Tables

Depends on Phase 0 and Task 1.2 Step 2.

### Task 6.1: Sticky heading list (TB1)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.table-heading-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 0 0 260px;
  min-width: 0;
}
```

Replace with:

```css
.table-heading-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  flex: 0 0 260px;
  min-width: 0;
  /* Stays put while the bullet panel scrolls: Outfit is 117 rows and the
     navigation was gone after twenty. .tables-layout's align-items:
     flex-start is what lets a flex child stick. The top offset is the
     topbar's height plus main's padding; a banner up at the same time
     overlaps it by the banner's height, which is tolerable for something
     that is dismissed. */
  position: sticky;
  top: calc(3.1rem + var(--sp-4));
  max-height: calc(100vh - 3.1rem - var(--sp-8));
  overflow-y: auto;
  padding-right: 2px;
}
```

### Task 6.2: Heading rows (TB2)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.table-heading-row {
  text-align: left;
  background: #1c1f26;
  border: 1px solid #363b47;
  color: #d7dae0;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
}
.table-heading-row.active { border-color: #7c8ba1; background: #262a33; color: #fff; }
```

Replace with:

```css
.table-heading-row {
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  color: var(--text);
  padding: 0.4rem 0.6rem;
  border-radius: var(--r-md);
  font-size: var(--fs-md);
  cursor: pointer;
}
.table-heading-row:hover:not(.active) { background: var(--surface-2); border-color: var(--line-hover); }
/* The selected table: a tinted fill, the accent border, and a 3px bar down
   the left inside the border so it reads as selected from the corner of the
   eye - the old grey-on-grey needed a second look. */
.table-heading-row.active {
  border-color: var(--accent-border);
  background: var(--selected-bg);
  color: #ffffff;
  box-shadow: inset 3px 0 0 var(--accent-border);
}
```

- [ ] **Step 2:** `.table-group-header { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: #7c8ba1; margin: 0.6rem 0 0.1rem; }` → `.table-group-header { font-size: var(--fs-xs); font-weight: 600; text-transform: uppercase; letter-spacing: var(--track-caps); color: var(--text-3); margin: var(--sp-3) 0 var(--sp-1); }`.

### Task 6.3: Bullet rows as a divided list (TB3)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.table-bullet-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: #1c1f26;
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  margin-bottom: 0.3rem;
  font-size: 0.85rem;
  color: #d7dae0;
}
```

Replace with:

```css
/* A divided list on the panel's own ground rather than a box per bullet: at
   117 rows plus a flag strip under each, the boxes were the loudest thing
   on the tab. The hover fill gives the row back when the pointer is on it. */
.table-bullet-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: none;
  border-radius: var(--r-sm);
  padding: 0.4rem 0.6rem;
  margin-bottom: 0;
  font-size: var(--fs-md);
  color: var(--text);
}
.table-bullet-row:hover { background: var(--surface); }
.table-bullet-list > .table-bullet-row:not(:first-child) { border-top: 1px solid var(--line); }
```

- [ ] **Step 2:** `.table-bullet-row .weight-input {` — `background: #262a33;` → `var(--surface-2)`, `border: 1px solid #363b47;` → `1px solid var(--line-strong)`, `color: #e6e6e6;` → `var(--text)`, `padding: 0.15rem 0.3rem;` → `padding: 0 0.3rem; height: var(--control-h-sm);`, `border-radius: 4px;` → `var(--r-sm)`, `font-size: 0.8rem;` → `var(--fs-sm)`.
- [ ] **Step 3:** `.chance-cell { ... color: #b8c0cc; font-size: 0.8rem; }` → `color: var(--text-2); font-size: var(--fs-sm);`. `.chance-cell.estimate { color: #7c8ba1; font-style: italic; }` → `{ color: #93a3bb; font-style: italic; }` (6.4:1 on surface).
- [ ] **Step 4:** In `.table-bullet-flags {` change `margin: -0.1rem 0 0.5rem 10rem;` → `margin: -0.1rem 0 0.4rem 10rem;` and `font-size: 0.72rem;` → `font-size: var(--fs-xs);`. **Keep the selector `.table-bullet-flags {` and the `.flag-toggle:has(input:checked)` and `.table-bullet-flags .flag-theme` rules** (`ui.tableFlags`). In `.table-bullet-flags .flag-toggle:has(input:checked) { color: #d7dae0; }` → `{ color: var(--text); }`. In `.table-bullet-flags .flag-theme {` — `color: #7c8ba1;` → `var(--text-3)`, `background: #262a33;` → `var(--surface-2)`, `border-radius: 3px;` → `var(--r-sm)`.

### Task 6.4: Preset rows (TB4)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.presets-panel { margin-top: 1.5rem; border-top: 1px solid #363b47; padding-top: 1rem; }
.preset-row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  background: #1c1f26;
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  margin-bottom: 0.3rem;
  font-size: 0.85rem;
}
.preset-name { flex: 1; }
.preset-date { color: #9aa1ad; font-size: 0.78rem; }
.preset-download {
  color: #8fb3ff;
  text-decoration: none;
  font-size: 0.82rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid #363b47;
  border-radius: 4px;
  background: #262a33;
}
.preset-download:hover, .preset-download:focus-visible { background: #2c2f38; border-color: #3d6ef0; }
.preset-download:visited { color: #8fb3ff; }
.preset-actions { display: flex; gap: 0.6rem; margin-top: 0.6rem; align-items: center; }
```

Replace with:

```css
.presets-panel { margin-top: var(--sp-8); border-top: 1px solid var(--line); padding-top: var(--sp-5); }
.preset-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  background: none;
  border-top: 1px solid var(--line);
  padding: var(--sp-2) 0.6rem;
  margin-bottom: 0;
  font-size: var(--fs-md);
}
.preset-row:first-child { border-top: 0; }
.preset-row:hover { background: var(--surface); }
.preset-name { flex: 1; }
.preset-date { color: var(--text-3); font-size: var(--fs-xs); }
.preset-download {
  color: var(--accent-text);
  text-decoration: none;
  font-size: var(--fs-sm);
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--surface-2);
}
.preset-download:hover, .preset-download:focus-visible { background: var(--surface-3); border-color: var(--accent-border); }
.preset-download:visited { color: var(--accent-text); }
/* Delete on a list row is the quiet form of the danger button: five solid
   red buttons down the list made every preset look like an emergency. It
   turns solid only under the pointer, which is when it is about to matter. */
.preset-row button.danger {
  height: auto;
  background: none;
  border-color: var(--line-strong);
  color: var(--danger-text);
  padding: 0.3rem 0.6rem;
  font-size: var(--fs-sm);
  font-weight: 500;
}
.preset-row button.danger:hover { background: var(--danger); border-color: var(--danger); color: #ffffff; }
.preset-actions { display: flex; gap: var(--sp-2); margin-top: var(--sp-3); align-items: center; }
```

- [ ] **Step 2:** `.preset-preview { margin-top: 0.8rem; background: #1c1f26; border-radius: 6px; padding: 0.7rem; }` → `{ margin-top: var(--sp-3); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); }`. `.preset-preview-not-found { color: #e0a458; }` → `{ color: var(--warn-text); }`. `.preset-preview-actions { display: flex; gap: 0.6rem; margin-top: 0.6rem; }` → `{ display: flex; gap: var(--sp-2); margin-top: var(--sp-3); }`.

### Task 6.5: Panel titles (TB7)

**File:** `public/style.css`

- [ ] **Step 1:** Insert directly after the `.table-bullet-panel { flex: 1; min-width: 0; }` line:

```css
/* The two section titles on this tab were the browser's default h2 (24px
   with 20px margins). One size below the sheet title, no top margin, so the
   table's name lines up with the first group header beside it. */
.table-bullet-panel h2,
.presets-panel h2 {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-xl);
  line-height: var(--lh-tight);
}
.preset-preview h3 { margin: 0 0 var(--sp-2); font-size: var(--fs-md); }
```

### Task 6.6: Kind select (TB6)

**File:** `public/style.css`

- [ ] **Step 1:** Current:

```css
.tables-kind-select select {
  background: #1c1f26;
  color: #e6e8ec;
  border: 1px solid #363b47;
  border-radius: 6px;
  padding: 0.3rem 0.5rem;
}
```

Replace with:

```css
.tables-kind-select select {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--line-strong);
  height: var(--control-h);
  border-radius: var(--r-sm);
  padding: 0 0.5rem;
  font-size: var(--fs-sm);
}
```

Also `.tables-kind-select { ... font-size: 0.9rem; margin-bottom: 0.75rem; }` → `font-size: var(--fs-md); margin-bottom: var(--sp-4);`.

### Phase 6 verification

- [ ] Test suite: `tests 599`, one known failure. At risk: `ui.tableFlags`
  (`.table-bullet-flags {`, `.flag-toggle:has(input:checked)`,
  `.table-bullet-flags .flag-theme` must all still match).
- [ ] Tables → click **Outfit (117)** in the KIT group (click only the
  heading; do not touch any checkbox or weight). The selected heading has a
  blue left bar and tinted fill; scroll the bullets to the bottom: the
  heading list stays on screen and scrolls independently. Bullet rows are
  separated by hairlines with no boxes; hovering one fills it. "Outfit"
  aligns with "IDENTITY" at the top. Scroll to **Presets**: rows are
  hairline-divided, Delete is an outlined red-text button that fills red on
  hover only, **Save current as preset…** matches **Import preset…**. The
  Kind select matches the Sort select on the Import tab.

**Rollback:** revert the phase commit.

---

## Phase 7 — Banners and remaining polish

Depends on Phase 0. Independent of Phases 2–6.

### Task 7.1: Banner dismiss and colours (B1)

**File:** `public/style.css`. The selector shapes `.banner {`,
`.banner[hidden] {`, `.banner-stack {`, `.banner.error` are test-pinned; only
values and the dismiss rule change.

- [ ] **Step 1:** In `.banner {` — keep `display: flex;` as the first line;
  change `gap: 0.75rem;` → `gap: var(--sp-3);`, `padding: 0.6rem 1.25rem;` →
  `padding: var(--sp-2) var(--sp-5);`, `background: #1d3324;` →
  `var(--banner-ok-bg)`, `border-bottom: 1px solid #2f6b45;` → `1px solid
  var(--banner-ok-line)`, `color: #d6f2e0;` → `var(--banner-ok-text)`,
  `font-size: 0.9rem;` → `var(--fs-md)`.
- [ ] **Step 2:** `.banner button {` — `background: #2f6b45;` → `var(--banner-ok-btn)`, `border: 1px solid #3f8a5b;` → `1px solid var(--banner-ok-btn-hover)`, `padding: 0.3rem 0.8rem;` → `padding: 0 0.8rem; height: var(--control-h-sm);`, `border-radius: 6px;` → `var(--r-md)`, `font-size: 0.85rem;` → `var(--fs-sm)`. `.banner button:hover { background: #3f8a5b; }` → `{ background: var(--banner-ok-btn-hover); }`.
- [ ] **Step 3:** Current:

```css
.banner .banner-dismiss {
  margin-left: auto;
  background: none;
  border: none;
  color: #9ec5ad;
  font-size: 1.2rem;
  line-height: 1;
  padding: 0 0.3rem;
}
.banner .banner-dismiss:hover { background: none; color: #eafff2; }
```

Replace with:

```css
.banner .banner-dismiss {
  margin-left: auto;
  width: 2rem;
  height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: var(--r-md);
  color: var(--banner-ok-dismiss);
  font-size: 1.2rem;
  line-height: 1;
  padding: 0;
}
.banner .banner-dismiss:hover { background: rgba(255, 255, 255, 0.08); color: #eafff2; }
```

- [ ] **Step 4:** In `.banner.error {` — `#33201d` → `var(--banner-err-bg)`, `#6b3a2f` → `var(--banner-err-line)`, `#f2ded6` → `var(--banner-err-text)`. `.banner.error button { background: #6b3a2f; border-color: #8a4f3f; color: #fff0ea; }` → `{ background: var(--banner-err-btn); border-color: var(--banner-err-btn-hover); color: #fff0ea; }`. `.banner.error button:hover { background: #8a4f3f; }` → `{ background: var(--banner-err-btn-hover); }`. `.banner.error .banner-dismiss { background: none; color: #c5a89e; }` → `{ background: none; color: var(--banner-err-dismiss); }`. `.banner.error .banner-dismiss:hover { background: none; color: #fff0ea; }` → `{ background: rgba(255, 255, 255, 0.08); color: #fff0ea; }`.

### Task 7.2: Remaining literals

**File:** `public/style.css`. Values only.

- [ ] `.image-zoom img { ... border-radius: 8px; background: #0e0f13; box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6); }` → `border-radius: var(--r-lg); background: var(--bg-sunken); box-shadow: var(--shadow-dialog);`.
- [ ] `#regen-seed-input {` — `background: #262a33;` → `var(--surface-2)`, `border: 1px solid #363b47;` → `1px solid var(--line-strong)`, `color: #e6e6e6;` → `var(--text)`, `border-radius: 4px;` → `var(--r-sm)`, `font-size: 0.82rem;` → `var(--fs-sm)`.
- [ ] `.regen-current-seed { color: #9aa1ad; flex: 1; }` → `{ color: var(--text-3); flex: 1; }`.
- [ ] `.copy-btn.copied { background: #2f7d4a; ...}` and `.copy-btn.copy-failed { background: #a53434; ...}` — unchanged (test-pinned shape; the colours hold 5:1 with white).
- [ ] `.model3d-turnarounds img { ... border: 1px solid #2c2f38; border-radius: 4px; ...}` → `border: 1px solid var(--line); border-radius: var(--r-sm);`.
- [ ] `#delete-confirm-list { ... font-size: 0.88rem; color: #e6e6e6; }` → `font-size: var(--fs-md); color: var(--text);`.
- [ ] `main { padding: 1rem 1.25rem 5rem; }` → `main { padding: var(--sp-4) var(--sp-5) 5rem; }`.
- [ ] `.filter-row {` — `background: #1c1f26;` → `var(--surface)`, `border: 1px solid #363b47;` → `1px solid var(--line-strong)`, `border-radius: 6px;` → `var(--r-md)`, `gap: 0.3rem;` → `gap: var(--sp-1);`.
- [ ] `.trait-option-unavailable { color: #c2925a; ...}` — unchanged.

### Phase 7 verification

- [ ] Test suite: `tests 599`, one known failure. At risk: `ui.batchBanner`
  and `ui.regenBanner` (`.banner {` must still start its block with
  `display: flex`; `.banner[hidden] { display: none; }` and `.banner-stack {`
  with `position: sticky` untouched; `.banner.error` present).
- [ ] With the browser devtools console (or the extension's JS tool) run:
  `document.getElementById('batch-banner-text').textContent='3 new NPCs finished generating.'; document.getElementById('batch-banner').hidden=false; document.getElementById('regen-banner-text').textContent='Regenerating X failed.'; document.getElementById('regen-banner').classList.add('error'); document.getElementById('regen-banner').hidden=false;`
  Both banners appear under the topbar, green above red; the × on each has
  a 32px hover square. Then run:
  `document.getElementById('batch-banner').hidden=true; document.getElementById('regen-banner').hidden=true; document.getElementById('regen-banner').classList.remove('error');`
  Both vanish (nothing stays painted).
- [ ] Hover an NPC portrait on its sheet: the zoom viewer's image has the
  same shadow as the sheet.

**Rollback:** revert the phase commit.

---

## Final checklist

- [ ] Phase 0 committed; suite green (599 tests, 1 known failure); focus rings visible.
- [ ] Phase 1 committed; ship cards readable; Delete Permanently red; no orphan checkbox in Set…; three native buttons styled; ship Generate blue; hints lighter; badges recoloured.
- [ ] Phase 2 committed; card hover/selected/imported states; toolbar controls all 32px; empty-state panel.
- [ ] Phase 3 committed; sheet shadow + radius; eyebrow headings; trait rows divided; close button hit area.
- [ ] Phase 4 committed; both Create forms at one control height; "TRAIT OVERRIDES" eyebrow.
- [ ] Phase 5 committed; Trait Imports rows full-brightness with green Imported pill and plain dates.
- [ ] Phase 6 committed; sticky heading list; active heading obvious; divided bullet list; quiet preset Delete.
- [ ] Phase 7 committed; banner dismiss hit area; no raw hex left in `style.css` except inside the `:root` block, `.copy-btn.copied`, `.copy-btn.copy-failed`, `.trait-option-unavailable`, `#2c2f38` disabled fills, and the `rgba()` overlays (`grep -o '#[0-9a-fA-F]\{6\}' public/style.css | wc -l` starts at 242 before Phase 0 and should end below 110 — the token block alone holds ~60).
- [ ] `public/index.html` untouched (`git diff --stat public/index.html` is empty).
- [ ] `git diff public/app.js` shows only the `render()` body template from Task 1.5.
- [ ] Full suite one last time from the branch tip; README test counts unchanged (no tests were added).
