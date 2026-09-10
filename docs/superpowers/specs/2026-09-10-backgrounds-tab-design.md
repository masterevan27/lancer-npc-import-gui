# Backgrounds tab in `lancer-npc-import-gui` — implementation design

**Repo A** (this design's target) = the Import GUI, worktree `.claude/worktrees/backgrounds-tab`, branched from `11b077a`
**Repo B** (generator) = `G:/GIT-REPOS/lancer-art-generator`, branch `main` at `3bfb5da`

Bare `server.js:N` / `public/app.js:N` / `lib/*.js:N` refs are Repo A; bare
`generate-art.py:N` / `animate-portrait.py:N` / `prompts/*` refs are Repo B.
Verified against both working trees on 2026-09-10.

---

## 0. What already exists in both repos

Five facts the design turns on. Each was read, not assumed.

1. **Repo B has two background code paths, and they are separate scripts.**
   `generate-art.py` renders stills from a markdown prompt catalogue through
   ComfyUI; `animate-portrait.py --background` (`animate-portrait.py:8-10`,
   `:421`) turns one still into a looping `.webp` sized for a SillyTavern chat
   background. Neither knows about the other, and neither knows about NPCs.

2. **`prompts/scene-background-art-prompts.md` is on `main`** with three
   entries. Branch `worktree-lancer-backgrounds` adds four more plus a second
   file, `prompts/city-background-art-prompts.md`, with four. So the catalogue
   set is not fixed and must not be hard-coded to one filename.

3. **`generate-art.py --list` is offline.** It returns at `generate-art.py:876`,
   before `find_server` at `:952`. Enumerating a catalogue therefore costs one
   Python start and no ComfyUI.

4. **`--download-to` preserves ComfyUI's subfolder**, it does not flatten:
   `download()` writes `dest_dir / image["subfolder"] / image["filename"]`
   (`generate-art.py:590`), and the subfolder comes from
   `filename_prefix = output_prefix + "/" + entry.prefix` (`:425`). Stills
   therefore land nested, and the gallery must walk the tree.

5. **The GUI has a declarative availability seam already.** `data-kind` nodes in
   `public/index.html` are removed by `applyKindAvailability`
   (`public/app.js:589`) for any kind absent from `/api/categories`' `kinds`
   (`server.js:2479`). It degrades to today's UI on a missing field, a
   non-array, or an empty list.

**The snag.** Every route that runs a script in Repo A starts from
`findItem(id)` against the manifest. A background has no manifest entry, no
traits, no token and no Foundry import.

---

## 1. Structure — the decision

### Decision

**The folder is the source of truth. Backgrounds are a *feature*, not a *kind*.**

A background is a file under a configured `backgroundsDir`, identified by its
path relative to that directory. What the GUI remembers about it lives in JSON
sidecars beside it. There is no manifest, no id allocation and nothing to
reconcile: a file deleted in Explorer is gone from the tab on the next refresh,
and a file dropped in by hand appears.

### Justification against the alternative

Making `background` a third entry in `lib/kinds.js` would buy the create-job
plumbing, the presets machinery and the New badge. It would cost more than it
buys, for three reasons that are properties of the code and not of taste:

- The kind contract is `script`, `tables`, `presetsDir`, `createPresetsDir`,
  `stagedImportsDir`, `stagedRefsDir`, `foundrySubdir`, `foundryActorType` and a
  nine-flag `supports` set (`lib/kinds.js:42-62`). A background has a script and
  a tables file. The other six would be dead keys and seven of the nine flags
  would be `false`.
- `buildRegenArgs` (`lib/kinds.js:27`) emits `--regen-manifest`, `--regen-id`
  and `--new-seed`. `generate-art.py` accepts none of the three. Regeneration
  for a background is "render it again", which is the same call as rendering it
  the first time.
- `entriesSnapshot` (`server.js:1568`) and the `producedIds` bookkeeping built
  on it key on manifest entry ids. Stills have no ids to produce.

Sidecars are not a new invention here either. `lib/animate.js` already keeps the
animated-portrait record in a JSON file beside the `.webp` rather than in the
manifest, for a reason its header states: the generator rewrites the whole
manifest at the end of a run and would lose anything written there mid-run. A
background has no manifest to be evicted from, which makes the same choice
strictly safer.

### The feature gate

`background` is not a kind, so it cannot ride `kinds`. `/api/categories` grows a
sibling `features` array, and `index.html` grows a `data-feature` attribute
gated by an `applyFeatureAvailability` written to the same three degradation
rules as `applyKindAvailability` (`public/app.js:589`): a missing field, a
non-array or an empty list all mean "change nothing".

`features` contains `'backgrounds'` when all three of these hold, checked per
request the way `available()` (`lib/kinds.js:175`) is and for the same reason —
dropping a script into place should not need a server restart to be noticed:

- `generateArtScript` exists on disk
- `animatePortraitScript` exists on disk
- at least one background catalogue is found (§2)

---

## 2. Config and paths

### New config keys

| Key | Default when unset |
|---|---|
| `generateArtScript` | `generate-art.py` beside `generateNpcScript` |
| `backgroundsDir` | `output/backgrounds` under the generator root |
| `backgroundPromptsDir` | the directory holding `npcTablesPath` |
| `backgroundTablesPath` | `scene-and-spaceship-tables.md` beside `npcTablesPath` |

All four go in `derivePaths` (`lib/paths.js:24`) and follow the file's standing
rule: a key set in `config.json` wins, and later paths follow the override
rather than the default layout. `generateArtScript` derives from
`generateNpcScript`, not from the manifest, exactly as `generate3dScript` and
`animatePortraitScript` do (`lib/paths.js:30`, `:35`) — moving the generator
moves all four scripts together.

`config.example.json` gains all four keys, empty.

### Catalogue discovery

Catalogues are every file in `backgroundPromptsDir` matching
`*-background-art-prompts.md`, sorted by name. A glob rather than a list because
fact 2 above says the set grows: the four extra scene entries and the city set
appear the moment `worktree-lancer-backgrounds` merges, with no config edit and
no GUI release.

### The motion-prompt table

Motion prompts are the enabled bullets of the `Background Animation` table in
`backgroundTablesPath`, read with the existing `tableBullets.readTables`
(`lib/tableBullets.js:268`).

This needs a note, because `lib/paths.js:70-77` records that
`scene-and-spaceship-tables.md` "has never been parseable": its bullets are
hard-wrapped at ~72 columns and the bullet regex silently truncates each at its
first physical line. That is true of the `Backdrop` and `Spaceships` tables in
that file. It is **not** true of `Background Animation`
(`prompts/scene-and-spaceship-tables.md:183`), whose bullets are one physical
line each — deliberately, per the authoring comment just above them: "keep each
bullet to one line - the parser reads the first line of a bullet and nothing
else". `readTables` returns tables per heading, so reading one good table out of
a file with two bad ones is safe. The design reads only `Background Animation`
and never offers the other two.

---

## 3. `lib/backgrounds.js` — the pure module

Same split as `lib/animate.js` and `lib/model3d.js`, for the same reason: no
filesystem writes, no `spawn`, so both argv builders and the whole catalogue and
sidecar story are asserted without a Python interpreter, a ComfyUI server, or
the minutes a Wan render takes.

### `parseListOutput(text)`

`generate-art.py --list` prints one line per entry as
`"  %-58s %-20s line %-5d (%d chars)"` (`generate-art.py:878`). Parsed with

```
/^\s*(\S+)\s+(.*?)\s*line\s+(\d+)\s+\((\d+) chars\)\s*$/
```

returning `{ prefix, role, line, chars }` per matching line and ignoring
everything else, so an unexpected banner line cannot become a phantom entry.

The first column is safe to take as `\S+` because a prefix is a `/`-joined run
of `_slug` output, and `_slug` (`generate-art.py:96-100`) replaces every
non-alphanumeric run with `-`. A prefix can therefore never contain a space,
which is what keeps the columns unambiguous when `role` is empty.

**Why shell out at all, rather than parse the markdown in JS.** The picker must
offer exactly the entries `--filter` can select. `generate-art.py`'s parser
(`:111-201`) skips headings matching `SKIP_HEADINGS`, drops blocks under
`MIN_PROMPT_CHARS`, accepts both fenced and blockquoted prompts, and mints
`Alt2` labels for a repeated heading. A JS reimplementation would be a second
copy of that judgment, free to drift; the city catalogue's `## Render and
animate` section is exactly the kind of prose-with-a-code-block the two parsers
could disagree about. `--list` is the script's own answer, and fact 3 says it is
cheap.

### `attachHeadings(entries, fileText)`

`--list` gives a slug and a line number, not a title. This walks the markdown
once and, for each entry, attaches the nearest heading at or above its `line`
plus the first 200 characters of the prompt block, so the picker shows "Pilot's
Quarters — Planetrise Through the Porthole" rather than
`Pilots-Quarters-Planetrise-Through-the-Porthole`. Display only. Nothing
downstream depends on it, so a heading this misses degrades to showing the slug.

### `renderArgs(script, opts)`

```
[script,
 '--prompts', catalogue,
 '--filter', '^' + escapeRegExp(prefix) + '$',
 '--variants', String(variants),
 '--width', String(width), '--height', String(height),
 '--output-prefix', 'LancerBackgrounds',
 '--download-to', backgroundsDir,
 '--manifest', path.join(backgroundsDir, '.backgrounds-manifest.json'),
 ...(seed === null ? [] : ['--seed', String(seed)])]
```

Three things are load-bearing:

- **The filter is anchored and escaped.** `--filter` is compiled as a
  case-insensitive regex and matched with `search`, not `fullmatch`
  (`generate-art.py:788-789`), against `e.key` **or** `e.name`. Unanchored, one
  entry whose slug is a prefix of another's would render both. Unescaped, a
  heading's own punctuation would be regex syntax. The prefix from `--list`
  matches `key`, which for these flat catalogues equals the label, because
  `path` excludes the deepest heading and level 1 (`generate-art.py:173-177`)
  and these files put every entry at level 2.
- **A separate manifest.** `--manifest` defaults to `.generated-manifest.json`
  at the generator root (`generate-art.py:51`), which is the mech catalogue's
  record. Pointing it inside `backgroundsDir` keeps background runs from writing
  into it, and keeps a `--resume` decision about backgrounds from being made
  against mech history.
- **`--width`/`--height` default to 1920×1080**, which is what every `### Settings`
  block in the catalogue asks for.

### `animateArgs(script, opts)`

```
[script, still, '--background', '--out', out, '-d', description, '--seed', String(seed),
 ...(pingpong ? [] : ['--no-pingpong'])]
```

Every field required, and validated the way `animate.animateArgs`
(`lib/animate.js:56`) validates its own: the script would happily default
`--out` beside the source and roll its own seed, but a run the server cannot
name the output of, or cannot record the seed of, is a run the panel cannot
show.

`-d` rather than `--roll`, for the reason `lib/animate.js` gives in the comment
above `animateArgs`: the draw happens on this side, where it can be shown,
re-rolled and pinned before a multi-minute render is paid for, and the sidecar
records exactly what was sent.

### `animationFilesFor(stillRelPath)`

`<dir>/<stem> Animated.webp` and `<dir>/<stem> Animated.json`, beside the still.
Mirrors `animate.animationFiles` (`lib/animate.js:43`) so a folder listing reads
as one set.

### `parseSidecar` / `isStale`

Re-exported from `lib/animate.js` unchanged rather than reimplemented. The
sidecar shape is the same and so is the staleness question: the record holds the
source image's mtime at render time, and a later mtime means the still was
re-rendered and the loop is of a scene that is no longer there.

### `pickMotionPrompt(prompts, { exclude, random })`

`animate.pickDescription` (`lib/animate.js:80`) re-exported under a name that
fits this tab — it is already parameterised on the pool, so this is an alias,
not a copy. Re-roll returns a different prompt than the one showing whenever the
pool holds any other, because a Re-roll button that returns the same sentence
reads as a button that did nothing.

### `resolveInside(root, rel)`

Resolves `rel` against `root` and returns `null` unless the result is `root`
itself or sits under `root + path.sep`. Every client-supplied filename in §4
passes through this before anything opens it. Pure, so the traversal refusals
are unit-tested without a server.

---

## 4. Server routes

All under `handleApi`, following the existing `if (url.pathname === ...)` shape.

### `GET /api/backgrounds`

```jsonc
{
  "available": true,
  "dir": "G:\\...\\output\\backgrounds",
  "catalogues": [{ "file": "scene-background-art-prompts.md",
                   "label": "Scene",
                   "entries": [{ "prefix": "...", "name": "...", "role": "...",
                                 "excerpt": "...", "line": 5 }] }],
  "motionPrompts": ["smoke drifts slowly across the scene ...", "..."],
  "items": [{ "rel": "LancerBackgrounds/Canyon-Skirmish_00001_.png",
              "name": "Canyon Skirmish",
              "mtime": 1757500000000,
              "animation": { "webp": "...", "description": "...", "seed": 7,
                             "builtAt": 1757500100000, "stale": false } }]
}
```

`items` is a recursive walk of `backgroundsDir`, depth-capped at 6, taking
`.png`, `.jpg`, `.jpeg` and `.webp`, and skipping both any `.webp` that is some
still's animation output and any dotfile — which is what keeps
`.backgrounds-manifest.json` out of the listing. Catalogue entries are the
`--list` shell-out of §3, one child process per catalogue file, run
concurrently.

Two derived display fields, both cosmetic and both safe to get wrong:

- An item's `name` is its filename stem with ComfyUI's `_00001_` counter suffix
  dropped and `_slug`'s dashes turned back into spaces, so
  `Canyon-Skirmish_00001_.png` reads as "Canyon Skirmish". A stem that does not
  match that shape is shown verbatim.
- A catalogue's `label` is its filename with `-background-art-prompts.md`
  removed and the first letter capitalised, so the two known files read as
  "Scene" and "City" without a lookup table that a third file would have to be
  added to.

`available: false` with an empty everything when the §1 gate fails, so the route
answers rather than 404s and the client can say which piece is missing.

### `POST /api/backgrounds/render`

Body: `catalogue`, `prefix`, `variants` (1–8), `seed`, `width`, `height`, and
the opt-in chain (§5). `seed` is a non-negative integer or `null`; `null` omits
the flag and lets the script roll its own, which is the only seed mode a render
has. The three-way `seedMode` of `/api/regenerate` does not apply here, because
there is no previous seed to mean "same" — a still is rendered, never
regenerated in place. Refuses an unknown catalogue, an unknown
prefix, or a missing script with the same `"generate-art.py not found at ..."`
shape the 3D and animate routes already use (`server.js:996`, `:1188`). Answers
`202 { jobId }`.

### `POST /api/backgrounds/animate`

Body: `rel`, `description`, `seedMode` (`same` / `specific` / `random`), `seed`,
`pingpong`. `rel` goes through `resolveInside` and must exist. `seedMode` is
validated identically to `/api/regenerate` and `/api/animation`
(`server.js:2680-2687`), and `same` means the seed in the existing sidecar,
falling back to a fresh roll when there is none. Answers `202 { jobId }`.

**No `/api/backgrounds/description` route.** The NPC animate panel stages its
description server-side because it is a pseudo-trait rendered on the detail
sheet and has to survive a reload. A background's motion prompt is chosen in the
panel immediately before the render, is shown nowhere else, and dies with the
panel. So `GET` ships the enabled pool, the client rolls from it with the shared
`pickMotionPrompt`, and `POST` carries the text it settled on. One fewer route,
one fewer piece of server state, and the sidecar still records exactly what was
sent.

### `GET /api/backgrounds/image?rel=...`

`resolveInside`, then stream with the content type from the extension and
`Cache-Control: no-store`, matching `/api/animation-image` (`server.js:2711`).

### `GET /api/backgrounds/status?jobId=...`

Reuses the `createJobs` record shape and its `CREATE_LOG_LIMIT` log tail
(`server.js:1388`, `:1615`) verbatim, plus `chain` (§5). The client polls it
exactly as it polls `/api/create-status`.

---

## 5. The opt-in chain

`POST /api/backgrounds/render` accepts `animateWhenDone` with the animate
options. When set, the render job's `close` handler, on exit code 0 only:

1. Diffs a recursive snapshot of `backgroundsDir` taken before `spawn` against
   one taken after — the same before/after technique `startCreateJob`
   (`server.js:1585`) uses, for the same reason it states: exit code 0 means the
   script did not crash, not that it wrote anything, and ComfyUI can drop a job.
2. Starts one animate job per new still and records their ids on the parent as
   `chain: [{ rel, jobId }]`.

With `variants` above 1 this produces several stills at once. Each gets its own
motion prompt, rolled server-side with `pickMotionPrompt` from the same enabled
pool, rather than all sharing the one the panel was showing — the variants are
different images and giving them one description would waste the pool on the
run where it is least likely to fit all of them. Each gets its own seed too,
rolled per still. The prompt and seed actually used land in that still's own
sidecar, so the gallery can always say what made each loop.

The parent reports `done` once its own render finished. The client watches the
chain ids separately, so a failed animation is visible as itself rather than
retroactively failing a render that did produce a still. A render that produced
nothing yields an empty chain and a plain "no images were produced" line, taken
from the same log tail the Create tabs surface.

Rendering and animating stay two buttons regardless. A Wan render is minutes,
and the point of looking at the still first is to not pay for a loop of a bad
one. `animateWhenDone` is a checkbox for when you already trust the entry.

---

## 6. Client

One new tab button in `public/index.html`, after Create Spaceship:

```html
<button type="button" data-tab="backgrounds" data-feature="backgrounds">Backgrounds</button>
```

Rendered in the markup rather than built in JS, with the same justification the
`data-kind` comment gives (`public/index.html:15-22`): the markup stays what it
always was when the scripts ARE present, and a failed or too-old
`/api/categories` degrades to today's UI rather than to a missing tab.

The panel is a parallel `backgroundsState` / `elBackgrounds` block, in the shape
`shipCreateState` established. It does **not** parameterise `render()`,
`openDetail()`, `traitControlCells()` or the Create blocks — ten `ui.*.test.js`
files lift functions out of `app.js` by name and brace-matching via
`liftFunction`, and a rename there is a contract break needing its own review,
not a mechanical fix.

Three regions:

- **Render.** Catalogue select, entry list showing heading, role and excerpt,
  variants, a seed field with a "roll one" checkbox that sends `null`, size, the
  `animateWhenDone` checkbox with its motion controls, and a Render button.
  Status line polls `/api/backgrounds/status`.
- **Gallery.** A card grid of `items`, newest first, each card the still with its
  name, an "Animated" pill when a loop exists, and a "Stale" pill when the
  sidecar's recorded mtime is older than the still's.
- **Animate.** Opens on a selected card. Shows the current motion prompt with
  Re-roll and a free-text field, the three seed modes, a ping-pong checkbox, the
  existing loop when there is one, and an Animate button.

---

## 7. Test plan

`node --test`, `node:test` + `node:assert/strict`, zero dependencies, matching
the existing suite. This suite has pre-existing port collisions under a
whole-directory run — `create-presets`, `set-flag` and `table-bullets` fail
together that way and pass individually — so every new file is also run alone
before it is called green.

**`test/backgrounds.test.js`** (pure, no server)

- `parseListOutput` on real `--list` output, including an empty `role` column, a
  prefix longer than 58 characters that pushes the columns, and a non-matching
  banner line that must be ignored.
- `renderArgs` anchors and escapes the filter; a prefix containing `.` or `(`
  does not become regex syntax.
- `renderArgs` points `--manifest` inside `backgroundsDir`, never at the
  generator root default.
- `renderArgs` omits `--seed` entirely when seed is null.
- `animateArgs` includes `--background`, and `--no-pingpong` only when asked.
- `animateArgs` throws on each missing or malformed field.
- `animationFilesFor` derives both names from the still's stem.
- `resolveInside` accepts a nested relative path and refuses `..`, an absolute
  path, and a sibling directory whose name merely starts with the root's name.
- `pickMotionPrompt` never returns the excluded prompt when the pool holds
  another, and does return it when the pool holds only that one.

**`test/api.backgrounds.test.js`** (temp `backgroundsDir`, stub scripts)

- `GET` lists nested stills, pairs each with its sidecar, and omits animation
  `.webp`s and dotfiles.
- `GET` reports `available: false` when a script is missing.
- `GET`'s `motionPrompts` are the enabled `Background Animation` bullets and
  exclude disabled ones, read from a fixture that also contains a hard-wrapped
  `Backdrop` table, proving the bad tables in that file do not break the good one.
- `POST /render` refuses an unknown catalogue and an unknown prefix.
- `POST /animate` refuses `../` in `rel`, and refuses a bad `seedMode`.
- `GET /image` refuses `../` and serves a real file with the right type.
- Both `POST`s refuse with the "not found at" message when their script is absent.

**`test/ui.backgrounds.test.js`** (regex/lift over the served `app.js`, matching
`ui.shipCreate.test.js`)

- `applyFeatureAvailability` removes a `data-feature` node absent from
  `features`, and leaves everything alone for a missing field, a non-array and
  an empty array.
- The tab button carries `data-feature="backgrounds"`.
- A card renders the Stale pill from the sidecar comparison.

**`test/paths.test.js`** (extended)

- The four new keys derive from `generateNpcScript`, and an explicit
  `config.backgroundsDir` wins.

---

## 8. File-by-file change list and build order

1. `lib/paths.js` — four derived keys; `config.example.json` — four empty keys;
   extend `test/paths.test.js`. **Ships green on its own.**
2. `lib/backgrounds.js` + `test/backgrounds.test.js`. Pure, no server touched.
   **Ships green on its own.**
3. `server.js` — the five routes, the two job starters, `features` on
   `/api/categories`; `test/api.backgrounds.test.js`.
4. `public/index.html`, `public/app.js`, `public/style.css` — tab, panel,
   `applyFeatureAvailability`; `test/ui.backgrounds.test.js`.
5. `README.md` — a Backgrounds section and the four config keys.

---

## 9. Contract assumptions to reconcile with Repo B

Written down because they are cross-repo and silent if they break.

- **`--list`'s output format** (`generate-art.py:878`) is parsed here. A change
  to that format breaks the picker. The parse ignores non-matching lines, so the
  failure mode is an empty entry list and a visible "no entries" state, not a
  crash or a wrong render.
- **`--filter` matching `key` or `name` with `re.search`** (`:788`). If it ever
  became `fullmatch`, the anchors this design adds would still be correct.
- **`download()` preserving the subfolder** (`:590`). If it ever flattened, the
  recursive walk still finds the files; only the gallery's nesting changes.
- **The `Background Animation` heading and its one-line-per-bullet rule**
  (`prompts/scene-and-spaceship-tables.md:183`). A hard-wrapped bullet added
  there is silently truncated by `readTables`, exactly as it is for
  `animate-portrait.py` itself, so both repos degrade the same way.
- **`animate-portrait.py --background`'s preset selection**
  (`animate-portrait.py:399`). This design passes `--background` and overrides
  nothing it sets, so the size, frame count and negative prompt stay whatever
  Repo B decides they should be.

---

## 10. Summary of the commitment

A Backgrounds tab that renders stills from every background catalogue the
generator has, keeps them in one configured folder as ordinary files, and
animates any of them into a looping webp. One new pure module, five new routes,
one new tab, four new config keys, no change to any existing route's behaviour,
and no change to any function the existing UI tests lift by name.
