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

Two limitations survive their fixes and are recorded here as known shapes of
the code rather than as bugs to chase:

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
- A preset saved before a group table existed cannot express "this group
  off": apply leaves the group's `=> Name` reference as it is. Re-save the
  preset once the group exists and it records the group like any table.

## Kinds (NPCs and spaceships)

Nothing open here either. These two are traps rather than bugs — the code is
right today and both of these are cheap to get wrong the next time a kind is
added, which is the only reason they are written down.

- **Both tables files carry a `## Backdrop`, so a table name alone does not
  identify a table.** `npc-generator-tables.md` and
  `spaceship-generator-tables.md` share that heading (and `Weather`, `Glow
  colour`, `Glow placement`, `Theme`, `Faction` and `Weapon` besides), which is
  why table identity is `(kind, table)` on the wire: every route that names a
  table also carries a kind, and resolves the file through `kind.tables` off
  the registry rather than through a constant. It is also why the two
  staged-imports directories are **siblings** rather than one nested inside the
  other — `listStagedFiles` reads `*.json` at the top level of the directory it
  is given, so a ship directory under the NPC one would sweep every ship run
  into the NPC listing, and `/api/trait-candidates/import` would then append a
  ship's Backdrop bullet to the NPC file and report success. `lib/paths.js`
  derives `staged-imports-spaceship` beside `staged-imports` for exactly that
  reason; do not "tidy" it into a subdirectory.

- **`SEEN_VERSION` must never be bumped as part of adding a kind.**
  `ensureSeenLoaded` treats a version mismatch as "this store is from a
  different world" and reseeds the *entire* library as seen. Adding a kind
  changes what is in the library, which makes bumping the version look like the
  careful thing to do — and it would silently mark every existing NPC and every
  ship already looked at, wiping the New badge off the whole grid with no way
  to get it back. A new kind needs no bump: unseen is the default for an id the
  store has never recorded, so a ship is new the first time it appears without
  anything being versioned at all.

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

7. **A preset can collide on two bullets whose prose is identical and whose
   flags differ.** Open, and thought to be unreachable today. Now that the
   Tables tab can edit flags, presets match a bullet on its text *without* the
   `|| flags` segment - an exact match would break the moment a flag was
   edited, because a preset stores the full text and apply is a whitelist, so
   flagging a bullet would have renamed it out from under every saved preset
   and then switched it off.

   The cost is that two bullets in one table reading the same prose but
   carrying different flags are one key to a preset, and the first one wins.
   The same first-wins rule the writers in `lib/tableBullets.js` already apply
   to a table carrying identical text twice, so this widens an existing
   limitation rather than introducing a new kind of one - but it widens it,
   which is worth writing down. No live table has such a pair. Fixing it
   properly means giving a bullet an id that is not its text.

- ~~The design spec documented the superseded `disabled`-only preset format with
  nothing marking it superseded.~~ Fixed: the spec now carries a "Superseded in
  part" banner describing the full selected-set format that replaced it.
