# Known Issues

Parked technical debt in this tool, recorded because this repo has no ticket
system and these would otherwise only exist in the head of whoever last touched
the code. Everything here is currently resolved; the entries are kept with
their original wording struck through rather than deleted, because the reason a
thing was done is the part that goes missing first, and a fixed issue is the
cheapest place to read it.

These were carried over from
`docs/superpowers/plans/2026-09-01-tables-and-presets-refinements.md`, which was
deleted from the `foundryvtt-to-sillytavern-nhp-uplink` repo once its work
shipped (branch `tables-presets-refinements`, merged to
`main` at `eb06a0a`). Read that commit and its parents for the surrounding
context if any of these become worth fixing.

One drift this list never carried is already fixed, so a future reader does
not go looking for it: the override dropdown's table list used to be a
hand-maintained constant in `server.js` that had silently fallen out of sync
with `generate-npc.py`'s `REQUIRED_TABLES` (missing `Weapon`, `Theme`,
`Height` and `Hair colour`, and still naming the renamed `Glow colour` table
`Accent`). It is now derived from `REQUIRED_TABLES` directly — see
`lib/overrideTables.js` — so the two cannot drift again.

## Tables & Presets (Import GUI)

Nothing open. Every item this file carried has been fixed; they are kept below
rather than deleted, because the reason a thing was done is the part that goes
missing first.

One limitation survives its fix and is recorded here as a known shape of the
code rather than as a bug to chase:

- **A bullet text repeated inside one table is editable only in its first
  copy.** `toggleBulletInText`, `setBulletWeightInText` and the newer
  `applyEditsInText` all resolve a bullet to its *first* matching line under a
  heading, and the preset format keys a table's entries by text, so later
  copies of an identical text are not addressable at all. The diff no longer
  *lies* about this (see Resolved 2), but nor can it act on them. Making a
  duplicate individually editable needs an identity other than its text -
  a line index, or a stable id - which is a larger change than any of these
  were, and worth doing only if duplicate bullets ever turn out to be
  deliberate rather than accidental.

## Resolved

1. ~~**`/api/presets/apply` swallows failed writes.**~~ Fixed. The route's
   write loops discarded the `{ok:false}` returned by `toggleBulletOnDisk` /
   `setBulletWeightOnDisk`, so a rejected write never reached the response and
   the caller was told the apply succeeded. The loops are gone: the route now
   builds one edit list and hands it to `applyEditsOnDisk`, which returns the
   rejected edits with their reasons as `failed`. The response carries that
   list, and the Tables tab reports it rather than closing the preview as
   though everything landed.

2. ~~**Duplicate bullet text within one table makes the diff lie.**~~ Fixed.
   `diffPresetAgainstTables` counted every matching bullet while
   `toggleBulletInText` only ever changed the first, so a preview could promise
   more changes than the apply performed - and the second write then found the
   first line already in the requested state and returned early having changed
   nothing. The diff now emits one entry per unique bullet text, taking the
   first copy, which is exactly what the writers do. The underlying
   addressability limit is unchanged and is recorded above.

3. ~~**Apply is O(n) full-file rewrites.**~~ Fixed. Every changed bullet used
   to trigger its own read + parse + write of `npc-generator-tables.md`, so a
   40-bullet preset was 80 full rewrites and the file was observably
   half-applied in between. `applyEditsInText` indexes the file's bullet lines
   in a single pass and resolves every edit against that index;
   `applyEditsOnDisk` wraps it in one read and one write, and skips the write
   entirely when nothing applied.

4. ~~**No test covers the preset format break.**~~ Fixed. The behaviour was
   correct and merely unverified - all three assertions passed the moment they
   were written. `test/api.presets.test.js` now covers an old
   `{ disabled: {...} }` preset getting a `400` from both `/api/presets/import`
   and `/api/presets/apply` (and changing nothing on disk on the way out), and
   `listPresets` reporting `count: 0` for one rather than erroring.

5. ~~**The preset row's `(N)` count changed meaning without changing its
   label.**~~ Fixed. It reads `(N selected)` now. The number used to count
   *disabled* bullets and now counts *selected* ones - the opposite reading -
   and a bare `(N)` gave no way to tell which.

6. ~~**The weight input fires a `POST` per spinner click.**~~ Fixed. The
   handler was already on `change` rather than `input`, but a number input
   fires `change` on every spinner click and every arrow keypress, not only on
   blur, so holding an arrow key still sent one full read-parse-write per
   repeat. Weight writes are now debounced per bullet
   (`WEIGHT_DEBOUNCE_MS`, 400ms), and only the last value in a burst is sent -
   the intermediate ones are values the user scrolled past.

- ~~The design spec documented the superseded `disabled`-only preset format with
  nothing marking it superseded.~~ Fixed: the spec now carries a "Superseded in
  part" banner describing the full selected-set format that replaced it.
