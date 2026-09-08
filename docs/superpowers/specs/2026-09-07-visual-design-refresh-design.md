# Visual design refresh — design spec

Date: 2026-09-07
Status: proposed, not yet implemented
Companion plan: `docs/superpowers/plans/2026-09-07-visual-design-refresh.md`

Reviewed against the running app at <http://localhost:5089/> with 137 NPCs and
3 spaceships loaded, every tab visited, and the interaction-only states
exercised (card selection, filters, the detail sheet and its Set… picker, the
delete confirmation, both banners, keyboard focus, an emptied grid, a narrowed
body). Contrast figures below are WCAG 2.x relative-luminance ratios computed
from the hex values in `public/style.css`, not eyeballed.

## Current state

The app already has a real identity: a near-black blue-grey ground
(`#14161b`), one lifted surface (`#1c1f26`), a single cobalt accent
(`#3d6ef0`), and a small set of semantic colours that the stylesheet's own
comments defend one by one — green means imported, amber means pending, red
means failed, blue means new, purple means art out of date. The
comments-as-design-rationale habit is unusually good and this spec keeps to
it: nothing below replaces a colour whose meaning is already argued for; it
tunes values and fills gaps.

What works and must survive:

- The palette's *structure*: ground / surface / control-fill as three steps
  of the same hue, borders one step lighter than what they enclose, and a
  single accent. This is the sci-fi "console" look and it is right for a
  Lancer GM tool.
- The Import grid's card shape: square portrait, name, callsign, role, and an
  uppercase role-category pill. It scans well at ten across.
- The detail sheet's control gutter (Re-roll / Set…) — muted blue at rest,
  primary blue on hover — and the reasoning written above it.
- The regen panel's amber "something outstanding" button, the banner
  green/red split, the checkerboard behind 3D turnarounds, the flag strip's
  monospace labels with checked-emphasis, the override cell's quiet search
  box above the real select. All deliberate, all correct.

What undercuts it, in rough order of damage:

1. **Three native, unstyled buttons** sit in the middle of styled forms:
   `#add-override`, `#add-ship-override` (Create tabs) and `#preset-save-btn`
   (Tables). They render as Windows-grey `#f0f0f0` boxes with black text.
2. **The delete confirmation's "Delete Permanently" button is grey.**
   `.confirm-actions button` (line 500) is later in the file than
   `button.danger` (line 184) at equal specificity, so the most destructive
   control in the app is styled exactly like Cancel.
3. **The Set… picker shows a bare, unlabelled checkbox.**
   `#set-trait-release-row { display: block }` defeats the `hidden` attribute
   — the same cascade bug the banner comment at line 61 documents and fixed
   for `.banner`. The row is meant to be absent until a conflicting value is
   picked.
4. **Spaceship cards are broken.** The card template puts the ship's *Size*
   trait — a whole sentence — into `.role-category`, the uppercase pill, so
   every ship card ends in a five-line uppercase blob, and the hex-footprint
   badge (`bottom: 0.4rem`) paints over it.
5. **Contrast.** The hint grey `#6b7280` is 3.4:1 on the surface and 3.7:1
   on the ground — below AA for text at any size it is used at (12px). The
   white-on-green Imported badge is 3.5:1 and the white-on-amber pending
   badge 3.6:1. White on the primary blue is 4.48:1, a hair under 4.5.
6. **No state affordances on the grid.** Cards have no hover and no selected
   state beyond the native checkbox; the only feedback for "I ticked this" is
   the button count in the far corner.
7. **Rhythm drift.** One toolbar holds controls of 28.6, 29.8, 30.8 and
   32.6px height at 13.1, 13.3, 13.6 and 14.1px type. `#import-btn` sets no
   font-size at all. Headings use the browser's default `h2` (24px) in three
   places and three different `h3` treatments in the sheet.
8. **Tables tab ergonomics.** The heading list is not sticky, so twenty
   bullets into Outfit (117) the navigation is gone; the active heading is
   nearly indistinguishable from its neighbours; 117 individually-boxed rows
   plus flag strips is visually heavy; five full-strength red Delete buttons
   sit in the presets list.
9. **Trait Imports** dims every imported row to 55% opacity, which is all of
   them on a settled library, so the whole tab reads as disabled; and the
   "Imported" badge there has no fill because `.badge` is only ever styled
   under `.card`.

## Design system

All values below are to be declared once as custom properties on `:root` at
the top of `style.css` and referenced everywhere the plan names. The block is
ready to paste. Each token notes the hardcoded literal it replaces.

```css
:root {
  /* ---- Surfaces ---- */
  --bg:            #14161b;   /* body; was #14161b (and #14161c in two inputs) */
  --bg-sunken:     #0e0f13;   /* <pre>, image wells, job log; was #0e0f13 */
  --surface:       #1c1f26;   /* cards, panels, topbar, dialogs; was #1c1f26 */
  --surface-2:     #262a33;   /* control fills, pills; was #262a33 */
  --surface-3:     #2f343f;   /* hover on surface-2 controls; was #2f343f (.override-clear:hover) */
  --selected-bg:   #1e2637;   /* NEW: body tint of a selected card / active table row */

  /* ---- Lines ---- */
  --line:          #2c2f38;   /* quiet dividers, card borders; was #2c2f38 */
  --line-strong:   #363b47;   /* control borders; was #363b47 */
  --line-hover:    #454b5a;   /* NEW: card/control border on hover (1.9:1 vs surface) */

  /* ---- Text ---- */
  --text:          #e6e6e6;   /* 14.5:1 on bg, 13.4:1 on surface; was #e6e6e6 */
  --text-2:        #b3bac6;   /* 8.45:1 on surface; labels, secondary values; was #b3bac6 */
  --text-3:        #9aa1ad;   /* 6.34:1 on surface; muted; was #9aa1ad */
  --text-4:        #8a919e;   /* 5.20:1 on surface, 5.71:1 on bg; hints, footnotes.
                                 REPLACES #6b7280 (3.4:1, fails AA), #7f8794, #8b93a1 */
  --text-disabled: #7a8291;   /* 3.46:1 on #2c2f38; disabled labels only (AA-exempt); was #6b7280 */
  --text-on-accent: #ffffff;

  /* ---- Accent ---- */
  --accent:        #3566e6;   /* filled primary buttons; white text 5.01:1. was #3d6ef0 (4.48:1) */
  --accent-hover:  #3d6ef0;   /* hover of the above — the old primary, one step lighter */
  --accent-muted:  #2b4a9e;   /* Re-roll / Copy fill; #dbe4ff on it 6.43:1; was #2b4a9e */
  --accent-soft:   #33406b;   /* Set… fill; #dbe4ff on it 7.93:1; was #33406b */
  --accent-text:   #7fb3ff;   /* links, (current) marker, focus ring; 7.69:1 on surface; was #7fb3ff / #8fb3ff */
  --accent-ring:   rgba(127, 179, 255, 0.45);
  --accent-border: #3d6ef0;   /* active tab / category outline; was #3d6ef0 */

  /* ---- Status ---- */
  --ok:            #177a42;   /* Imported badge; white 5.39:1. was #1f9d55 (3.49:1, fails AA) */
  --warn:          #d18f2a;   /* pending badge + #regen-btn.accent fill. was #b7791f (white 3.64:1) */
  --on-warn:       #1a1200;   /* text on --warn, 6.79:1 */
  --warn-hover:    #e0a458;
  --warn-text:     #e0a458;   /* amber as text; 8.29:1 on bg, 7.56:1 on surface; was #e0a458 / #b7791f */
  --danger:        #c0392b;   /* white 5.44:1; was #c0392b */
  --danger-hover:  #a5311f;   /* was #a5311f */
  --danger-text:   #e8a798;   /* 8.18:1 on surface; was #e8a798 */
  --info:          #2b6cb0;   /* New badge; white 5.42:1; was #2b6cb0 */
  --info-border:   #3b7fc4;   /* is-new card border; was #3b7fc4 */
  --stale:         #7d5ba6;   /* Art-out-of-date badge; white 5.36:1; was #7d5ba6 */
  --neutral-badge: #384357;   /* hex footprint; white 9.96:1; was #384357 */

  /* ---- Banners (unchanged palette, named) ---- */
  --banner-ok-bg:      #1d3324;  --banner-ok-line:  #2f6b45;  --banner-ok-text: #d6f2e0;
  --banner-ok-btn:     #2f6b45;  --banner-ok-btn-hover: #3f8a5b;
  --banner-ok-dismiss: #b9dcc7;  /* was #9ec5ad (7.1:1) -> 9.1:1 */
  --banner-err-bg:     #33201d;  --banner-err-line: #6b3a2f;  --banner-err-text: #f2ded6;
  --banner-err-btn:    #6b3a2f;  --banner-err-btn-hover: #8a4f3f;
  --banner-err-dismiss: #d9b9ae; /* was #c5a89e -> 8.4:1 */

  /* ---- Radii ---- */
  --r-sm:   4px;    /* inputs, selects, small buttons; was 4px / 3px / 5px */
  --r-md:   6px;    /* buttons, chips, rows; was 6px / 5px */
  --r-lg:   8px;    /* cards, panels; was 8px */
  --r-xl:   12px;   /* dialogs / the detail sheet; was 10px */
  --r-pill: 999px;

  /* ---- Spacing (4px base) ---- */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;  --sp-4: 16px;
  --sp-5: 20px; --sp-6: 24px; --sp-8: 32px;

  /* ---- Type ---- */
  --fs-2xs:  0.68rem;    /* 10.9px — pills/badges only */
  --fs-xs:   0.75rem;    /* 12px   — eyebrows, footnotes, figcaptions */
  --fs-sm:   0.8125rem;  /* 13px   — dense rows, selects, chip controls */
  --fs-md:   0.875rem;   /* 14px   — body copy, buttons, table cells */
  --fs-lg:   1rem;       /* 16px   — form values (unused today; reserved) */
  --fs-xl:   1.25rem;    /* 20px   — section titles (Presets, table name, dialogs) */
  --fs-2xl:  1.5rem;     /* 24px   — the sheet title (NPC name) */
  --lh-tight: 1.25;
  --lh-body:  1.45;
  --track-caps: 0.08em;  /* letter-spacing for uppercase eyebrows */

  /* ---- Controls ---- */
  --control-h:    2rem;     /* 32px — every toolbar control, tab, category pill */
  --control-h-sm: 1.75rem;  /* 28px — controls inside rows (weight input, chip selects) */

  /* ---- Elevation ---- */
  --shadow-card:   0 6px 18px rgba(0, 0, 0, 0.45);
  --shadow-dialog: 0 24px 64px rgba(0, 0, 0, 0.6);   /* was on .image-zoom only */

  /* ---- Motion ---- */
  --t-fast: 120ms;
  --t-base: 180ms;
  --ease:   cubic-bezier(0.2, 0.7, 0.3, 1);

  /* ---- Focus ---- */
  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent-text);
}
```

### Type roles

| Role | Size | Weight | Line-height | Colour | Where |
|---|---|---|---|---|---|
| App title | 1.1rem | 700 | 1 | `--text` | `.topbar h1` (unchanged) |
| Sheet title | `--fs-2xl` | 700 | `--lh-tight` | `--text` | `#detail-name`, `#trait-detail-table` |
| Section title | `--fs-xl` | 700 | `--lh-tight` | `--text` | `#table-bullet-heading`, `.presets-panel h2`, `.confirm-dialog h2`, `.set-trait-dialog h2` |
| Eyebrow | `--fs-xs` | 600 | 1.2 | `--text-3`, uppercase, `--track-caps` | `.table-group-header` (already), `.regen-panel h3`, `#detail-prompts h3`, `.detail-files h3`, `.trait-detail-info h3`, `.create-form h3` |
| Body / control | `--fs-md` | 400 | `--lh-body` | `--text` | buttons, table cells, bullet rows |
| Dense row | `--fs-sm` | 400 | `--lh-body` | `--text` | selects, chips, weight input, radio labels |
| Card name | 0.92rem | 600 | `--lh-tight` | `--text` | `.card .name` (unchanged size) |
| Meta | 0.78rem | 400 | 1.35 | `--text-3` | `.card .sub`, `.card .role`, `.preset-date`, file names |
| Footnote | `--fs-xs` | 400 | 1.4 | `--text-4` | `.hint`, `.chance-note`, `.override-note`, `.detail-shortcuts`, `.detail-generated` |
| Pill | `--fs-2xs` | 400 | 1.3 | per status | `.badge`, `.role-category` |

### Borders, dividers, elevation

- Enclosures (cards, panels, chips): `1px solid var(--line)`. Controls:
  `1px solid var(--line-strong)`. Hover on either: `--line-hover`.
- Lists that used to be stacks of boxes (Tables bullets, presets) become rows
  separated by `1px solid var(--line)` with a `--surface` hover fill. A box per
  row is kept only where the row is a *card* (Import grid, Trait Imports).
- Elevation is used twice: `--shadow-card` on a hovered card, `--shadow-dialog`
  on `.detail` (every overlay dialog) and the image zoom. Nothing else floats.

### State affordances

| State | Treatment |
|---|---|
| Hover (button, secondary) | background `--surface-3`, border `--line-hover` |
| Hover (primary) | background `--accent-hover` |
| Hover (card / row) | border `--line-hover`; card also lifts 2px with `--shadow-card` |
| Focus-visible (any) | `box-shadow: var(--focus-ring)`, `outline: none`; inputs/selects instead take border `--accent` + `0 0 0 3px var(--accent-ring)` |
| Selected card | border + 1px ring in `--accent-text`, body tinted `--selected-bg` — deliberately lighter and glowing so it cannot be confused with `.card.is-new`'s 1px `--info-border` |
| Active table heading | background `--selected-bg`, border `--accent-border`, `inset 3px 0 0 var(--accent-border)` |
| Disabled | fill `#2c2f38`, text `--text-disabled`, `cursor: default` (unchanged pattern, new colour) |
| Imported card / row | image at 55% opacity, text `--text-3`, badge at full strength (replaces whole-card `opacity: .55`) |

### Motion

`background-color`, `border-color`, `color`, `box-shadow`, `transform` on
buttons, cards and rows transition over `--t-fast` (controls) or `--t-base`
(cards) with `--ease`. A `prefers-reduced-motion: reduce` block zeroes every
transition and animation. Nothing else animates.

## Findings by screen

Severity: **P1** broken / inaccessible / confusing · **P2** clearly worse than
it should be · **P3** polish. Each is *what's wrong → why it hurts → what it
should be*. Task numbers refer to the plan.

### Global (every tab)

- **G1 · P1 · Hint grey fails AA.** `.hint`, `.detail-generated`,
  `.detail-shortcuts`, `.override-search::placeholder`, `.model3d-files`,
  `.override-search-note`, `.chance-note`, `.table-bullet-flags` use `#6b7280`
  / `#7f8794` / `#8b93a1` at 12–13px: 3.4–5.3:1 → 12px text needs 4.5:1. All
  become `var(--text-4)` (`#8a919e`, 5.2:1 on surface). Task 1.6.
- **G2 · P1 · Status fills fail AA.** White on `#1f9d55` is 3.49:1 and on
  `#b7791f` 3.64:1 at 10.9px → Imported and pending badges, and the amber
  Regenerate button. Green becomes `--ok` (`#177a42`, 5.39:1); amber fills
  become `--warn` (`#d18f2a`) with dark `--on-warn` text (6.79:1). Task 1.7.
- **G3 · P1 · Three native buttons.** `#add-override`, `#add-ship-override`,
  `#preset-save-btn` have no rule → Windows-grey boxes in a dark form. They
  join the existing `#add-filter` / `.preset-import-label` rules. Task 1.2.
- **G4 · P2 · No focus treatment.** Keyboard focus falls back to the browser's
  white outline (or nothing after a mouse click on some controls). One
  `:focus-visible` rule with `--focus-ring`, and an input variant. Task 0.3.
- **G5 · P2 · Control heights and sizes drift.** In the Import toolbar alone:
  `#sort-select` 28.6px @ 13.1px, `#filter-search` 29.8 @ 13.6, `#add-filter`
  29.8 @ 13.6, `.tabs button` 30.8 @ 14.1, `#import-btn` 32.6 @ 13.3 (no
  font-size set). Every toolbar control, tab and category pill becomes
  `height: var(--control-h)` at `var(--fs-md)` (selects `--fs-sm`). Task 2.4.
- **G6 · P2 · Primary blue is 4.48:1 with white.** `#3d6ef0` misses AA by a
  hair on `#import-btn`, `#regen-btn`, `#create-generate-btn`, category
  `.active`. Filled primaries use `--accent` (`#3566e6`, 5.01:1); the old blue
  stays as the hover and as the outline colour. Task 0.1 / 2.4.
- **G7 · P3 · No transitions.** Hovers snap. One shared `transition` on
  buttons and rows; cards get a slightly longer one. Task 0.4.
- **G8 · P3 · `line-height: normal`.** Body copy, bullet rows and prompt text
  set solid. `body { line-height: 1.45 }`. Task 0.2.
- **G9 · P2 · Heading hierarchy is the browser default.** `#detail-name`,
  `#table-bullet-heading`, `.presets-panel h2` are all UA-default 24px/700
  with 19.9px margins; sub-headings in the sheet use three different h3
  styles (`.regen-panel h3` 0.85rem `#b3bac6`; `#detail-prompts h3` 0.82rem
  `#9aa1ad`; `.create-form h3` 0.9rem). Sheet title = `--fs-2xl`, section
  title = `--fs-xl`, every h3 = the eyebrow style already used by
  `.table-group-header`. Tasks 3.3, 4.2, 6.5.

### Import Generated Art

- **I1 · P1 · Spaceship cards are unreadable.** `render()` (app.js ~865)
  emits `item.traits.Size` — e.g. "two hundred metres of hull, one viewport
  row reading as pinpricks along the flank" — inside `.role-category`, an
  uppercase 0.68rem pill; it wraps to five lines and `.badge.hex-badge`
  (`bottom: 0.4rem`) paints across it. Ship type is also a sentence and sits
  unclamped. → Ship type and Size render as two clamped text lines
  (`.ship-line`, 2 lines max, full text in `title`); the hex badge moves to
  the image's top-left under the checkbox (`top: 1.9rem`). Task 1.5.
- **I2 · P2 · Cards have no hover or selected state.** The pointer is the
  only hint a card is clickable, and ticking a card changes only the 18px
  native box. → `.card:hover` lifts (border `--line-hover`, `--shadow-card`,
  `translateY(-2px)`); `.card:has(.check:checked)` takes a 1px `--accent-text`
  ring and `--selected-bg` body. Task 2.1.
- **I3 · P2 · Imported cards at `opacity: .55`.** The name drops to ≈5.3:1
  and the callsign/role to ≈3:1; the green badge fades with them. → dim the
  image only, mute text to `--text-3`, keep the badge. Task 2.2.
- **I4 · P3 · Body rhythm.** `.body` pads `.5rem .6rem .65rem`; `.role`
  `margin-top: .2rem`; pill `.3rem`. → 8/10/10px padding, 2px under the name,
  6px above role, 8px above the pill; `line-height` 1.25 on the name.
  Task 2.3.
- **I5 · P3 · Empty state is a bare sentence.** "No items match the current
  filters." sits at the left margin in muted grey. → centred, dashed-border
  panel, max-width 32rem. Task 2.6.
- **I6 · P3 · Checkbox disappears on light art.** → `accent-color` +
  `drop-shadow`. Task 2.1.
- **I7 · P3 · Category pill hover / tab hover missing.** Task 2.5.

### NPC detail sheet and dialogs

- **D1 · P1 · "Delete Permanently" is grey.** `.confirm-actions button`
  wins over `button.danger` on source order. → an explicit
  `.confirm-actions button.danger` rule. Task 1.3.
- **D2 · P1 · Orphan checkbox in the Set… picker.** `#set-trait-release-row
  { display: block }` beats `[hidden]`. → `#set-trait-release-row[hidden]
  { display: none }`, mirroring `.banner[hidden]`. Task 1.1.
- **D3 · P2 · Trait table is a wall.** 25 rows at `padding: .15rem`, no
  separators, 0.85rem. → `.3rem` vertical padding, `1px solid var(--line)`
  between rows, `--fs-md`. The column structure and the nowrap rules the
  tests pin are untouched. Task 3.4.
- **D4 · P2 · Sub-headings have no hierarchy** (G9). "Regenerate art",
  "3D model", "Files", "Portrait prompt" become the eyebrow style. Task 3.3.
- **D5 · P3 · Close button is a glyph.** `.detail-close` is a 1.4rem × with
  no hit area and no hover. → 32px square, `--r-md`, `--surface-2` hover.
  Task 3.2.
- **D6 · P3 · The sheet does not float.** Same 1px border as a card, no
  shadow, `10px` radius. → `--shadow-dialog`, `--r-xl`, `--line-strong`
  border, `--sp-6` padding. Task 3.1.
- **D7 · P3 · Picker rows.** `.set-trait-row` at `.2rem` padding with no
  hover. → `.3rem .4rem`, `--r-sm`, `--surface-2` hover; filter input takes
  `--bg` not `#14161c`. Task 3.5.

### Create NPC / Create Spaceship

- **C1 · P1 · `+ Add trait override` is native** (G3). Task 1.2.
- **C2 · P2 · Ship Generate is grey.** Only `#create-generate-btn` gets the
  primary fill; `#create-ship-generate-btn` is `#262a33` at weight 400. → both
  in one rule. Task 1.4.
- **C3 · P3 · "Trait overrides" heading** → eyebrow, with the inline
  `.hint` kept sentence-case. Task 4.2.
- **C4 · P3 · Form grid gap** `.8rem` → `--sp-4`; label colour `--text-2`
  (already `#b3bac6`), field height stays `2rem` (= `--control-h`). Task 4.1.

### Trait Imports

- **T1 · P2 · The whole list reads as disabled.** Every imported row at
  55% (all 289 on this library). → mute the bullet text only. Task 5.2.
- **T2 · P2 · "Imported" badge has no fill.** `renderTraits()` sets
  `className = 'badge'`; only `.card .badge` is styled. → a base `.badge`
  rule (`--ok` fill, pill radius, `--fs-2xs`); `.date-badge` stops being a
  pill and becomes plain `--text-4` text so the row has one pill (table),
  one status, and quiet dates. Task 1.8 / 5.1.
- **T3 · P3 · No row hover.** → border `--line-hover`. Task 5.2.
- **T4 · P3 · Two copies of the search/select rules.** `#trait-search` and
  `#trait-table-filter` restate `#filter-search` and `.sort-by select`. →
  join the selectors. Task 5.3.

### Tables

- **TB1 · P2 · Heading list scrolls away.** → `position: sticky; top:
  calc(3.1rem + var(--sp-4)); max-height: calc(100vh - 3.1rem - var(--sp-8));
  overflow-y: auto`. (`.tables-layout` already has `align-items: flex-start`,
  which sticky needs.) Task 6.1.
- **TB2 · P2 · Active heading is invisible.** `border-color: #7c8ba1;
  background: #262a33` vs `#363b47` / `#1c1f26` at rest. → `--selected-bg`
  fill, `--accent-border` border, 3px inset accent bar; hover for the rest.
  Task 6.2.
- **TB3 · P2 · 117 boxes.** Each `.table-bullet-row` is a filled, rounded
  box with its own flag strip below → rows become a divided list on the panel
  ground with a `--surface` hover. Task 6.3.
- **TB4 · P2 · Five red Delete buttons.** `.preset-row` reuses the toolbar's
  full `button.danger`. → quiet destructive: transparent, `--line-strong`
  border, `--danger-text` label, fills red on hover. Task 6.4.
- **TB5 · P1 · "Save current as preset…" is native** (G3). Task 1.2.
- **TB6 · P3 · Kind select differs from every other select** (`#1c1f26`,
  6px). → same values as `.sort-by select`. Task 6.6.
- **TB7 · P3 · `h2`s at UA default** (G9). Task 6.5.

### Banners

- **B1 · P3 · Dismiss × hit target ≈20px.** → 32px square with a hover fill;
  text colours lifted to `--banner-*-dismiss`. Task 7.1.
- Palette, stacking, sticky offset and the `display:flex` / `[hidden]` guard
  are correct and pinned by tests — unchanged.

### Responsive

Checked by capping `body` at 840px (the docked panel in this browser stops
`resize_window` from changing the viewport). The Import toolbar wraps
cleanly, the Trait Imports filter bar wraps to two lines, cards reflow to four
across. No breakage worth a task; the only media query (700px, flag-strip
indent) stays. This is a desktop tool.

## Non-goals / do not touch

- No CSS framework, component library, icon font, web font, or build step.
  The app is offline-first and stays three static files.
- No light theme.
- No markup changes to `.banner-stack` / `#batch-banner` / `#regen-banner`
  (`ui.batchBanner`, `ui.regenBanner` pin the exact tags) or to the `<nav
  class="tabs" id="tabs">` and `#tab-shipcreate` section.
- No changes to the trait table's four-column structure, the
  `td.reroll-cell, td.set-cell` nowrap rule, `td:nth-child(3)`, or
  `td:last-child { width: 100%; overflow-wrap }` (`ui.traitColumns`).
- The shared `.set-trait-btn, .reroll-btn, .copy-btn` rule keeps `.reroll-btn,`
  immediately followed by `.copy-btn {` and keeps a `background:` inside; no
  second `.copy-btn {` rule is ever added (`ui.copyPrompts`). Values may
  change, the shape may not.
- `.card .badge.new { background; left }` and `.card.is-new { border-color }`
  stay as rules with those properties (`ui.newBadge`); `.regen-stale` never
  gains a `display:` (`ui.detailRepaint`); `.table-bullet-flags`,
  `.flag-toggle:has(input:checked)` and `.table-bullet-flags .flag-theme`
  stay (`ui.tableFlags`).
- In `app.js`, the string literals `'badge new'`, `class="reroll-btn"
  data-trait=`, `class="set-trait-btn" data-trait=`, `<span
  class="reroll-unavailable" title="`, `className = 'override-clear'` (×2),
  `className = 'override-search-note'`, `classList.toggle('accent'`, and
  `event.target.closest('.reroll-btn')` are test-pinned; the plan touches
  none of them.
- The `#status` line stays a message channel; it does not gain a "N
  selected" counter (it would overwrite "Import complete." / "Deleted…").
- The colour *meanings* (green imported, amber pending, red failed, blue new,
  purple stale, grey footprint) and the arguments for them in the CSS
  comments. Values change; the comments' claims stay true.
- Anything in `server.js` or `lib/`.
