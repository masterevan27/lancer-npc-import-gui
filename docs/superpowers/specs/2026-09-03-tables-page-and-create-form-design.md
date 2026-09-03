# Tables page, create form and keyboard navigation

Six changes to `public/` and `server.js`, plus one repair to a list that has
silently drifted out of sync with the generator.

Companion spec: `lancer-art-generator`'s
`docs/superpowers/specs/2026-09-03-token-fidelity-weapon-policy-and-trait-naming-design.md`.
**That spec ships first.** Two changes here depend on it: the unarmed checkbox
needs `--unarmed` to exist, and the trait-override list needs the
`Accent` → `Glow colour` rename to have landed.

Test suite baseline: 61 tests, all passing, via `node --test "test/*.test.js"`.
Note the glob — a bare `node --test test/` does not pick the suite up.

---

## 1. Toggling a checkbox shifts the whole bullet panel sideways

*Item 1.*

### Two causes, both real

**The column has no fixed width.** `.table-heading-list` (`public/style.css:464`)
sets `min-width: 220px` but no flex basis, so as a flex item its width is
content-driven. Each heading row's label carries a badge — `Stance (37)` — that
grows to `Stance (37, 1 disabled)` the moment a bullet is disabled. The widest
row sets the column width, so disabling one bullet widens the column and shoves
the bullet panel right. Re-enabling it shoves the panel back.

**The whole list is rebuilt to update one badge.** `toggleBullet`
(`public/app.js:1144`) calls `renderTableHeadingList()`, which clears
`innerHTML` and recreates every row — thirty-odd buttons — because one
badge changed. That discards focus and scroll position along with it.

### Change

Give `.table-heading-list` a fixed flex basis so its width cannot depend on its
contents, and let long headings wrap or ellipsize within it rather than widening
it. Then narrow `toggleBullet` to update the affected row's label text in place
instead of calling `renderTableHeadingList()`.

Either fix alone would stop the jump; both are worth doing, since the full
rebuild is also why the list loses its scroll position on a repo with thirty
tables.

---

## 2. The pronouns dropdown offers a value the generator deleted

*Item 2.*

`public/index.html:76` offers `<option value="they">they</option>`. The
generator's `Pronouns` table no longer contains a `they/them/their/person`
entry — it was removed deliberately, and the table carries a comment recording
why (the fourth-field noun "person" was not a strong enough signal and renders
came back androgynous). Selecting it sends `--pronouns they`, which now matches
nothing.

### Change

Rather than deleting the one stale option, **populate the select from the
`Pronouns` table on disk**. The server already reads `npcTablesPath` for the
Tables tab, so the subject pronouns are available; a new field on the existing
config/bootstrap response carries them, and the client builds the options from
it.

This is the difference between fixing the symptom and fixing the class: the
dropdown cannot drift out of sync with the generator again, and a pronoun set
added to the table later appears without a GUI change.

Server-side, reject a `pronouns` value that is not in the table, so a stale
client cannot resurrect the dead value.

---

## 3. No keyboard navigation between NPCs

*Item 3.*

The app registers no key handlers at all. Reviewing a run means clicking a card,
reading, clicking the close button, and clicking the next card.

### Change

With the NPC detail overlay open:

| Key | Action |
|---|---|
| `←` | previous NPC in `state.visibleItems` |
| `→` | next NPC in `state.visibleItems` |
| `Esc` | close the overlay |

`state.visibleItems` (`public/app.js:273`) is already the filtered-and-sorted
list the grid renders, so arrow navigation follows whatever order and filters
are on screen. Navigation **clamps** at both ends rather than wrapping — arrow
at the last NPC does nothing.

Guards:

- Ignore when focus is in an `input`, `textarea` or `select`, so typing in the
  regenerate-seed field is unaffected.
- `Esc` closes the innermost layer first. The delete-confirm overlay
  (`public/app.js:74`) and the image zoom (`public/app.js:515`) sit above the
  detail sheet and must close before it.
- Arrow keys do nothing while a nested overlay is open.

For consistency `Esc` also closes the trait detail overlay
(`public/app.js:1005`) and cancels the preset preview (`public/app.js:1330`).

### The hint

A dim line in the detail overlay header: `← → navigate · Esc close`. Muted
foreground, small type, no border or background — present for someone looking
for it, not competing with the NPC's name.

---

## 4. Documentation is editable as though it were a roll table

*Item 4.*

`lib/tableBullets.js` treats every `## Heading` as a table and every `- ` line
under it as a bullet. `npc-generator-tables.md` opens with
`## How the script reads this file`, whose documentation bullets explain the
`||` conventions — and they start with `- `, so they are served as eleven
editable entries with checkboxes and weight inputs.

The consequences are worse than clutter. Unchecking one wraps a paragraph of
the file's own documentation in `<!-- -->`. Setting a weight prepends `x2 ` to
prose.

### Change

The server stops serving non-roll sections and rejects writes to them. They
disappear from the heading list entirely.

Two mechanisms, belt and braces:

1. A named `NON_TABLE_SECTIONS` constant listing the prose sections — currently
   `How the script reads this file` and `Prompt templates`. A plain constant
   rather than a parsed rule, matching the precedent `OVERRIDE_TABLES` already
   sets in this file and for the same reason: the generator fixes these headings,
   so they are not free to grow.
2. Sections with zero bullets are dropped as well, so a prose section added
   later without bullets never appears.

`/api/table-bullets/toggle` and `/api/table-bullets/set-weight` both reject a
request naming an excluded section with a `400`, so a stale client cannot write
to one.

---

## 5. Generate NPCs without weapons

*Item 5. Front end for §3 of the art-generator spec.*

A checkbox in the create form's existing options row, alongside
`Generate portrait` / `Generate token`, wired to `--unarmed` in
`startCreateJob` (`server.js:477`).

Label and hint must state the tiering, because the flag deliberately does not
disarm everyone: **`Unarmed run`** with the hint *(military and criminal roles
keep their weapons)*. A checkbox promising more than it delivers is worse than
no checkbox.

---

## 6. Table headings are in file order with variants scattered

*Item 6.*

The heading list renders `tablesState.tables` in the order the server parsed
them, which is file order. Variant tables — `Hair (she) +`, `Hair (he) +`,
`Build (she)` — appear as top-level rows separated from the base table they
extend.

### Change

Five groups, in this order, each with a header row, and `(she)` / `(he)`
variants indented beneath the base table they extend:

| Group | Tables |
|---|---|
| Identity | Given names, Family names, Callsigns, Pronouns, Theme, Role, Faction |
| Body | Age, Build, Height, Skin |
| Appearance | Hair, Hair colour, Eyes, Feature, Demeanor |
| Kit | Outfit, Headgear, Weapon, Gear |
| Scene | Backdrop, Weather, Stance, Glow colour |

Note `Glow colour`, not `Accent` — see §7.

The ordering is a **pure function** taking the parsed table list and returning
grouped, ordered rows, so it is unit-testable without a DOM. Any table not named
in the groups falls into a trailing `Other` group rather than disappearing —
important, because a table added to the generator later must still be reachable
here.

---

## 7. `OVERRIDE_TABLES` has drifted from the generator

*Adjacent repair, made necessary by the rename.*

`OVERRIDE_TABLES` (`server.js:471`) whitelists the tables the trait-override
dropdown offers. It currently reads:

```
'Given names', 'Family names', 'Callsigns', 'Age', 'Build', 'Skin', 'Hair',
'Eyes', 'Feature', 'Demeanor', 'Role', 'Faction', 'Outfit', 'Headgear',
'Gear', 'Accent', 'Backdrop', 'Weather', 'Stance',
```

Three problems:

- `Accent` no longer exists — it is `Glow colour` after the art-generator spec's
  §6. Without this edit the dropdown offers a table the generator will reject.
- `Weapon` is missing. It was split out of `Gear` and cannot be overridden from
  the GUI.
- `Theme` is missing. It was added later and cannot be overridden either, which
  is the most useful override of the three — `--set-trait Theme=neosamurai`
  pins a whole group to one look.

Also missing from the list: `Hair colour` and `Height`. Both are in the
generator's `REQUIRED_TABLES`.

### Change

Derive the list rather than restate it. The generator's `REQUIRED_TABLES` is the
authority; the GUI's list is that minus `Pronouns`, which has its own field. A
test asserts the two agree, reading the generator's list from the configured
path, so the list cannot drift again.

If parsing the Python constant proves brittle, the fallback is to keep the
constant and add the test that compares it — the test is the part that matters,
not where the list lives.

---

## Tests

Extending the existing suite (61 passing):

- **section filtering** — `How the script reads this file` is absent from
  `/api/table-bullets`; a toggle or set-weight naming it returns `400`; a
  zero-bullet section is dropped.
- **ordering function** — groups appear in order; variants nest under their
  base; an unknown table lands in `Other` rather than vanishing.
- **pronouns** — the bootstrap response carries subject pronouns parsed from the
  tables file; a `pronouns` value absent from the table is rejected.
- **create args** — the unarmed checkbox produces `--unarmed`; it is absent when
  unchecked.
- **override list** — matches the generator's `REQUIRED_TABLES` minus
  `Pronouns`; explicitly covers `Weapon`, `Theme`, `Height`, `Hair colour` and
  `Glow colour`.

### Not covered by tests

Items 1 and 3 — the column reflow and the keyboard shortcuts — are DOM
behaviour, and this repo has no browser test harness. Adding one for two
changes is not proportionate. They get **written manual verification steps** in
the implementation plan instead, and the plan says so rather than implying the
suite covers them:

1. Open Tables, select a table with a long heading, toggle a checkbox, confirm
   the bullet panel does not move and the list does not scroll.
2. Open an NPC, arrow left and right through several, confirm the order matches
   the grid under an active filter and sort, confirm it stops at both ends.
3. With an NPC open, press `Esc` and confirm it closes; open the delete confirm
   and press `Esc`, confirm the confirm closes and the NPC stays open.
4. Focus the regenerate-seed input, press the arrow keys, confirm the NPC does
   not change.

## Sequencing

The art-generator spec ships first. Then:

1. §7 override list and §2 pronouns — both server-side, both about deriving
   from the generator rather than restating it.
2. §4 section filtering.
3. §6 ordering.
4. §1 layout and re-render.
5. §3 keyboard navigation and hint.
6. §5 unarmed checkbox.
7. README update.

## Out of scope

The five entries in `docs/known-issues.md` — the preset apply swallowing failed
writes, duplicate bullet text making the diff lie, non-atomic applies, and the
two untested behaviours. None is touched by this work and none is made worse by
it.
