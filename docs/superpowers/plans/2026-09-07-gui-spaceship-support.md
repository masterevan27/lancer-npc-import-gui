# Spaceship support in the import GUI — implementation plan (Repo GUI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give spaceships every capability the GUI already gives NPCs — browsing, re-rolling traits, setting traits, creating new ones, and importing into Foundry — with a token that spans the 1 to 5 grid hexes its hull actually occupies.

**Architecture:** Generic on the data plane, parallel on the generator plane. One new module, `lib/kinds.js`, resolves the five things that vary per kind (generator script, tables file, presets root, Foundry subdir, capability set). Every existing kind-coupled route grows an optional `?kind=` / `body.kind` **defaulting to `'npc'`**, so 46 test files, a shipped Foundry module and a stale browser tab all keep working untouched. One manifest, one seen store, one imported index, one job machine — **no data migration anywhere**.

**Tech Stack:** Node.js (no framework, no dependencies), `node:test` + `node:assert/strict`, vanilla browser JS. `server.js` is 2,808 lines; `public/app.js` is 3,812.

**Spec:** [`docs/superpowers/specs/2026-09-06-gui-spaceships-design.md`](../specs/2026-09-06-gui-spaceships-design.md) — §1 the decision, §2 server, §3 client, §4 Foundry import, §5 trait accumulation parity, §6 build order, §7 test plan, §8 contract assumptions.
Companion: [`docs/superpowers/plans/2026-09-07-spaceships-and-trait-fixes.md`](2026-09-07-spaceships-and-trait-fixes.md) (why), [`REMAINING-WORK.md`](../../../REMAINING-WORK.md).
**Sibling plan:** `docs/superpowers/plans/2026-09-07-spaceship-generator-completion.md` in the ART repo. **Its Task 1 and Task 1b block this plan's Task 1.**

---

## Global Constraints

- **Every existing route keeps its exact current behaviour when `kind` is absent.** This is the load-bearing constraint of the whole design. 46 test files, the shipped Foundry module and a cached browser tab all depend on it.
- **`SEEN_VERSION` stays `1`** (`server.js:478`). `ensureSeenLoaded` (`:500`) reseeds the *entire library as seen* on a version mismatch, so bumping it silently marks every existing NPC and every ship as already-looked-at. This is the single most dangerous accidental change in the project.
- **No data migration.** One `.generated-npcs.json` holds both kinds, distinguished by `entry.kind`. `.imported.json` and `.npc-seen.json` are untouched — their keys are opaque item ids and `npc-…` cannot collide with `ship-…`.
- **Test ports: new files take 5225–5232.** 5000 and 5193–5224 are occupied. `node --test` runs files concurrently and every server binds a fixed port; two files on one port **hang** the run rather than failing it, and that fault has already cost real time.
- **Baseline: 422 passing, 0 failing**, `node --test` (~7.6s). Every task ends green.
- **These files must not change:** `ui.newBadge`, `ui.traitColumns`, `ui.setTraitPicker`, `ui.rerollConfirm`, `ui.imageLocation`, `ui.copyPrompts`, `ui.overrideRow`, `ui.regenBanner`, and every `lib/` unit test. If one goes red, the change has left the design — stop and re-read §3.2.
- **No `renderShipDetailTraits`. Ever.** The staged-edit machinery is written once and shared. Task 5 adds a test that fails if such a function appears.
- **Commit after every task.** Branch is `ultracode-features`; nothing is on `main` and nothing is pushed.
- Working directory for every command:
  `G:/GIT-REPOS/lancer-npc-import-gui/.claude/worktrees/ultracode-features`

**A note on how the tests are specified here.** Pure-module tests (`kinds`, `paths`) and the client seam tests are given as complete code, because their exact shape is load-bearing. The `api.*.test.js` files are given as **exact assertion lists with exact expected values** rather than full source: each needs 40–60 lines of fixture-manifest and `startTestServer` boilerplate that is mechanical and already modelled by every existing `test/api.*.test.js`. Copy the nearest existing file's scaffolding, then write the listed assertions. Design §7 carries the same lists if you want a second reading.

---

## Findings that change the spec

Measured against both running codebases on 2026-09-07. Where these contradict the design doc, **these win.** Update §8's assumption table as you go, so the next reader is not working from a guess.

| # | Finding | What to do |
|---|---|---|
| **G1** ⚠️ | **The design's assumption A2 is wrong, and following it would break every ship on the map.** The generator's manifest entry carries `gridWidth`/`gridHeight` in **grid units** and `tokenWidth`/`tokenHeight` in **PIXELS** (`large` → `gridWidth: 3`, `tokenWidth: 1728`). §4.2's `queueImport` snippet passes `item.tokenWidth` to Foundry as the prototype token's width. That would draw a cruiser 1728 hexes wide. | **`queueImport` must send `gridWidth`/`gridHeight`.** Task 4 does this, names the Foundry-facing fields `tokenWidth`/`tokenHeight` in the *wire payload* (which is what the contract doc already promises the module), and sources them from the entry's `gridWidth`/`gridHeight`. |
| **G2** | The ship tables file is **`prompts/spaceship-generator-tables.md`**, not `prompts/scene-and-spaceship-tables.md`. §2.2's derivation names the wrong file. `scene-and-spaceship-tables.md` still exists but has never been parseable — all 41 of its bullets are hard-wrapped, and `parse_tables` truncates each at its first physical line. | `spaceshipTablesPath` derives to `prompts/spaceship-generator-tables.md`. Task 1. |
| **G3** | **Assumption A3 was false and is now true.** `--out-root` did not exist on the ship CLI; ART plan Task 1b adds it. | `spaceshipOutputRoot` stays in the config. **Confirm `--out-root` is in `generate-spaceship.py --help` before starting Task 2.** |
| **G4** | **Assumption A4 is half right.** `--ship-catalogue` emits `{"types":[{slug,name,sizes,folder}], "sizes":[…], "themes":[…]}` — but `sizes` is an **array of objects** (`{sizeBand,hexes,gridWidth,gridHeight,tokenWidth,tokenHeight,gloss}`), not the `{band:{hexes,label}}` map the design predicts. There is also a `themes` key the design did not anticipate, and a per-type `folder`. | The Type→Size gating reads `types[].sizes` (an array of band strings — that part is as predicted) and indexes the `sizes` array by `sizeBand`. Task 7. |
| **G5** | **Assumptions A1, A6, A7, A8 all hold.** `--manifest` exists; output nests `<root>/runN/<Category>/<Name>/`; the four constants parse out of the merged `generate-spaceship.py` (18 / 16 / 16 / 9); `--apply-only` exists and `--set-trait` persists `traits`/`rawTraits`. | Mark them settled in §8. No work. |
| **G6** | **Assumption A5 (`"deployable"`) cannot be verified from this repo** — the Foundry module is not vendored here and `docs/foundry-importer-contract.md` never mentions an actor type. | Keep it config-driven (`foundrySpaceshipActorType`, default `'deployable'`), omit the field entirely when the config is empty, and document in the contract that an unknown `actorType` must fall back to the module's default. A wrong guess then costs one config line, not a code change. Task 4. |
| **G7** | **`queueImport` already carries `kind: item.kind`** (`server.js:367`). The design describes it as new. | Less work than §4.2 implies — only the size fields and `actorType` are additive. |
| **G8** | The two port collisions recorded as known-issue 2 in the handoff plan are **already fixed**: `api.traitImage` is on 5204 and `api.createPresets` on 5219. No file pair shares a port today. | Delete that stale note from the handoff plan while you are in `docs/`. No test change. |

---

### Task 1: The kind registry and its paths — pure modules, no route touched

*(Design phase P1. Covers `REMAINING-WORK.md` Task 5.)*

**Files:**
- Create: `lib/kinds.js` (~140 lines)
- Modify: `lib/paths.js` (~+45 lines)
- Modify: `server.js` — `DEFAULT_CONFIG` only (`:64-107`), plus the `manifestPath` alias at `:131-137`
- Modify: `config.example.json` (+11 lines)
- Create: `test/kinds.test.js` (~90 lines, no port)
- Modify: `test/paths.test.js` (~+55 lines, no port)

**Interfaces:**
- Consumes: `derivePaths(config)` (existing, `lib/paths.js:24`), which **must keep returning its current seven keys unchanged** — `test/paths.test.js` has 40 assertions on them.
- Produces:
  - `lib/paths.js` → `derivePaths(config)` returns the existing seven keys **plus** `generateSpaceshipScript`, `spaceshipTablesPath`, `spaceshipPresetsDir`, `spaceshipCreatePresetsDir`, `spaceshipStagedImportsDir`, `spaceshipStagedRefsDir` — all strings.
  - `lib/kinds.js` → `{ DEFAULT_KIND: 'npc', buildKinds(paths, config), kindFor(kinds, id), kindOf(kinds, item), requestKind(url, body), available(kinds) }`.
  - A registry entry: `{ id, label, subject, script, tables, presetsDir, createPresetsDir, createPresetDiscriminator, stagedImportsDir, stagedRefsDir, foundrySubdir, foundryActorType, supports, createArgs(opts), regenArgs(opts) }`.
  - `supports` is `{ regen, setTrait, stageTrait, model3d, traitCandidates, tables, create, odds }`, all booleans.

**Blocked by:** ART plan Task 1 (the merged `generate-spaceship.py` must exist and parse) and Task 1b (`--out-root`).

- [ ] **Step 1: Confirm the generator side is actually ready**

```bash
ART=G:/GIT-REPOS/lancer-art-generator/.claude/worktrees/ultracode-spaceships
ls "$ART/generate-spaceship.py" "$ART/prompts/spaceship-generator-tables.md"
python "$ART/generate-spaceship.py" --help 2>&1 | grep -oE '\-\-out-root|\-\-apply-only|\-\-ship-catalogue|\-\-manifest'
node -e "
const ot = require('./lib/overrideTables.js');
const s = require('fs').readFileSync(process.argv[1], 'utf8');
console.log(ot.parseRequiredTables(s).length, ot.rerollableTraitsFrom(s).length,
            ot.rawRerollableTraitsFrom(s).length, Object.keys(ot.traitDependentsFrom(s)).length);
" "$ART/generate-spaceship.py"
```

Expected: both files exist; all four flags listed; `18 16 16 9`.
**If the parse line is `0 0 0 0`, stop.** The GUI would ship empty trait dropdowns and no reroll buttons, silently. That is ART plan Task 1 Step 6 and it must be green first.

- [ ] **Step 2: Write the failing tests for the ship path set**

Append to `test/paths.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { derivePaths } = require('../lib/paths.js');

const BASE = { npcManifestPath: path.join('G:', 'gen', '.generated-npcs.json') };

test('the seven existing keys are unchanged by the ship additions', () => {
    const p = derivePaths(BASE);
    assert.equal(p.generateNpcScript, path.join('G:', 'gen', 'generate-npc.py'));
    assert.equal(p.npcTablesPath,
        path.join('G:', 'gen', 'prompts', 'npc-generator-tables.md'));
    assert.equal(p.presetsDir, path.join('G:', 'gen', 'prompts', 'presets'));
    assert.equal(p.createPresetsDir,
        path.join('G:', 'gen', 'prompts', 'presets', 'create'));
});

test('generateSpaceshipScript sits beside the manifest by default', () => {
    assert.equal(derivePaths(BASE).generateSpaceshipScript,
        path.join('G:', 'gen', 'generate-spaceship.py'));
});

test('spaceshipTablesPath is the ship tables file, beside the SHIP script', () => {
    // Not scene-and-spaceship-tables.md: that file exists but every one of its
    // 41 bullets is hard-wrapped, and parse_tables truncates a wrapped bullet
    // at its first physical line. The generator's own DEFAULT_TABLES names
    // spaceship-generator-tables.md.
    const p = derivePaths({ ...BASE,
        generateSpaceshipScript: path.join('D:', 'elsewhere', 'generate-spaceship.py') });
    assert.equal(p.spaceshipTablesPath,
        path.join('D:', 'elsewhere', 'prompts', 'spaceship-generator-tables.md'));
});

test('ship presets live under presetsDir and follow an override of it', () => {
    const p = derivePaths({ ...BASE, presetsDir: path.join('S:', 'synced') });
    assert.equal(p.spaceshipPresetsDir, path.join('S:', 'synced', 'spaceship'));
    assert.equal(p.spaceshipCreatePresetsDir,
        path.join('S:', 'synced', 'spaceship', 'create'));
});

test('the ship staged-imports dir is a SIBLING of the NPC one, not a child', () => {
    // listStagedFiles reads *.json at the top level of its dir, so a child
    // would be invisible to it - and both tables files carry a "## Backdrop",
    // so a candidate bullet's table name only means something paired with a file.
    const p = derivePaths(BASE);
    assert.notEqual(p.spaceshipStagedImportsDir, p.stagedImportsDir);
    assert.equal(path.dirname(p.spaceshipStagedImportsDir),
        path.dirname(p.stagedImportsDir));
    assert.equal(p.spaceshipStagedRefsDir,
        path.join(p.spaceshipStagedImportsDir, 'refs'));
});
```

- [ ] **Step 3: Run them and watch them fail**

```bash
node --test test/paths.test.js
```

Expected: the four new ship tests FAIL with `undefined`; the existing 40 still pass.

- [ ] **Step 4: Extend `lib/paths.js`**

Add inside `derivePaths`, before the `return`, and add the six names to the returned object:

```js
    // The ship generator sits beside generate-npc.py, and its tables follow it
    // rather than the manifest - the same "later paths follow the override"
    // rule the rest of this file obeys.
    const generateSpaceshipScript = config.generateSpaceshipScript
        || path.join(path.dirname(generateNpcScript), 'generate-spaceship.py');

    // spaceship-generator-tables.md, not scene-and-spaceship-tables.md. The
    // second file exists and was mined for vocabulary, but it has never been
    // parseable: all 41 of its bullets are hard-wrapped at ~72 columns and
    // parse_tables' bullet regex silently truncates each at its first physical
    // line, losing the whole flag segment.
    const spaceshipTablesPath = config.spaceshipTablesPath
        || path.join(path.dirname(generateSpaceshipScript), 'prompts',
                     'spaceship-generator-tables.md');

    // Under presetsDir, for the reason createPresetsDir is: one folder to move,
    // one to sync. listPresets filters on .endsWith('.json'), so a subdirectory
    // is invisible to the NPC listing.
    const spaceshipPresetsDir = config.spaceshipPresetsDir
        || path.join(presetsDir, 'spaceship');
    const spaceshipCreatePresetsDir = config.spaceshipCreatePresetsDir
        || path.join(spaceshipPresetsDir, 'create');

    // A SIBLING of stagedImportsDir, not a child: listStagedFiles reads *.json
    // at the top level of its own directory and would never see a child, and
    // both tables files carry a '## Backdrop', so a staged candidate's table
    // name is only meaningful paired with the file it came from.
    const spaceshipStagedImportsDir = config.spaceshipStagedImportsDir
        || path.join(path.dirname(spaceshipTablesPath), 'staged-imports-spaceship');
    const spaceshipStagedRefsDir = config.spaceshipStagedRefsDir
        || path.join(spaceshipStagedImportsDir, 'refs');
```

- [ ] **Step 5: Run the path tests**

```bash
node --test test/paths.test.js
```

Expected: all pass, existing 40 included.

- [ ] **Step 6: Write the failing tests for the registry**

Create `test/kinds.test.js`:

```js
/**
 * The kind registry, unit-tested the way lib/paths.js is: no port, no fs.
 *
 * Every variation point in the server used to read a module-level constant.
 * This registry is the one new abstraction the spaceship work introduces, and
 * the table-driven completeness test below is what stops a third kind (Mechs,
 * which CATEGORY_LABELS already anticipates) being added with a field missing.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { derivePaths } = require('../lib/paths.js');
const kindsLib = require('../lib/kinds.js');

const CONFIG = {
    npcManifestPath: path.join('G:', 'gen', '.generated-npcs.json'),
    foundryNpcSubdir: 'LancerNPCs',
    foundrySpaceshipSubdir: 'LancerSpaceships',
    foundryNpcActorType: 'npc', // set explicitly here; the SHIPPED default is ''
    foundrySpaceshipActorType: 'deployable',
};
const KINDS = kindsLib.buildKinds(derivePaths(CONFIG), CONFIG);

const REQUIRED_FIELDS = ['id', 'label', 'subject', 'script', 'tables',
    'presetsDir', 'createPresetsDir', 'createPresetDiscriminator',
    'stagedImportsDir', 'stagedRefsDir', 'foundrySubdir', 'supports',
    'createArgs', 'regenArgs'];

test('both kinds resolve and an unknown one does not', () => {
    assert.ok(kindsLib.kindFor(KINDS, 'npc'));
    assert.ok(kindsLib.kindFor(KINDS, 'spaceship'));
    assert.equal(kindsLib.kindFor(KINDS, 'mech'), null);
});

test('an entry with no kind falls back to npc', () => {
    // A manifest entry written by an older generator carries no `kind`. It
    // must not crash a route; it is an NPC, which is all there was.
    assert.equal(kindsLib.kindOf(KINDS, { kind: undefined }).id, 'npc');
    assert.equal(kindsLib.kindOf(KINDS, {}).id, 'npc');
    assert.equal(kindsLib.kindOf(KINDS, { kind: 'spaceship' }).id, 'spaceship');
});

test('requestKind prefers the body, then the query, then npc', () => {
    const url = new URL('http://x/api/items?kind=spaceship');
    assert.equal(kindsLib.requestKind(url, { kind: 'npc' }), 'npc');
    assert.equal(kindsLib.requestKind(url, {}), 'spaceship');
    assert.equal(kindsLib.requestKind(new URL('http://x/api/items'), {}), 'npc');
    assert.equal(kindsLib.requestKind(new URL('http://x/api/items'), null), 'npc');
});

test('every registry entry carries every field', () => {
    for (const [id, entry] of Object.entries(KINDS)) {
        for (const field of REQUIRED_FIELDS) {
            assert.ok(entry[field] !== undefined,
                `kind ${id} is missing ${field}`);
        }
    }
});

test('3D models are an NPC capability only, for now', () => {
    assert.equal(KINDS.npc.supports.model3d, true);
    assert.equal(KINDS.spaceship.supports.model3d, false);
});

test('the ship create argv passes --manifest and never a person flag', () => {
    const argv = KINDS.spaceship.createArgs({
        count: 2, seed: 7, manifestPath: CONFIG.npcManifestPath,
        overrides: [{ table: 'Ship type', value: 'a blunt-nosed bulk hauler' }],
    });
    assert.ok(argv.includes('--manifest'));
    assert.ok(argv.includes('--set-trait'));
    assert.ok(argv.includes('Ship type=a blunt-nosed bulk hauler'));
    assert.ok(!argv.includes('--pronouns'));
    assert.ok(!argv.includes('--unarmed'));
});

test('--out-root is emitted only when configured', () => {
    const base = { count: 1, manifestPath: CONFIG.npcManifestPath, overrides: [] };
    assert.ok(!KINDS.spaceship.createArgs(base).includes('--out-root'));
    const withRoot = KINDS.spaceship.createArgs({ ...base, outputRoot: 'D:/ships' });
    assert.ok(withRoot.includes('--out-root'));
    assert.ok(withRoot.includes('D:/ships'));
});

test('the two kinds use different create-preset discriminators', () => {
    // So a ship preset dropped on the NPC tab's Import button is refused by the
    // check that already exists, rather than half-applied.
    assert.notEqual(KINDS.npc.createPresetDiscriminator,
        KINDS.spaceship.createPresetDiscriminator);
});

test('the ship regen argv is the NPC one with the script swapped', () => {
    const opts = { manifestPath: 'M', id: 'ship-x-1', newSeed: 99, which: 'both' };
    const argv = KINDS.spaceship.regenArgs(opts);
    assert.ok(argv.includes('--regen-manifest'));
    assert.ok(argv.includes('--regen-id'));
    assert.ok(argv.includes('ship-x-1'));
    assert.ok(argv.includes('--new-seed'));
    assert.ok(!argv.includes('--no-token'));
    assert.ok(KINDS.spaceship.regenArgs({ ...opts, which: 'portrait' })
        .includes('--no-token'));
    assert.ok(KINDS.spaceship.regenArgs({ ...opts, which: 'token' })
        .includes('--no-portrait'));
});
```

- [ ] **Step 7: Run them and watch them fail**

```bash
node --test test/kinds.test.js
```

Expected: FAIL — `Cannot find module '../lib/kinds.js'`.

- [ ] **Step 8: Write `lib/kinds.js`**

Follow §2.1's shape. Points that matter:

- **`createArgs` for `npc` is `server.js:1113-1125` moved verbatim** — including the fact that it passes **no `--manifest`**. That is a latent bug (it silently depends on `config.npcManifestPath` equalling `generate-npc.py`'s `DEFAULT_MANIFEST`), but changing it here would break `test/api.createArgs.test.js`. Move it unchanged and leave a comment saying so.
- **`createArgs` for `spaceship` passes `--manifest` explicitly.** Do not reproduce the NPC path's implicit coupling in new code.
- `--pronouns` and `--unarmed` are never emitted for ships.
- `regenArgs` is `server.js:713-735` with the script swapped, which is the whole reason the argv builder moves into the registry rather than growing an `if`.
- `available(kinds)` returns only kinds whose `script` exists on disk — it drives `/api/categories`, so a GUI pointed at a generator repo without `generate-spaceship.py` simply shows no Spaceships tab instead of erroring.

- [ ] **Step 9: Run the registry tests**

```bash
node --test test/kinds.test.js
```

Expected: all pass.

- [ ] **Step 10: Add the config keys**

To `DEFAULT_CONFIG` (`server.js:64-107`) and `config.example.json`:

| key | default |
|---|---|
| `manifestPath` | `''` — preferred alias; resolution is `config.manifestPath \|\| config.npcManifestPath`, and the startup guard at `server.js:131-137` checks the resolved value |
| `generateSpaceshipScript` | `''` → derived |
| `spaceshipTablesPath` | `''` → derived |
| `spaceshipPresetsDir` | `''` → derived |
| `spaceshipCreatePresetsDir` | `''` → derived |
| `spaceshipStagedImportsDir` | `''` → derived |
| `spaceshipStagedRefsDir` | `''` → derived |
| `foundrySpaceshipSubdir` | `'LancerSpaceships'` |
| `foundryNpcActorType` | `''` — empty, so the field is omitted from the job entirely and today's NPC payload is unchanged (R14). Set it to `'npc'` if you want the field emitted |
| `foundrySpaceshipActorType` | `'deployable'` — **G6, unverified**; empty string omits the field |
| `spaceshipOutputRoot` | `''` → passed as `--out-root` when non-empty |

**No per-kind `--out` key.** `--out` names a *run* folder, so a configured `--out` would pin every ship run to one directory. `--out-root` is the correct shape (G3).

- [ ] **Step 11: Run the whole suite and commit**

```bash
node --test --test-concurrency=8 "test/*.test.js"
```

Expected: 422 + the new tests, 0 failing. Nothing else changed, so nothing else can have moved.

```bash
git add lib/kinds.js lib/paths.js server.js config.example.json test/kinds.test.js test/paths.test.js
git commit -F - <<'MSG'
feat: a kind registry, and the paths a second kind needs

Five things vary between an NPC and a spaceship - the generator script, the
tables file, the presets root, the Foundry subdirectory and the capability set
- and every one of them was already being read from a module-level constant.
lib/kinds.js is where those five now live, and it is the only new abstraction
the spaceship work introduces.

No route reads it yet. derivePaths still returns its original seven keys
byte-identically, so the forty assertions on them stand untouched.

The ship tables path is spaceship-generator-tables.md, not the
scene-and-spaceship-tables.md the design named: that file exists but has never
been parseable, since all 41 of its bullets are hard-wrapped and parse_tables
truncates a wrapped bullet at its first physical line.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019AYPnwSrCWF7pppwUnA8pq
MSG
```

---

### Task 2: The server data plane — browse a ship without a single ship-shaped branch

*(Design phase P2. First half of `REMAINING-WORK.md` Task 6.)*

**Files:**
- Modify: `server.js` — `foundryDestFolder` (`:242-247`), `npcEntriesSnapshot` (`:1101-1109`) → `entriesSnapshot(kind)`, `itemView` (`:1552`), `GET /api/categories` (`:1665`)
- Create: `test/api.items.spaceship.test.js` — port **5225**

**Interfaces:**
- Consumes: `buildKinds`, `kindOf`, `requestKind` from Task 1.
- Produces: `itemView(item)` gains three additive fields — `supports` (the kind's capability object), `artStale` (boolean, from the manifest entry), `tokenHexes` (`{w, h}` from the entry's `gridWidth`/`gridHeight`, or `null`). `entriesSnapshot(kind)` replaces `npcEntriesSnapshot()`. `/api/categories` entries gain `label` and `supports`.

**This is the load-bearing proof of the whole design:** that browse, import, delete and seen are already generic and need no per-kind code.

- [ ] **Step 1: Write the failing end-to-end test**

Create `test/api.items.spaceship.test.js` on **port 5225**, with a fixture manifest holding one `kind:"npc"` entry and two `kind:"spaceship"` entries and real files on disk. Assert:

```js
// GET /api/categories -> both ids, correct counts, label 'Spaceships',
//                        supports.model3d === false on the ship row.
// GET /api/items?category=spaceship -> exactly the two ships, name-sorted;
//                        each carries kind, traits, seed, roleCategory === null,
//                        tokenHexes and supports.
// GET /api/image?id=<ship>&which=portrait -> 200 image/png.
// POST /api/import on a ship -> queued:true; the files land under
//                        FoundryData/LancerSpaceships/<category>/<name>/,
//                        NOT LancerNPCs; the manifest key is repointed and
//                        the manifest re-reads clean.
// POST /api/delete on a ship -> folder gone, manifest key gone, seen entry
//                        pruned, the NPC entry untouched.
// POST /api/seen {ids:[shipId]} then GET /api/unseen -> the ship is gone from
//                        the list and the NPC is still in it.
// GET /api/model-3d?id=<ship> -> 400 naming the kind.
// GET /api/model-3d?id=<npc>  -> 200. (Pins that the refusal moved to
//                        supports without changing behaviour.)
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/api.items.spaceship.test.js
```

Expected: the import assertion fails first — ship files land under `LancerNPCs` because `foundryDestFolder` still reads `config.foundryNpcSubdir` unconditionally.

- [ ] **Step 3: Make `foundryDestFolder` kind-aware**

`server.js:242-247`, two lines:

```js
function foundryDestFolder(item) {
    const category = path.basename(path.dirname(item.folderPath));
    const name = path.basename(item.folderPath);
    return path.join(config.foundryDataRoot, kindOf(KINDS, item).foundrySubdir,
                     category, name);
}
```

The `<category>/<name>` nesting is unchanged and stays load-bearing: the ship generator's output is `<root>/runN/<Category>/<Name>/` precisely so `basename(dirname(...))` recovers the category. A flat layout would file every ship under a Foundry folder called `runN`.

- [ ] **Step 4: Rename `npcEntriesSnapshot` to `entriesSnapshot(kind)`**

`server.js:1101-1109`. The `.filter(item => item.kind === 'npc')` at `:1104` becomes `.filter(item => (item.kind || 'npc') === kind)`, and `startCreateJob` passes its own kind.

Without this a ship create job reports `produced: 0` and `producedIds: null`, never calls `forgetSeen` (`:1197`), and the run's own ships arrive with no New tags.

- [ ] **Step 5: Add the three additive fields to `itemView`**

`server.js:1552`. Leave `roleCategory` alone — it already guards on `'npc'` and yields `null` for ships, which is correct.

```js
        supports: kindOf(KINDS, item).supports,
        artStale: entry.artStale === true,
        // Grid units, NOT pixels. The manifest's tokenWidth/tokenHeight are
        // the rendered canvas in pixels; gridWidth/gridHeight are the hex
        // count Foundry sets token.width from. Confusing the two draws a
        // cruiser 1728 hexes wide.
        tokenHexes: Number.isInteger(entry.gridWidth)
            ? { w: entry.gridWidth, h: entry.gridHeight ?? entry.gridWidth }
            : null,
```

All three are additive, so `test/api.imageLocation.test.js` and its neighbours keep passing.

- [ ] **Step 6: Add `label` and `supports` to `/api/categories`**

`server.js:1665`. Each entry becomes `{ id, count, label, supports }`. The client keeps `CATEGORY_LABELS` as its fallback, so a stale tab is unaffected.

- [ ] **Step 7: Run the new test, then the whole suite**

```bash
node --test test/api.items.spaceship.test.js
node --test --test-concurrency=8 "test/*.test.js"
```

Expected: the new file passes; the suite is 422 + new, 0 failing. **If any `api.*` file went red, an existing route changed behaviour with `kind` absent — that is the Global Constraint, revert and re-read §2.5.**

- [ ] **Step 8: Commit**

```bash
git add server.js test/api.items.spaceship.test.js
git commit -F - <<'MSG'
feat: browse, import and delete a spaceship

Almost none of this is new code, which was the claim the design made and this
is the test of it: the grid, the filters, the sort, the detail sheet, the seen
index and the delete path were already generic over item.kind. Three functions
read a constant where they should have read the registry - foundryDestFolder
took the NPC Foundry subdir, npcEntriesSnapshot filtered the produced count to
NPCs, and itemView never said what an item supports.

itemView's tokenHexes is grid units. The manifest's tokenWidth/tokenHeight are
the rendered canvas in pixels, and the two must not be confused: a 1728 in
Foundry's token.width draws a cruiser across a continent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019AYPnwSrCWF7pppwUnA8pq
MSG
```

---

### Task 3: The server generator plane — spawn, refuse, and route by kind

*(Design phase P3. Second half of `REMAINING-WORK.md` Task 6.)*

**Files:**
- Modify: `server.js` — `startRegenJob` (`:697`), `startCreateJob` (`:1111`), the four `kind !== 'npc'` refusals (`:700`, `:822`, `:1929`, `:1995`), `?kind=` on the tables/trait/presets/odds families (`:1857`–`:2331`), new `POST /api/create`, new `POST /api/stage-trait`, new `GET /api/ship-catalogue`
- Modify: `lib/traitOdds.js` (+6 — `cacheKeyFor` gains the kind)
- Modify: `lib/createPresets.js` (+40 — a second settings schema behind the new discriminator)
- Modify: `test/helpers/testServer.js` (~+15 — accept `spaceshipGeneratorSource` and `spaceshipTablesText`)
- Create: `test/api.spaceshipRegenArgs.test.js` (port **5226**), `test/api.createKind.test.js` (port **5227**), `test/api.tablesByKind.test.js` (port **5228**)

**Interfaces:**
- Consumes: the registry from Task 1, `entriesSnapshot(kind)` from Task 2.
- Produces:
  - `POST /api/create` — body `{kind, count, seed, name, overrides[], server, noPortrait, noToken, keepRawToken, dryRun}` → `202 {jobId}` or `409`. `POST /api/create-npc` stays as an alias hard-coding `kind:'npc'`.
  - `POST /api/stage-trait` — body `{id, table, value?, reroll?}` → `200 itemView(item)`. Kind-aware from birth; resolves the kind **from the item**, so it never has a ship branch.
  - `GET /api/ship-catalogue` → the generator's `--ship-catalogue` JSON, cached by script mtime.

- [ ] **Step 1: Teach the test harness about a second generator**

`test/helpers/testServer.js` already repoints `pythonExecutable` at `process.execPath` when `generatorSource` is given (`:70`), so a Node stub can stand in for the Python script and argv assertions never need a Python interpreter. Add `spaceshipGeneratorSource` and `spaceshipTablesText` the same way, writing them into the fixture dir and setting `generateSpaceshipScript` / `spaceshipTablesPath` in the fixture config.

- [ ] **Step 2: Write the failing regen-argv test (port 5226)**

`test/api.spaceshipRegenArgs.test.js`, with a Node stub that writes `process.argv.slice(2)` and `process.cwd()` to a file and exits 0:

```js
// POST /api/regenerate {id:<ship>, which:'both', seedMode:'specific', seed:99}
//   -> 202; argv[0] is the SHIP script; argv has --regen-manifest,
//      --regen-id ship-…, --new-seed 99.
// which:'portrait' adds --no-token; 'token' adds --no-portrait.
// POST /api/reroll-trait {id:<ship>, table:'Weapon'} -> 202, --reroll-trait Weapon.
// POST /api/set-trait {id:<ship>, table:'Size', value:'…'} -> 202, not the old 400.
// A ship with empty rawTraits -> 400, the same "recorded no raw bullets" message.
// A second regen while one runs -> 409 'already regenerating'.
// The child's cwd is dirname(generateSpaceshipScript).
```

- [ ] **Step 3: Run it, watch it fail**

```bash
node --test test/api.spaceshipRegenArgs.test.js
```

Expected: 400 `not an npc` from the refusal at `server.js:700`.

- [ ] **Step 4: Convert the four hard refusals to capability lookups**

Same message text in each case — only the gate changes:

| line | today | becomes |
|---|---|---|
| `:700` (`startRegenJob`) | `item.kind !== 'npc'` | `!kindOf(KINDS, item).supports.regen` |
| `:822` (`/api/model-3d`) | `item.kind !== 'npc'` | `!kindOf(KINDS, item).supports.model3d` |
| `:1929` (`/api/set-trait`) | `item.kind !== 'npc'` | `!kindOf(KINDS, item).supports.setTrait` |
| `:1995` (`/api/trait-choices`) | `item.kind !== 'npc'` | `!kindOf(KINDS, item).supports.setTrait` |

Ships are still refused 3D models, because `spaceship.supports.model3d` is `false`. Behaviour for NPCs is unchanged at every one of the four.

- [ ] **Step 5: Route the generator spawns through the registry**

`startRegenJob` (`:703`, `:713`, `:743`): `GENERATE_NPC_SCRIPT` → `kind.script`, argv from `kind.regenArgs(...)`, error text taking the script basename from the kind. `startCreateJob` (`:1111`) takes `opts.kind`, gets script and argv from the registry, filters its snapshot by that kind, and records `job.kind`.

`lib/traitOdds.js`'s `oddsArgs(script, samples)` and `lib/traitChoices.js`'s `choicesArgs(script, manifest, id, trait)` already take the script as their first argument — **do not change either module**, just pass `kind.script`. Only `cacheKeyFor` changes, to include the kind.

- [ ] **Step 6: Run the regen test**

```bash
node --test test/api.spaceshipRegenArgs.test.js
```

Expected: all pass.

- [ ] **Step 7: Write the failing create test (port 5227)**

`test/api.createKind.test.js`:

```js
// POST /api/create-npc (the alias) produces BYTE-IDENTICAL argv to today:
//   --count, --seed, --name, --pronouns, --set-trait, flags - and NO
//   --manifest. This is the regression guard for the alias.
// POST /api/create {kind:'spaceship', count:2, overrides:[…]} -> the ship
//   script, --manifest <fixture manifest>, --set-trait 'Ship type=…', and
//   NEITHER --pronouns NOR --unarmed even when the body carries them.
// POST /api/create {kind:'spaceship', pronouns:'she'} -> 400
//   'pronouns are not a spaceship field', rather than silently dropped.
// spaceshipOutputRoot in extraConfig -> argv contains --out-root <path>;
//   absent -> no --out-root.
// GET /api/create-status?jobId= reports kind:'spaceship'.
// A stub that appends two ship entries yields produced:2 and two producedIds,
//   and the NPC entries in the same manifest are NOT counted.
// POST /api/create {kind:'mech'} -> 400 unknown kind.
```

- [ ] **Step 8: Implement `POST /api/create` and keep `/api/create-npc` as an alias**

~55 lines. Both routes call one handler; the alias hard-codes `kind: 'npc'`, which is what keeps `test/api.createArgs.test.js` (port 5193) green. Validate per kind: for ships, `pronouns` and `unarmed` are a 400 rather than a silent drop; `name` still requires `count === 1`; overrides are checked against that kind's parsed override tables. Returns 202/409 with a `jobId` into the **same** `createJobs` map.

- [ ] **Step 9: Run it**

```bash
node --test test/api.createKind.test.js test/api.createArgs.test.js
```

Expected: both pass. `api.createArgs` passing unchanged is the point of the alias.

- [ ] **Step 10: Write the failing tables-by-kind test (port 5228)**

`test/api.tablesByKind.test.js`, with a fixture writing **two** tables files that both contain a `## Backdrop` with different bullets:

```js
// GET /api/table-bullets (no kind) === ?kind=npc, and both return the NPC
//   file's Backdrop.
// ?kind=spaceship returns the SHIP file's Backdrop - the collision test.
// POST /api/table-bullets/toggle {kind:'spaceship', table:'Backdrop', …}
//   rewrites ONLY the ship file; the NPC file is byte-identical afterwards.
//   <- the most important assertion in this file. A cross-file write here
//      corrupts a 252 KB hand-authored tables file.
// Same for /set-weight.
// GET /api/trait-options?kind=spaceship keys on ship tables.
// GET /api/pronouns?kind=spaceship -> {subjects: []}, status 200 (NOT 400:
//   a 400 in a shared helper is a trap, and the ship form never calls it).
// GET /api/presets?kind=spaceship reads presets/spaceship/ and lists no NPC
//   presets; saving one does not appear under ?kind=npc.
// GET /api/npc-tables?kind=spaceship returns the ship generator's four parsed
//   constants; an UNPARSEABLE ship script yields empty lists and status 200 -
//   no reroll buttons is the safe way to be wrong.
```

- [ ] **Step 11: Add `?kind=` to the tables/trait/presets/odds families**

§2.5 goes route by route. The rule everywhere: `const kind = kindFor(KINDS, requestKind(url, body))`, defaulting to `'npc'`, then read `kind.tables` / `kind.presetsDir` / `kind.script` instead of the module constant.

The four startup parses (`server.js:976-991`, `:1030-1044`) become a **per-kind map**, built by looping the registry and running `lib/overrideTables.js` — which is already generic over source text — on each `kind.script`. The `OVERRIDE_TABLES_FALLBACK` list (`:968-973`) applies to `npc` **only**; a ship parse miss yields `[]`.

Keep the route named `/api/npc-tables`. A cached older page still works, and renaming it buys nothing.

- [ ] **Step 12: Run it**

```bash
node --test test/api.tablesByKind.test.js
```

Expected: all pass, the cross-file write assertion included.

- [ ] **Step 13: Add `POST /api/stage-trait` and `GET /api/ship-catalogue`**

`stage-trait` (~45 lines) resolves `kindOf(item)`, refuses on `!supports.stageTrait`, spawns `kind.script` with `--regen-manifest / --regen-id / --apply-only` plus `--set-trait` or `--reroll-trait`, awaits the child (fast — no ComfyUI), and answers `itemView(findItem(id))`. **Because it resolves the kind from the item, there is never a ship branch in it.**

`ship-catalogue` (~30 lines) spawns `generate-spaceship.py --ship-catalogue`, caches by script mtime, and returns the JSON as-is. Note its real shape (G4):

```json
{"types":  [{"slug":"patrol","name":"Patrol boat","sizes":["small"],"folder":"Patrol boats"}],
 "sizes":  [{"sizeBand":"small","hexes":1,"gridWidth":1,"gridHeight":1,
             "tokenWidth":1024,"tokenHeight":1024,"gloss":"one hex - a patrol boat, …"}],
 "themes": ["…"]}
```

`sizes` is an **array**, not the map the design predicted. Pass it through unchanged and let the client index it.

- [ ] **Step 14: Run the whole suite and commit**

```bash
node --test --test-concurrency=8 "test/*.test.js"
```

Expected: green, with `api.createArgs`, `api.rerollTrait`, `api.setTrait`, `api.traitChoices`, `api.traitOdds`, `api.presets` and `api.tableBullets` all passing **unchanged** — every kind defaults to `npc`, so they cannot have moved.

```bash
git add server.js lib/traitOdds.js lib/createPresets.js test/
git commit -F - <<'MSG'
feat: generate, re-roll and re-render a spaceship

The four `item.kind !== 'npc'` refusals become capability lookups against the
registry, with their message text unchanged, and the argv builders move into
the registry rather than growing an if. Ships are still refused a 3D model,
because spaceship.supports.model3d is false.

POST /api/create is the canonical route and /api/create-npc is now an alias
that hard-codes kind:'npc' - which is what keeps api.createArgs.test.js green
byte for byte, including its assertion that the NPC path passes no --manifest.
The ship path does pass one: that implicit coupling between config and the
generator's DEFAULT_MANIFEST is a latent bug and new code should not copy it.

POST /api/stage-trait resolves the kind from the item it was handed, so there
is no ship branch anywhere in it - which is the design's rule about the staged
edit machinery being written once.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019AYPnwSrCWF7pppwUnA8pq
MSG
```

---

### Task 4: Foundry import of a multi-hex token

*(Design phase P4. `REMAINING-WORK.md` Task 8.)*

**Files:**
- Modify: `server.js` — `queueImport` (`:361-382`), `reconcile` (`:421-436`), the reconcile route (`:2493-2504`)
- Modify: `docs/foundry-importer-contract.md` (+35)
- Modify: `test/importerContract.test.js` (+45, additive assertions only)
- Create: `test/api.importSpaceshipToken.test.js` (port **5229**), `test/api.reconcileKinds.test.js` (port **5230**)

**Interfaces:**
- Consumes: the registry (Task 1) and `itemView`'s `tokenHexes` (Task 2).
- Produces: the `/importer/pending` job gains **optional** `actorType`, `tokenWidth`, `tokenHeight` — present only when the source recorded them. `reconcile(entries, kinds)` takes an optional second argument; `POST /importer/reconcile` accepts an optional `kinds` array in the body.

**⚠️ G1 — the one thing to get right in this task.** The Foundry-facing `tokenWidth`/`tokenHeight` are **grid units**, and they come from the manifest entry's **`gridWidth`/`gridHeight`**, not from its `tokenWidth`/`tokenHeight`, which are the rendered canvas in pixels. The design's §4.2 snippet reads the wrong fields. For a `large` ship the entry holds `gridWidth: 3` and `tokenWidth: 1728`; sending 1728 draws a cruiser 1728 hexes across.

- [ ] **Step 1: Write the failing import test (port 5229)**

`test/api.importSpaceshipToken.test.js`:

```js
// Queue an NPC import -> the /importer/pending job has EXACTLY today's key
//   set: assert.ok(!('tokenWidth' in job)); assert.ok(!('actorType' in job)).
// Queue a ship whose manifest entry has gridWidth:3, gridHeight:2 (and
//   tokenWidth:1728, tokenHeight:1152 in pixels) -> the job carries
//   tokenWidth:3, tokenHeight:2 - the GRID numbers - plus
//   actorType:'deployable', kind:'spaceship', role:null, faction:null.
// assert.notEqual(job.tokenWidth, 1728);   // the G1 guard, stated outright
// A ship entry WITHOUT gridWidth -> the keys are absent, not null (the 1x1
//   graceful-degradation path).
// foundrySpaceshipActorType:'' in extraConfig -> actorType absent.
// portraitPath/tokenPath are Data-relative and forward-slashed under
//   LancerSpaceships/.
```

- [ ] **Step 2: Run it, watch it fail**

```bash
node --test test/api.importSpaceshipToken.test.js
```

Expected: FAIL — no `tokenWidth` on the ship job at all.

- [ ] **Step 3: Extend `queueImport` with conditional spreads only**

`server.js:361-382`. `kind: item.kind` is already there (G7); only these are new:

**`queueImport` receives the raw manifest entry, not an `itemView`.** `manifestItemsFrom` (`server.js:188-194`) builds each item as `{ ...entry, folderPath }`, so every manifest field is on the object directly — and that means `item.gridWidth` (3) and `item.tokenWidth` (1728) are sitting **side by side** on it. Read the grid pair. Do **not** reach for `item.tokenHexes`; that is `itemView`'s projection and is not present here.

```js
    const kind = kindOf(KINDS, item);
    // Grid units on the wire. This item is a spread manifest entry, so it
    // carries BOTH pairs: gridWidth/gridHeight are the hex count Foundry sets
    // prototypeToken.width from, and tokenWidth/tokenHeight are the rendered
    // canvas in PIXELS. They sit next to each other and reading the wrong one
    // sends 1728 where 3 was meant.
    const gw = item.gridWidth;
    const gh = item.gridHeight ?? item.gridWidth;
    const job = {
        // … every existing field, unchanged, `kind: item.kind` included …
        ...(kind.foundryActorType ? { actorType: kind.foundryActorType } : {}),
        ...(Number.isInteger(gw) ? { tokenWidth: gw, tokenHeight: gh } : {}),
        status: 'queued',
        queuedAt: Date.now(),
    };
```

**Conditional spread, not `null` defaults.** An NPC job's key set stays byte-identical to today's, which is the whole reason `test/importerContract.test.js`'s existing three assertions pass unchanged.

Do **not** map `Ship type` into `role`. The module writes `role` onto a Lancer NPC field, and a "Cargo ship" landing in an NPC role slot is worse than an empty one.

- [ ] **Step 4: Run it**

```bash
node --test test/api.importSpaceshipToken.test.js test/importerContract.test.js
```

Expected: both pass — the new file green, and the contract file's original three assertions untouched.

- [ ] **Step 5: Write the failing reconcile test (port 5230)**

`test/api.reconcileKinds.test.js` — this guards the one place existing data can actually be destroyed:

```js
// Import one NPC and one ship (both in importedIndex).
// POST /importer/reconcile {entries:[npcEntry]} with NO kinds
//   -> the NPC is reconciled and THE SHIP IS STILL IMPORTED.
//      <- the data-loss guard. The shipped module scans NPC actors only; its
//         report must not un-import a ship it never looked for.
// POST /importer/reconcile {entries:[npcEntry], kinds:['npc','spaceship']}
//   -> the ship IS dropped (a module that scanned both and found nothing is
//      authoritative).
// An itemId no longer in the manifest is pruned in both cases.
// `tracked` in the response matches importedIndex.size.
```

- [ ] **Step 6: Run it, watch the ship get destroyed**

```bash
node --test test/api.reconcileKinds.test.js
```

Expected: the first assertion FAILS — `reconcile`'s wholesale prune at `server.js:432-434` deletes every id the reporter did not mention, so the first reconcile after a ship import silently un-imports every ship and the grid re-offers them.

- [ ] **Step 7: Fix `reconcile`**

```js
/** entries: [{ itemId, actorId, actorUuid }] currently flagged in the world.
 *  kinds:   which item kinds this reporter actually looked for.
 *
 * A module that does not say claims 'npc' alone - the only kind that existed
 * when it shipped - so a spaceship it has never heard of survives its report
 * instead of being deleted. This is additive to a request body rather than an
 * alteration of a response, so it respects the contract doc's "add a route
 * rather than altering one" rule without needing a new route.
 */
function reconcile(entries, kinds) {
    const claimed = Array.isArray(kinds) && kinds.length
        ? new Set(kinds) : new Set(['npc']);
    const kindById = new Map(loadManifest().map((i) => [i.id, i.kind || 'npc']));
    const seen = new Set();
    for (const { itemId, actorId, actorUuid } of entries) {
        if (!itemId) continue;
        seen.add(itemId);
        const prior = importedIndex.get(itemId);
        importedIndex.set(itemId, {
            actorId, actorUuid, importedAt: prior?.importedAt ?? Date.now(),
        });
    }
    for (const itemId of [...importedIndex.keys()]) {
        if (seen.has(itemId)) continue;
        const k = kindById.get(itemId);       // undefined = the item is gone entirely
        if (k === undefined || claimed.has(k)) importedIndex.delete(itemId);
    }
    saveIndex();
}
```

The route (`server.js:2493-2504`) passes `body.kinds`.

- [ ] **Step 8: Run it**

```bash
node --test test/api.reconcileKinds.test.js
```

Expected: all pass, including that an old module's report leaves ships alone.

- [ ] **Step 9: Document the contract**

Append to `docs/foundry-importer-contract.md`'s `GET /importer/pending` block:

> **Optional fields, present only when the source generator recorded them.** A module that does not know these keys must ignore them; a job that lacks them behaves exactly as before.
>
> - `actorType` — the Foundry Actor type to create (`"npc"`, `"deployable"`). Absent ⇒ the module's existing default. **A module that does not recognise the value must fall back to its default rather than fail** — the ship type is a configured guess, not a verified one.
> - `tokenWidth`, `tokenHeight` — the prototype token's footprint in **grid units**, integers ≥ 1. Absent ⇒ 1×1. A Lancer spaceship is 1, 2, 3 or 5 hexes wide. When the two differ the module should also set `texture.scaleX`/`scaleY` to fit and leave `lockRotation` false.
> - `role` and `faction` are NPC trait names and are `null` for kinds that have no such traits. Do not substitute another trait into them.
>
> Until the module is bumped, a spaceship imports as a 1×1 actor of the module's default type with correct art — degraded, never wrong.

And to `POST /importer/reconcile`:

> - `kinds` (optional array of strings) — the item kinds this report covers. Omitted ⇒ `["npc"]`, so a module that only scans NPC actors cannot un-import a spaceship it never looked for.

- [ ] **Step 10: Run the suite and commit**

```bash
node --test --test-concurrency=8 "test/*.test.js"
git add server.js docs/foundry-importer-contract.md test/
git commit -F - <<'MSG'
feat: import a spaceship at the size it actually is

A Lancer ship is 1, 2, 3 or 5 hexes wide and nothing in the import payload
carried size. The numbers come off the manifest entry's gridWidth/gridHeight,
which are hex counts - NOT its tokenWidth/tokenHeight, which are the rendered
canvas in pixels. The design doc named the pixel pair; for a large hull that
would have set a Foundry token 1728 hexes wide.

Every new field is a conditional spread, so an NPC job's key set is byte
identical to yesterday's and the three existing contract assertions did not
have to be touched.

reconcile could destroy real data and now cannot. It deleted every imported id
the reporter did not mention, and the shipped Foundry module scans NPC actors
only - so the first reconcile after a ship import silently un-imported every
ship and the grid re-offered them. A report that does not say which kinds it
covers is now taken to cover 'npc' alone, which is exactly what the module in
the wild means.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019AYPnwSrCWF7pppwUnA8pq
MSG
```

---

### Task 5: The client seam — a `vocab` parameter, three literals, no new behaviour

*(Design phase P5. First part of `REMAINING-WORK.md` Task 7.)*

**Files:**
- Modify: `public/app.js` — `rerollableForItem` (`:118`), `traitCascade` (`:149`), `rerollNeedsConfirm` (`:150`), `traitVocab`/`vocabFor`/`ensureVocab`, the three banner literals (`:1698`, `:1708-1710`, `:1746`), `el.model3dPanel` (`:1099`), `el.detailSub` (`:963`)
- Modify: `public/index.html` (`:29` banner copy)
- Modify: `test/ui.batchBanner.test.js` — **a genuine contract change**, updated in this same commit
- Create: `test/ui.kindVocab.test.js` (port **5231**)

**Interfaces:**
- Consumes: `itemView`'s `supports` field (Task 2), `/api/npc-tables?kind=` (Task 3).
- Produces: `rerollableForItem(item, vocab = createState)`, `traitCascade(trait, vocab = createState)`, `rerollNeedsConfirm(trait, vocab = createState)`, `const traitVocab = { npc: createState, spaceship: shipCreateState }`, `vocabFor(kind)`, `ensureVocab(kind)`.

**This is the riskiest client edit, and the design is engineered around one specific hazard.** `rerollableForItem`, `traitCascade` and `rerollNeedsConfirm` read a free variable literally named `createState`, and `test/ui.rerollConfirm.test.js:64-81` lifts those functions out of the served source by brace-matching and **injects a variable of exactly that name**. An optional trailing parameter defaulting to `createState` keeps all 18 of that file's assertions passing: the lift injects `createState`, the default binds to it, and nothing about the existing call shape changes.

- [ ] **Step 1: Write the failing seam test (port 5231)**

`test/ui.kindVocab.test.js`, source-assertion style matching `ui.batchBanner`:

```js
// Lift rerollableForItem with ONE argument (the createState-injection style
//   ui.rerollConfirm.test.js uses) -> it still returns the NPC lists. This
//   proves the default parameter did not break the existing lift contract.
// Lift it again: rerollableForItem({hasRawTraits:true}, SHIP_STATE) -> ship lists.
// Lift traitCascade: traitCascade('Ship type', SHIP_STATE) walks the ship
//   dependents map and orders by the ship overrideTables.
// assert.match(js, /function rerollableForItem\(item, vocab = createState\)/)
//   <- pins the seam itself, so a future refactor that drops the default
//      breaks here loudly instead of breaking ui.rerollConfirm mysteriously.
// assert.match(js, /const traitVocab = \{/) and vocabFor falls back to
//   createState for an unknown kind.
// assert.doesNotMatch(js, /renderShipDetailTraits|renderShipRegenPanel/)
//   <- the no-duplication rule, mechanically enforced.
```

- [ ] **Step 2: Run it, watch it fail**

```bash
node --test test/ui.kindVocab.test.js
```

Expected: the `assert.match` on the seam signature fails — the parameter is not there yet.

- [ ] **Step 3: Add the seam**

```js
function rerollableForItem(item, vocab = createState) {
  return item.hasRawTraits ? vocab.rawRerollableTraits : vocab.rerollableTraits;
}
function traitCascade(trait, vocab = createState) { /* … vocab.traitDependents, vocab.overrideTables … */ }
function rerollNeedsConfirm(trait, vocab = createState) { /* … traitCascade(trait, vocab) … */ }

const traitVocab = { npc: createState, spaceship: shipCreateState };
function vocabFor(kind) { return traitVocab[kind] || createState; }
```

Call sites: `openDetail:987` → `rerollableForItem(item, vocabFor(item.kind))`; the reroll handler (`:2977-2996`) and the Set… handler (`:3018-3039`) pass `vocabFor(item.kind)` into `rerollNeedsConfirm`/`confirmReroll`.

**`traitControlCells(trait, rerollable)` (`:904`) already takes the list as a parameter — zero change.** `test/ui.traitColumns.test.js` and `test/ui.setTraitPicker.test.js` stay untouched, and that is deliberate.

- [ ] **Step 4: Add lazy vocabulary loading**

`app.js:3054` fetches `/api/npc-tables` once at bootstrap. **Keep that** — it fills `createState`, and NPC-only users pay exactly one request as today. Add `ensureVocab(kind)`, called from `selectCategory(id)` (`:479`) before `refreshItems()` so a ship's detail sheet always has its lists, and from `switchTab('shipcreate')`.

- [ ] **Step 5: Fix the three banner literals**

1. `app.js:1698` — `state.category === 'npc'` → `state.category === (job.kind ?? 'npc')`; `announceBatchComplete(count, ids)` gains a `kind`, sourced from `/api/create-status`'s new `kind` field.
2. `app.js:1746` — `await selectCategory('npc')` → `await selectCategory(job.kind ?? 'npc')`.
3. `app.js:1708-1710` + `index.html:29` — `'1 new NPC finished generating.'` / `Show new NPCs` become kind-aware via `CATEGORY_LABELS`, exactly the way `regenSubject` (`:1824`) already does it.

Everything else in the banner path is already kind-aware: `regenSubject` reads `CATEGORY_LABELS`, and the regen banner's Show handler (`:1870-1877`) already navigates by `target.kind`.

- [ ] **Step 6: Update `ui.batchBanner.test.js` — a real contract change**

The banner wording changes, so its assertions change. Update them to the new `CATEGORY_LABELS`-driven text and **keep the "silent on zero" assertion exactly as it is.** This is the one existing test file this task is permitted to touch, and it must move in the same commit as the code.

- [ ] **Step 7: Remove the last two hard literals**

- `el.model3dPanel.hidden = item.kind !== 'npc'` (`:1099`) → `!item.supports?.model3d`, falling back to `item.kind === 'npc'` when the field is absent (a stale server).
- `el.detailSub` (`:963`) gains the two ship traits, still `.filter(Boolean)`-guarded so an NPC's line is unchanged:

```js
el.detailSub.textContent = [item.roleCategory, item.traits?.Role,
    item.traits?.['Ship type'], item.traits?.Size,
    factionDisplayName(item.traits?.Faction)].filter(Boolean).join(' — ');
```

- [ ] **Step 8: Run the untouchable files, then everything**

```bash
node --test test/ui.rerollConfirm.test.js test/ui.traitColumns.test.js \
            test/ui.setTraitPicker.test.js test/ui.newBadge.test.js \
            test/ui.regenBanner.test.js test/ui.kindVocab.test.js
node --test --test-concurrency=8 "test/*.test.js"
```

Expected: **every one of the first five passes unchanged** — if `ui.rerollConfirm` goes red the default parameter is wrong, and the fix is the default, not the test. Then the suite green with `ui.batchBanner` on its updated assertions.

- [ ] **Step 9: Commit**

```bash
git add public/app.js public/index.html test/ui.kindVocab.test.js test/ui.batchBanner.test.js
git commit -F - <<'MSG'
refactor: a trait vocabulary the detail sheet can pick per kind

Ship traits are not NPC traits, so the lists the detail sheet reads have to
vary. Three functions read a free variable literally named createState, and
ui.rerollConfirm.test.js lifts them out of the served source and injects a
variable of exactly that name - so the vocabulary arrives as an optional
trailing parameter defaulting to createState, and all eighteen of that file's
assertions pass untouched. traitControlCells already took its list as a
parameter and did not change at all.

Three banner literals said 'npc' where they meant the finished job's kind. The
wording change is a real contract change and ui.batchBanner.test.js moves with
it in this commit.

ui.kindVocab.test.js pins the seam's signature, so a later refactor that drops
the default breaks there loudly rather than breaking ui.rerollConfirm
mysteriously - and asserts no renderShipDetailTraits has appeared.

No NPC-visible behaviour changes here.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019AYPnwSrCWF7pppwUnA8pq
MSG
```

---

### Task 6: The Create Spaceship tab and the Tables kind select

*(Design phase P6. The rest of `REMAINING-WORK.md` Task 7 — the largest single piece.)*

**Files:**
- Modify: `public/index.html` (+95 — 5th tab button, `#tab-shipcreate` section after `:145`, `#tables-kind` select at `:177`)
- Modify: `public/app.js` (+280 — `shipCreateState`/`elShipCreate` block after the Create-NPC block at `~:2750`; `tablesState.kind` and its 8 call sites)
- Modify: `public/style.css` (+25)
- Create: `test/ui.shipCreate.test.js` (port **5232**)

**Interfaces:**
- Consumes: `POST /api/create`, `GET /api/ship-catalogue`, `GET /api/trait-options?kind=spaceship`, `GET /api/create-presets?kind=spaceship` (Task 3); `vocabFor`/`ensureVocab` (Task 5).
- Produces: `shipCreateState`, `elShipCreate`, `shipCreateRequestBody() -> {kind:'spaceship', count, seed, name, overrides[], …}`, `sizeBlockReason(sizeBullet, shipTypeSlug) -> string|null`.

**Deliberately parallel, not generic.** Making the existing Create tab (`app.js:1894-2750`, ~850 lines) and Tables tab (`:3067-3621`, ~550) kind-parameterised would rewrite ~1,400 lines to avoid ~230 lines of duplication in a form whose field set is genuinely different — and it would break nine `ui.*.test.js` files by design. Revisit the abstraction at the third kind.

**Share every pure helper:** `populateOverrideValues` (`:2116`), `filterTraitOptions` (`:2095`), `traitScopeNote` (`:2016`), `createRequestBody`'s shape, `pollCreateJob` (`:2454`), `setPresetStatus` (`:2608`).

- [ ] **Step 1: Write the failing form test (port 5232)**

`test/ui.shipCreate.test.js`:

```js
// /index.html has data-tab="shipcreate", #tab-shipcreate, and the ids
//   create-ship-count, create-ship-seed, create-ship-type, create-ship-size,
//   create-ship-theme.
// #tab-shipcreate contains NO create-ship-pronouns and no unarmed control.
// /app.js defines shipCreateState and elShipCreate, and switchTab registers
//   'shipcreate' in its lazy-load block.
// The ship submit posts /api/create with kind:'spaceship' - a lifted
//   shipCreateRequestBody() returns {kind:'spaceship'} and an overrides array
//   carrying 'Ship type', 'Size' and 'Theme'.
// Lift sizeBlockReason: sizeBlockReason(hugeBullet, 'patrol') is truthy - a
//   patrol boat rolls `small` only - while sizeBlockReason(smallBullet,
//   'patrol') is null.
```

- [ ] **Step 2: Run it, watch it fail**

```bash
node --test test/ui.shipCreate.test.js
```

Expected: FAIL — no `#tab-shipcreate` in the served HTML.

- [ ] **Step 3: Add the fifth tab**

`public/index.html:12-17`:

```
Import Generated Art | Create NPC | Create Spaceship | Trait Imports | Tables
```

`switchTab` (`app.js:1608-1638`) is data-driven off `data-tab`; register `shipcreate` alongside `create` in the lazy-load block at `:1623-1637`. No router, no hash — unchanged.

**No new browsing surface.** The kind switch is the existing category button row (`app.js:462-490`), which already renders one button per `/api/categories` entry. Selecting "Spaceships" re-points `state.category` and the grid, filters, sort, detail sheet, import, delete and seen all already work.

- [ ] **Step 4: Build the form**

| field | control | wire |
|---|---|---|
| Count | number | `count` |
| Seed | number, blank = random | `seed` |
| Name | text, single-ship only | `name` |
| **Ship type** | `<select>` | pinned override row `{table:'Ship type', value:<bullet>}` |
| **Size** | `<select>`, **gated by Ship type** | pinned override row `{table:'Size', value:<bullet>}` |
| **Theme** | `<select>` | pinned override row `{table:'Theme', value:<bullet>}` |
| further overrides | the existing add-a-row UI | `overrides[]` |
| ComfyUI server | text | `server` |
| No portrait / No token / Keep raw token | checkboxes | `noPortrait` / `noToken` / `keepRawToken` |
| Dry run | button | `dryRun` |

**No Pronouns, no Unarmed.** The three promoted fields are **pinned, non-removable override rows** on the existing `renderOverrideRows` machinery, so their values come from `/api/trait-options?kind=spaceship` and reach the generator through the same `--set-trait Table=<verbatim bullet>` path. Nothing new is invented on the wire.

- [ ] **Step 5: Implement Type→Size gating**

The ship analogue of `pronounBlockReason` (`app.js:2050`) / `clearOverridesBlockedByPronouns` (`:2364`). `sizeBlockReason(sizeBullet, shipTypeSlug)` reads `/api/ship-catalogue` and greys the bands that type may not roll, clearing a now-illegal Size when the Type changes.

**Read the real shape (G4):** `types[]` entries are `{slug, name, sizes: ['small', …], folder}` — `sizes` there is an array of band names, as expected. The top-level `sizes` is an **array of objects** keyed by `sizeBand`, not a map; index it yourself:

```js
const bandInfo = Object.fromEntries(catalogue.sizes.map((s) => [s.sizeBand, s]));
```

Without the catalogue the selects go ungated and the generator refuses an impossible pairing after the job is queued — degraded but not broken, which is why the catalogue is phase 6 rather than phase 1.

- [ ] **Step 6: Add `tablesState.kind` and its call sites**

`app.js:3067` plus a `<select id="tables-kind">` at `index.html:177`. Append `?kind=` / add `kind` to the body at: `loadTables` (`:3095`), `refreshOdds` (`:3342`), `toggleBullet` (`:3363`), `setBulletWeight` (`:3436`), `loadPresets` (`:3458`), the preset apply POST (`:3591`), and the two export `href`s (`:3489`, `:2694`).

Changing the kind clears `tablesState.selectedTable`, `odds` and `pendingPreset`, then re-runs `loadTables()`. `lib/tableBullets.js`, `lib/tableGroups.js`, `lib/presets.js` and `lib/traitOptions.js` need **no change at all** — the server does every switch.

- [ ] **Step 7: Polish the list view and the CSS**

- `render()` (`:652`) adds `traits['Ship type']` / `traits.Size` to the same `.filter(Boolean)` composition — three lines. **It must not disturb the badge if/else chain (`:703-737`)**, which `test/ui.newBadge.test.js:58` pins as an independent `if`, not an `else if`.
- A small hex badge (`1◇ / 2◇ / 3◇ / 5◇`) from `item.tokenHexes`, since footprint is a ship's most map-relevant fact.
- `public/style.css` — ship portraits are 3:2 landscape, not square: `.card--spaceship .thumb { aspect-ratio: 16/9 }`.
- Empty-state copy naming `generate-npc.py` (`index.html:73`, `app.js:657`, `:2829`) becomes kind-aware.

- [ ] **Step 8: Run the suite and commit**

```bash
node --test test/ui.shipCreate.test.js test/ui.newBadge.test.js
node --test --test-concurrency=8 "test/*.test.js"
```

Expected: both named files pass — `ui.newBadge` unchanged — then the whole suite green.

```bash
git add public/ test/ui.shipCreate.test.js
git commit -F - <<'MSG'
feat: a Create Spaceship tab, and a kind switch on the Tables page

Deliberately a second form rather than one parameterised form. Making the
existing Create and Tables tabs generic would rewrite about fourteen hundred
lines to avoid two hundred and thirty of duplication, in a form whose fields
genuinely differ - no pronouns, no unarmed, and a Ship type that gates Size -
and it would break nine ui.*.test.js files by design. The third kind is when
that trade changes.

Ship type, Size and Theme are pinned override rows on the machinery that
already exists, so their values are verbatim bullets travelling the same
--set-trait path every other override takes. Nothing new on the wire.

Browsing needed no new surface at all: the category button row was already the
kind switch.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019AYPnwSrCWF7pppwUnA8pq
MSG
```

---

### Task 7: The parity tail

*(Design phase P7. Optional — the feature is usable without it.)*

**Files:**
- Modify: `server.js` — `?kind=` on `/api/trait-candidates`, `/api/trait-image`, `POST /api/trait-candidates/import` (`:2412-2467`); `insertBulletIntoTables` (`:1476`) targets `kind.tables`
- Modify: `lib/tableGroups.js` (+12 — an optional ship group list)
- Modify: `docs/known-issues.md` (+20), `README.md` (+25)
- Modify: `docs/superpowers/plans/2026-09-07-spaceships-and-trait-fixes.md` — delete the stale port-collision note (G8)

- [ ] **Step 1: Make the three candidate routes kind-aware**

`?kind=` / `body.kind` → `kind.stagedImportsDir`, `kind.stagedRefsDir`, and `insertBulletIntoTables` targeting `kind.tables` instead of `NPC_TABLES_PATH` unconditionally.

- [ ] **Step 2: Give ship tables a group list**

`lib/tableGroups.js` — unlisted tables already fall to the `Other` bucket (`:13-19`), so this is cosmetic ordering only.

- [ ] **Step 3: Record the two hazards in `docs/known-issues.md`**

- The `## Backdrop` collision: both tables files carry that heading, which is why table identity is `(kind, table)` on the wire and why the two staged-imports directories are siblings rather than nested.
- **`SEEN_VERSION` must never be bumped** as part of adding a kind. `ensureSeenLoaded` reseeds the entire library as seen on a mismatch, which would silently mark every existing NPC and every ship already-looked-at.

- [ ] **Step 4: Update `README.md` and delete the stale note (G8)**

Document the eleven new config keys and the ship tab. In the handoff plan, remove known-issue 2's claim of port collisions on 5203 and 5218 — `api.traitImage` is on 5204 and `api.createPresets` on 5219, and no file pair shares a port today.

- [ ] **Step 5: Run the suite and commit**

```bash
node --test --test-concurrency=8 "test/*.test.js"
git add server.js lib/tableGroups.js docs/ README.md
git commit -F - <<'MSG'
feat: ship trait staging, and the notes the next reader needs

The staged-imports directories are siblings rather than nested because
listStagedFiles reads *.json at the top level of its own directory, and
because both tables files carry a '## Backdrop' - a staged candidate's table
name only means something paired with the file it came from.

Recorded in known-issues: that collision, and that SEEN_VERSION must never be
bumped to add a kind. ensureSeenLoaded reseeds the whole library as seen on a
version mismatch, so a bump would silently mark every existing NPC and every
ship as already looked at.

The handoff plan's note about two colliding test ports is stale - they were
moved to 5204 and 5219 and no pair shares a port now.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019AYPnwSrCWF7pppwUnA8pq
MSG
```

---

## Acceptance for the whole plan

```bash
cd G:/GIT-REPOS/lancer-npc-import-gui/.claude/worktrees/ultracode-features
node --test --test-concurrency=8 "test/*.test.js"   # 422 baseline + ~9 new files, 0 failing
```

Then, against a real generator and a real ComfyUI, by hand:

1. Start the server with `generateSpaceshipScript` pointed at the merged `generate-spaceship.py`.
2. **Create Spaceship** → pick a carrier, size `huge`, count 1 → the run finishes and the ship appears in the grid **with a New badge**.
3. Switch the category row to **Spaceships** → the ship is there, its card shows Ship type and Size, and the detail sheet's sub-line reads `<Ship type> — <Size>`.
4. **Re-roll `Weapon`**, then **Set `Size`** → both values update on the sheet **without a refresh**, the regenerating pill clears itself, and the second edit **keeps the first** (this is the bug the parallel work fixed; ships inherit the fix rather than the bug).
5. **Regenerate** → the image reflects both accumulated edits.
6. **Import to Foundry** → the files land under `FoundryData/LancerSpaceships/Carriers/<Name>/`, and the pending job carries `tokenWidth: 5, tokenHeight: 3` — **grid units, not 1920×1152**.
7. Run `/importer/reconcile` from the **old** module (no `kinds` in the body) → **the ship is still imported.**
8. Confirm no NPC behaviour moved: create an NPC, re-roll one of its traits, import it.

**If step 6 shows 1920, stop — G1 was not applied**, and every ship on the map is the size of a continent.
