# Spaceship support in `lancer-npc-import-gui` — implementation design

**Repo A** (this design's target) = `G:/GIT-REPOS/lancer-npc-import-gui/.claude/worktrees/ultracode-features`
**Repo B** (generator) = `G:/GIT-REPOS/lancer-art-generator/.claude/worktrees/ultracode-spaceships`

All bare `server.js:N` / `public/app.js:N` refs are Repo A. Verified against the working trees on 2026-09-06.

---

## 0. What already exists, and what the state of Repo B changes

Two facts from the trees that the design turns on:

1. **The browse half of the GUI is already kind-generic.** `/api/categories` (`server.js:1665-1672`) groups the manifest by `item.kind` with no literal anywhere; `/api/items` (`server.js:1674-1682`) filters `item.kind === category`; `itemView` (`server.js:1552`) puts `kind` on the wire; `queueImport` (`server.js:371`) puts it on the Foundry wire; `CATEGORY_LABELS` at `public/app.js:3` **already reads** `{ npc: 'NPCs', mech: 'Mechs', spaceship: 'Spaceships' }`. A manifest entry with `"kind": "spaceship"` today produces a working category button, grid, detail sheet, import, delete, and New tag.

2. **Repo B is further along than the brief implies.** `ship_policy.py` (676 lines) already exists and is the ship domain model:
   - `SIZE_BANDS` (`ship_policy.py:106-135`) — four bands with **`hexes: 1 / 2 / 3 / 5`**, explicitly described as "width in Foundry grid hexes". This is the token-footprint number, already authored, already tested (`test/test_ship_policy.py`).
   - `SHIP_TYPES` (`ship_policy.py:215-262`) — ten slugs with display names and the size bands each may roll (`sizes_for`, `:266`).
   - `EQUIPMENT_TABLES = ("Weapon", "Shield generator", "Launch catapult", "Command bridge")` (`ship_policy.py:72-77`), `filter_by_ship_policy` (`:523`), `roll_equipment` (`:619`), `armament_sentence` (`:640`), `bridge_sentence` (`:666`).
   - There is **no** `generate-spaceship.py` yet and **no** entry mints `kind: "spaceship"` (`generate-npc.py:4485` is still the only `kind` literal in the generator).

So the ship trait vocabulary this design has to accommodate is concrete: `Ship type`, `Size`, `Theme`, `Weapon`, `Shield generator`, `Launch catapult`, `Command bridge`, `Backdrop`, plus whatever livery/markings tables land. Nothing about it is shaped like Pronouns, Hair, or Headgear.

---

## 1. Entity-kind abstraction — the decision

### Decision

**Generic on the data plane, parallel on the generator plane.**

- **Server:** one registry, `lib/kinds.js`, resolves *per kind* the generator script, tables file, presets dirs, Foundry subdir, and a `supports` capability set. Every existing kind-coupled route grows an optional `?kind=` / `body.kind` defaulting to `'npc'`. The four hard `item.kind !== 'npc'` refusals (`server.js:700`, `:822`, `:1929`, `:1995`) become `supports.X` lookups.
- **Client:** the Import tab is already the entity browser — reuse it verbatim, category button = kind switch. Add **one** new tab (Create Spaceship) as a parallel `shipCreateState`/`elShipCreate` block, and **one** kind `<select>` on the Tables tab. Do **not** parameterise `render()`, `openDetail()`, `traitControlCells()`, `renderRegenPanel()`, or the Create-NPC block.

### Justification against the real cost

The generic-abstraction alternative would rewrite the Create tab (`public/app.js:1894-2750`, ~850 lines) and the Tables tab (`public/app.js:3067-3621`, ~550 lines) into kind-parameterised forms, add a per-kind panel registry to `openDetail` (`:955`), and add per-kind card fields to `render()` (`:652`). That is ~1,400 lines rewritten to avoid ~300 lines of duplication in a second create form whose field set is genuinely different (no Pronouns, no `--unarmed`, no `--keep-raw-token` semantics tied to a human token crop; instead Ship type gating Size).

It also breaks tests **by design**. Nine `ui.*.test.js` files assert on the literal served text of `app.js` or lift top-level functions out of it by brace-matching:
- `test/ui.rerollConfirm.test.js:64-81` — `liftFunction(js, name, createState, helpers)` injects a free variable **literally named `createState`**, then lifts `rerollableForItem` (`:118`, `:134`), `traitCascade` (`:149`, `:270`, `:299`, `:340`) and `rerollNeedsConfirm` (`:150`, `:341`).
- `test/ui.traitColumns.test.js:38-61` and `test/ui.setTraitPicker.test.js:63-86` lift `traitControlCells` and the picker helpers the same way.
- `test/ui.newBadge.test.js:35-58` regex-pins `item.isNew`, `'badge new'`, and that the New badge is an independent `if`, not an `else if`.

Any rename or re-shape of those functions is a legitimate contract break needing re-review, not a mechanical fix. The design below is engineered so **every one of those tests passes unchanged** (see §3.2 for the exact seam).

The counter-argument to parallelism — duplication rot — is bounded by where the duplication lands: the second create form is ~230 lines of form wiring that shares `populateOverrideValues` (`app.js:2116`), `renderOverrideRows`' row shape, `createRequestBody`'s POST target, `pollCreateJob` (`:2454`) and the whole `createJobs` machine on the server. Revisit the abstraction at the third kind (Mechs), which `CATEGORY_LABELS` already anticipates.

### Migration path for existing data — zero migration, by construction

| Store | Where | What changes | Migration |
|---|---|---|---|
| **Manifest** `.generated-npcs.json` | Repo B root; key = absolute folder path (`server.js:187-193`) | **One manifest holds both kinds.** Ship entries are new keys with `"kind": "spaceship"`; NPC entries are byte-identical. `manifestItemsFrom` only requires `entry.id` (`server.js:190`). | **None.** No rewrite, no version stamp, no backfill. |
| **`.imported.json`** | beside `server.js` (`server.js:345`); `Map<itemId, {actorId, actorUuid, importedAt}>` | Nothing. Keys are opaque item ids; `npc-<slug>-<seed>` and `ship-<slug>-<seed>` cannot collide. `completeJob` (`:398`) and `saveIndex` (`:352`) are kind-blind. | **None.** |
| **Seen index** `.npc-seen.json` | `path.dirname(config.npcManifestPath)/.npc-seen.json` (`server.js:467`) | Nothing. `unseenIds()` (`:671`) is already across all kinds; `markSeen` (`:625`) filters against the whole manifest; newness is set-absence (`server.js:462-490`). Ships generated after the seed are absent from the set and therefore correctly New. | **None — and `SEEN_VERSION` must stay `1`** (`server.js:478`). `ensureSeenLoaded` (`:500`) reseeds the *entire library as seen* on a version mismatch, so bumping it would silently mark every existing NPC and every ship already-looked-at. This is the single most dangerous accidental change in the whole project; call it out in review. |
| **Tables presets** | `PRESETS_DIR` = `prompts/presets` (`lib/paths.js:39-40`) | NPC presets stay exactly where they are. Ship presets go in `presets/spaceship/`. `listPresets` filters `.endsWith('.json')` (`lib/presets.js:112`), so a subdirectory is invisible to the NPC listing — the same trick `listStagedFiles` uses (`lib/paths.js:51-57`). | **None.** |
| **Create-form presets** | `CREATE_PRESETS_DIR` = `presets/create` (`lib/paths.js:48-49`); stamped `kind: 'create-form'` (`lib/createPresets.js:20-27`) | Ship create presets get `presets/spaceship/create/` and a **different discriminator**, `kind: 'create-form-spaceship'`, so a ship preset dropped on the NPC tab's Import button is refused by the existing check rather than half-applied. | **None.** |
| **Foundry world** | `importedIndex` rebuilt by `/importer/reconcile` | See §4.3 — this is the one place existing data *can* be damaged, and it needs a server change to prevent it. | Server change, back-compatible with the shipped module. |

**Single manifest, not two.** A second `spaceshipManifestPath` would force `loadManifest` (`:160`), `findItem` (`:196`), `deleteItem` (`:305`), `copyIntoFoundry` (`:258`) and `SEEN_FILE` (`:467`) — five single-file assumptions — into merge-and-dispatch logic, for no user-visible gain. One library, one manifest, one seen store, one imported index. The config key `npcManifestPath` is retained as the accepted spelling (with `manifestPath` added as a preferred alias) precisely so no existing `config.json` needs editing.

---

## 2. Server changes

### 2.1 `lib/kinds.js` — new, ~140 lines

Pure module, no `fs`, no `spawn`. Takes the derived path set and returns the registry, so it is unit-testable exactly like `lib/paths.js`.

```js
const DEFAULT_KIND = 'npc';

function buildKinds(paths, config) {
  return {
    npc: {
      id: 'npc', label: 'NPCs', subject: 'NPC',
      script: paths.generateNpcScript,
      tables: paths.npcTablesPath,
      presetsDir: paths.presetsDir,
      createPresetsDir: paths.createPresetsDir,
      createPresetDiscriminator: 'create-form',
      stagedImportsDir: paths.stagedImportsDir,
      stagedRefsDir: paths.stagedRefsDir,
      foundrySubdir: config.foundryNpcSubdir,          // 'LancerNPCs'
      foundryActorType: config.foundryNpcActorType,    // '' by default
      supports: { regen: true, setTrait: true, stageTrait: true, model3d: true,
                  traitCandidates: true, tables: true, create: true, odds: true },
      createArgs(o) { /* current server.js:1113-1125, verbatim */ },
    },
    spaceship: {
      id: 'spaceship', label: 'Spaceships', subject: 'spaceship',
      script: paths.generateSpaceshipScript,
      tables: paths.spaceshipTablesPath,
      presetsDir: paths.spaceshipPresetsDir,
      createPresetsDir: paths.spaceshipCreatePresetsDir,
      createPresetDiscriminator: 'create-form-spaceship',
      stagedImportsDir: paths.spaceshipStagedImportsDir,
      stagedRefsDir: paths.spaceshipStagedRefsDir,
      foundrySubdir: config.foundrySpaceshipSubdir,       // 'LancerSpaceships'
      foundryActorType: config.foundrySpaceshipActorType, // 'deployable'  [assumption A5]
      supports: { regen: true, setTrait: true, stageTrait: true, model3d: false,
                  traitCandidates: true, tables: true, create: true, odds: true },
      createArgs(o) { /* §2.4 */ },
    },
  };
}

// kindFor(id) -> registry entry or null.  kindOf(item) -> kindFor(item.kind) ?? kindFor('npc').
// requestKind(url, body) -> body.kind ?? url.searchParams.get('kind') ?? DEFAULT_KIND.
// available(kinds) -> only kinds whose `script` exists on disk (drives /api/categories.supports).
```

`supports.model3d: false` for ships is deliberate for v1: `lib/model3d.js` is generic, but `generate-3d.py` imports `generate-npc.py` for `DEFAULT_MANIFEST` (`generate-3d.py:1452,1456`) and `classify3dFiles` (`lib/model3d.js:59-88`) matches exact deliverable names. Flipping it later is one boolean plus a Repo B change; `public/app.js:1099` (`el.model3dPanel.hidden = item.kind !== 'npc'`) becomes `!item.supports?.model3d` and needs nothing else.

### 2.2 `lib/paths.js` — extend, ~+45 lines

Keep `derivePaths(config)` returning the existing seven keys **unchanged** (so `test/paths.test.js`'s 40 existing assertions stay valid), and add the ship set beside them:

```js
const generateSpaceshipScript = config.generateSpaceshipScript
    || path.join(path.dirname(config.npcManifestPath), 'generate-spaceship.py');
const spaceshipTablesPath = config.spaceshipTablesPath
    || path.join(path.dirname(generateSpaceshipScript), 'prompts', 'scene-and-spaceship-tables.md');
const spaceshipPresetsDir = config.spaceshipPresetsDir
    || path.join(presetsDir, 'spaceship');
const spaceshipCreatePresetsDir = config.spaceshipCreatePresetsDir
    || path.join(spaceshipPresetsDir, 'create');
const spaceshipStagedImportsDir = config.spaceshipStagedImportsDir
    || path.join(path.dirname(spaceshipTablesPath), 'staged-imports-spaceship');
const spaceshipStagedRefsDir = config.spaceshipStagedRefsDir
    || path.join(spaceshipStagedImportsDir, 'refs');
```

Note `spaceshipTablesPath` derives from the **ship** script's dirname, following the same "later paths follow the override" rule the module docstring states (`lib/paths.js:8-10`). The ship staged-imports dir is a *sibling* of the NPC one rather than a subfolder, because `listStagedFiles` (`server.js:1213-1220`) reads `*.json` at the top level of its dir and would otherwise not see it — and because `## Backdrop` exists in both tables files (`prompts/npc-generator-tables.md:2325` vs `prompts/scene-and-spaceship-tables.md:28`), so a candidate bullet's `table` field is only meaningful paired with a file.

### 2.3 Config keys

Added to `DEFAULT_CONFIG` (`server.js:64-107`) and `config.example.json`:

| key | default | meaning |
|---|---|---|
| `manifestPath` | `''` | Preferred alias for `npcManifestPath`. Resolution: `config.manifestPath \|\| config.npcManifestPath`; the startup guard at `server.js:131-137` checks the resolved value. Existing configs keep working untouched. |
| `generateSpaceshipScript` | `''` → derived | Path to `generate-spaceship.py`. |
| `spaceshipTablesPath` | `''` → derived | `prompts/scene-and-spaceship-tables.md`. |
| `spaceshipPresetsDir` | `''` → `presetsDir/spaceship` | Tables presets for the ship tables file. |
| `spaceshipCreatePresetsDir` | `''` → `spaceshipPresetsDir/create` | Create-Spaceship form presets. |
| `spaceshipStagedImportsDir` / `spaceshipStagedRefsDir` | `''` → derived | Ship trait-import staging. |
| `foundrySpaceshipSubdir` | `'LancerSpaceships'` | Import destination subtree under `foundryDataRoot`. |
| `foundryNpcActorType` | `''` | Sent to the Foundry module as `actorType`. Empty by default, so the field is omitted and the NPC payload is unchanged from before this work (R14); set it to `'npc'` to have it emitted. |
| `foundrySpaceshipActorType` | `'deployable'` | **Assumption A5** — see §8. One config line to change if the Lancer system wants something else. |
| `spaceshipOutputRoot` | `''` | When non-empty, passed to the ship generator as `--out-root <path>`; the generator still owns run-folder numbering (`next_run_folder`). Empty = the generator's own `DEFAULT_OUTPUT_ROOT`. **Assumption A3.** |

**Deliberately *not* added: a per-kind `--out` config.** `--out` in `generate-npc.py` (`:3078-3087`, defaulted at `:3236`) names a *run* folder, not a root; a config'd `--out` would pin every ship run to one folder. `--out-root` is the correct shape and is why it is a new ship-only flag rather than a reuse.

### 2.4 Child-process spawn for the ship generator

Same discipline as the five existing sites: `spawn(config.pythonExecutable, args, { cwd: path.dirname(kind.script) })`, no `env` option (so `COMFYUI_OUTPUT_DIR`, read at `generate-npc.py:110`, still reaches the child), stdout+stderr merged into `job.log` for render modes, stdout parsed whole for query modes, exit code 0 the only success signal.

**Create** (`startCreateJob`, argv from `kinds.spaceship.createArgs`):

```
<generateSpaceshipScript>
  --count <n>
  --manifest <resolved manifest path>          # EXPLICIT, unlike the NPC path
  [--out-root <spaceshipOutputRoot>]           # only when configured
  [--seed <int>] [--name <s>]
  [--set-trait "Ship type=<bullet>"] …         # one per override row, incl. Size / Theme
  [--no-portrait] [--no-token] [--keep-raw-token]
  [--server <host:port>] [--dry-run]
```

Passing `--manifest` explicitly is a **deliberate departure** from the NPC create path, which passes none (`server.js:1113-1125`) and therefore silently depends on `config.npcManifestPath === generate-npc.py`'s `DEFAULT_MANIFEST` (`generate-npc.py:100`). That implicit coupling is a latent bug; do not reproduce it in new code. `--pronouns` and `--unarmed` are never emitted for ships.

**Regen / reroll / set-trait** (`startRegenJob`, argv from the kind):

```
<generateSpaceshipScript>
  --regen-manifest <manifest> --regen-id <id> --new-seed <int>
  [--no-token | --no-portrait]
  [--reroll-trait <Table>] [--set-trait <Table>=<value>] [--release <A,B>]
```

Identical to `server.js:713-735` with the script swapped — which is exactly why the argv builder moves into the registry rather than growing an `if`.

**Query modes** (`runTraitOdds` `server.js:1353`, `runTraitChoices` `server.js:1443`): `lib/traitOdds.js:19-24` (`oddsArgs(script, samples)`) and `lib/traitChoices.js:22-32` (`choicesArgs(script, manifest, id, trait)`) already take the script as their first argument. **No change to either module** — the call sites pass `kind.script` instead of `GENERATE_NPC_SCRIPT`. The odds cache (`cacheKeyFor`, `lib/traitOdds.js`) must gain the kind in its key.

### 2.5 Route-by-route

`kind = requestKind(url, body)`, defaulting to `'npc'` everywhere. Every route below keeps its current behaviour byte-for-byte when `kind` is absent, so all 43 existing test files and a stale browser tab keep working.

| Route | Line | Change |
|---|---|---|
| `GET /api/categories` | 1665 | **Additive.** Each entry gains `label` and `supports` from the registry: `{ id, count, label, supports }`. Client keeps `CATEGORY_LABELS` as the fallback. |
| `GET /api/items` | 1674 | **None.** `category` already *is* the kind. |
| `GET /api/unseen`, `POST /api/seen` | 1685, 1697 | **None.** Already all-kinds. |
| `GET /api/image` | 1727 | **None.** |
| `POST /api/import` | 1739 | **None** at the route; `foundryDestFolder` changes underneath it (below). |
| `POST /api/delete` | 1770 | **None.** |
| `POST /api/regenerate` | 1800 | **None** at the route; `startRegenJob` changes. |
| `GET`/`POST /api/model-3d`, `GET /api/model-3d-image` | 1825, 1831, 1846 | The `kind !== 'npc'` refusal at `server.js:822-828` becomes `!kindOf(item).supports.model3d`, with the same message text. Ships are refused, as today. |
| `GET /api/npc-tables` | 1857 | Accepts `?kind=`. Returns that kind's `{tables, rerollable, rawRerollable, dependents}`. The four startup parses (`server.js:976-991`, `:1030-1044`) become a **per-kind map**, built by looping the registry and running `lib/overrideTables.js` (unchanged — it is generic over source text, `lib/overrideTables.js:17-46`) on each `kind.script`. The `OVERRIDE_TABLES_FALLBACK` list (`server.js:968-973`) applies to `npc` only; a ship parse miss yields `[]` (no override dropdown), which is the safe way to be wrong. Route name kept as-is; a cached older page still works. |
| `POST /api/reroll-trait` | 1877 | `rerollableFor(item)` resolves against the item's kind's lists. No new gate. |
| `POST /api/set-trait` | 1919 | `item.kind !== 'npc'` (`:1925-1929`) → `!kindOf(item).supports.setTrait`. `readTraitChoices` spawns `kindOf(item).script`. |
| `GET /api/trait-choices` | 1988 | `item.kind !== 'npc'` (`:1994-1998`) → `supports.setTrait`. Script from the kind. |
| `GET /api/trait-options` | 2036 | `?kind=` → `tableBullets.readTables(kind.tables)`. `lib/traitOptions.js` unchanged. |
| `GET /api/pronouns` | 2048 | **NPC-only, unchanged.** Returns `{subjects: []}` for any non-npc kind rather than 400 — the ship form never calls it, and a 400 in a shared helper is a trap. |
| `GET /api/table-bullets` | 2059 | `?kind=` → `kind.tables`. `lib/tableBullets.js` and `lib/tableGroups.js` unchanged (both take a path / are pure). Ship tables land in `groupTables`' `Other` bucket (`lib/tableGroups.js:13-19`) until a ship group list is added — cosmetic, deferred. |
| `GET /api/table-odds` | 2071 | `?kind=` → `oddsArgs(kind.script, samples)`; cache key gains the kind. |
| `POST /api/table-bullets/toggle`, `/set-weight` | 2077, 2094 | `body.kind` → `kind.tables`. |
| `GET/POST /api/presets`, `/delete`, `/export`, `/import`, `/apply` | 2112-2237 | `?kind=` / `body.kind` → `kind.presetsDir` **and** `kind.tables` (the diff is against that kind's tables file). `lib/presets.js` unchanged — dir is already a parameter. |
| `GET/POST /api/create-presets` + `/delete`, `/export`, `/import` | 2238-2331 | `?kind=` → `kind.createPresetsDir`; `normaliseSettings` gains a schema per discriminator (`lib/createPresets.js:20-27`). |
| `POST /api/create-npc` | 2332 | **Kept as an alias.** Both it and the new `POST /api/create` call one handler; the alias hard-codes `kind: 'npc'`. `test/api.createArgs.test.js` (port 5193) posts to `/api/create-npc` and stays green. |
| **`POST /api/create`** | *new*, ~55 lines | Canonical create route. Reads `body.kind`, validates per-kind (ship: no `pronouns`/`unarmed`; `name` still requires `count === 1`; overrides checked against that kind's `OVERRIDE_TABLES`), then `startCreateJob({ kind, ... })`. Returns 202/409 with a `jobId` into the **same** `createJobs` map. |
| `GET /api/create-status` | 2392 | **None** — one job machine, one status route. `job.kind` added to the response so the client's banner can navigate to the right category (see §3.1). |
| `GET /api/trait-candidates`, `/api/trait-image`, `POST /api/trait-candidates/import` | 2412-2467 | `?kind=` / `body.kind` → `kind.stagedImportsDir`, `kind.stagedRefsDir`, and `insertBulletIntoTables` (`server.js:1476`) targets `kind.tables` instead of `NPC_TABLES_PATH` unconditionally. Phase 7; ships have no import skill yet. |
| **`POST /api/stage-trait`** | *new*, ~45 lines | The staged-edit route from the parallel bug fix — kind-aware from birth. See §5. |
| **`GET /api/ship-catalogue`** | *new*, ~30 lines | Spawns `generate-spaceship.py --ship-catalogue`, caches by script mtime, returns `{types:[{slug,name,sizes[]}], sizes:{band:{hexes,label}}}`. Drives the create form's Type→Size gating. **Assumption A4.** Phase 6; the form degrades to ungated selects without it. |

### 2.6 Non-route server functions

- **`foundryDestFolder`** (`server.js:242-247`) — `config.foundryNpcSubdir` → `kindOf(item).foundrySubdir`. Two-line change; the `<category>/<name>` nesting is unchanged and remains load-bearing (see §8, A6).
- **`queueImport`** (`server.js:360-382`) — see §4.
- **`npcEntriesSnapshot`** (`server.js:1101-1109`) — the `.filter(item => item.kind === 'npc')` at `:1104` becomes `.filter(item => item.kind === jobKind)`, with `jobKind` passed from `startCreateJob`. Without this a ship create job reports `produced: 0`, `producedIds: null`, never calls `forgetSeen` (`:1197`), and the run's own ships arrive without New tags. Rename to `entriesSnapshot(kind)`.
- **`startRegenJob`** (`server.js:697`) — `item.kind !== 'npc'` (`:700-702`) → `!kindOf(item).supports.regen`; `GENERATE_NPC_SCRIPT` → `kind.script` at `:703`, `:713`, `:743`; argv from `kind.regenArgs(...)`. Error text takes the script basename from the kind.
- **`startCreateJob`** (`server.js:1111`) — takes `opts.kind`; script and argv from the registry; snapshot filtered by that kind; `job.kind` recorded.
- **`itemView`** (`server.js:1552`) — `roleCategory` (`:1570-1573`) already guards on `'npc'` and yields `null` for ships; **leave it**. Add three fields: `supports` (from the registry — lets the client stop guessing), `artStale` (from the manifest entry, for §5), and `tokenHexes` (`{w,h}` or null, for the grid badge and for §4). All additive; `test/api.imageLocation.test.js` etc. keep passing.
- **`reconcile`** (`server.js:421-436`) — see §4.3. **The one place existing data is at risk.**

---

## 3. Client changes

### 3.1 Navigation / IA

**No new browsing surface.** The kind switch is the existing category button row (`public/app.js:462-490`), which already renders one button per `/api/categories` entry through `CATEGORY_LABELS`. Selecting "Spaceships" re-points `state.category` and everything downstream — grid, filters, sort, detail sheet, import, delete, seen — already works.

Tabs go from four to five (`public/index.html:12-17`):

```
Import Generated Art | Create NPC | Create Spaceship | Trait Imports | Tables
```

`switchTab` (`app.js:1608-1638`) is data-driven off `data-tab`; register `shipcreate` alongside `create` in the lazy-load block at `:1623-1637`. No router, no hash — unchanged.

Three real literals to fix, all in the banner path:

1. **`app.js:1698`** — `if (tabState.current === 'import' && state.category === 'npc') refreshItems();` → compare against the finished job's kind: `state.category === (job.kind ?? 'npc')`. `announceBatchComplete(count, ids)` gains a `kind` argument, sourced from `/api/create-status`'s new `kind` field.
2. **`app.js:1746`** — `await selectCategory('npc')` → `await selectCategory(job.kind ?? 'npc')`.
3. **`app.js:1708-1710` + `index.html:29`** — `'1 new NPC finished generating.'` / `Show new NPCs` → kind-aware wording via `CATEGORY_LABELS`, exactly the way `regenSubject` (`app.js:1824`) already does it. **`test/ui.batchBanner.test.js` asserts on this text** and must be updated in the same commit; that is a genuine contract change, not a mechanical one.

Everything else in the banner path is already kind-aware: `regenSubject` (`:1824`) reads `CATEGORY_LABELS`, and the regen banner's Show handler (`:1870-1877`) already navigates by `target.kind` with a comment saying so.

### 3.2 Detail view and trait panel — the one seam that matters

`openDetail` (`app.js:955-1034`) needs **no structural change**. It renders `item.traits` generically (`:988-994`); `el.detailSub` (`:963`) composes `roleCategory / Role / Faction`, all of which are `undefined` for a ship and drop out through `.filter(Boolean)`. A ship's sub-line comes free once the ship manifest carries `traits["Ship type"]` and `traits.Size` — add those two to the compose list, still `.filter(Boolean)`-guarded:

```js
el.detailSub.textContent = [item.roleCategory, item.traits?.Role,
    item.traits?.['Ship type'], item.traits?.Size,
    factionDisplayName(item.traits?.Faction)].filter(Boolean).join(' — ');
```

Ship traits differ from NPC traits, so the **vocabulary** must become per-kind. This is the single riskiest client edit, because `rerollableForItem`, `traitCascade` and `rerollNeedsConfirm` read a free variable named `createState` (`app.js:139`, `:168`, `:222-224`) and `test/ui.rerollConfirm.test.js:64-81` injects that exact name into the lifted function.

**The seam: an optional trailing `vocab` parameter defaulting to `createState`.**

```js
function rerollableForItem(item, vocab = createState) {
  return item.hasRawTraits ? vocab.rawRerollableTraits : vocab.rerollableTraits;
}
function traitCascade(trait, vocab = createState) { … vocab.traitDependents … vocab.overrideTables … }
function rerollNeedsConfirm(trait, vocab = createState) { … traitCascade(trait, vocab) … }
```

`liftFunction(js, 'rerollableForItem', STATE)` then calls `rerollableForItem({hasRawTraits:true})`, the default binds to the injected `createState === STATE`, and **all 18 assertions in `test/ui.rerollConfirm.test.js` pass unchanged** — including the lifted-`traitCascade`-as-helper path at `:149-150` and `:340-342`, because `rerollNeedsConfirm` calls the injected helper with `(trait, vocab)` where `vocab` is the same object it was lifted against.

The registry itself is four lines beside `createState`:

```js
const traitVocab = { npc: createState, spaceship: shipCreateState };
function vocabFor(kind) { return traitVocab[kind] || createState; }
```

Call sites: `openDetail:987` → `rerollableForItem(item, vocabFor(item.kind))`; the reroll button handler (`app.js:2977-2996`) and Set… handler (`:3018-3039`) pass `vocabFor(item.kind)` into `rerollNeedsConfirm`/`confirmReroll`. `traitControlCells(trait, rerollable)` (`:904`) already takes the list as a parameter — **zero change**, `test/ui.traitColumns.test.js` and `test/ui.setTraitPicker.test.js` untouched.

`openSetTrait` (`:284`) fetches `/api/trait-choices?id=&trait=` — the server resolves the kind from the item, so the client changes nothing.

**Vocabulary loading.** `app.js:3054` currently fetches `/api/npc-tables` once at bootstrap. Keep that (it fills `createState`, and NPC-only users pay one request as today), and add a lazy `ensureVocab(kind)`:
- called from `selectCategory(id)` (`:479`) before `refreshItems()`, so a ship's detail sheet always has its lists;
- called from `switchTab('shipcreate')`.

`el.model3dPanel.hidden = item.kind !== 'npc'` (`app.js:1099`) → `!item.supports?.model3d` (falling back to `item.kind === 'npc'` if the field is absent, for a stale server). Correct as-is either way; the change just removes the last hard literal.

`ROLE_CATEGORY_KEY` / `SORTERS['role-category']` (`app.js:5-7`, `:525`, `:575`) stay — `roleCategory` is `null` for ships and the sorter degrades to name order. Optionally hide the "Role category" `<option>` (`index.html:59`) when the selected category has no item carrying one; cosmetic, phase 6.

### 3.3 List view

No change. Optional polish, phase 6:
- `render()` (`:652`) prints `traits.Role` and `roleCategory` in the card body; add `traits['Ship type']`/`traits.Size` to the same `.filter(Boolean)` composition — three lines, no restructuring, and it must not disturb the badge if/else chain (`:703-737`) that `test/ui.newBadge.test.js:58` pins as an independent `if`.
- A small hex badge (`1◇ / 2◇ / 3◇ / 5◇`) from `item.tokenHexes`, since footprint is the ship's most map-relevant fact.
- `public/style.css` — ship portraits are wide, not square; a `.card--spaceship .thumb { aspect-ratio: 16/9 }` rule. The only existing kind-ish rule is `.card .role-category` (`style.css:272`).

Empty-state copy naming `generate-npc.py` (`index.html:73`, `app.js:657`, `:2829`) becomes kind-aware wording.

### 3.4 Create Spaceship form — new block, ~230 lines

New `<section class="tab-panel" id="tab-shipcreate" hidden>` after `index.html:145`, and a new `shipCreateState` / `elShipCreate` block in `app.js` after the Create-NPC block (`~:2750`). Deliberately parallel, mirroring `createState` (`:1894`) / `elCreate` (`:1916`), and **sharing every pure helper**: `populateOverrideValues` (`:2116`), `filterTraitOptions` (`:2095`), `traitScopeNote` (`:2016`), `createRequestBody`'s shape, `pollCreateJob` (`:2454`), `setPresetStatus` (`:2608`).

Fields:

| field | control | wire |
|---|---|---|
| Count | number | `count` |
| Seed | number, blank = random | `seed` |
| Name | text, single-ship only | `name` |
| **Ship type** | `<select>`, first-class | pinned override row `{table:'Ship type', value:<bullet>}` |
| **Size** | `<select>`, **gated by Ship type** | pinned override row `{table:'Size', value:<bullet>}` |
| **Theme** | `<select>`, first-class | pinned override row `{table:'Theme', value:<bullet>}` |
| further overrides | the existing add-a-row UI | `overrides[]` |
| ComfyUI server | text | `server` |
| No portrait / No token / Keep raw token | checkboxes | `noPortrait` / `noToken` / `keepRawToken` |
| Dry run | button | `dryRun` |

**No Pronouns, no Unarmed.** The three promoted fields are implemented as *pinned, non-removable override rows* on the existing `renderOverrideRows` machinery, so their values come from `/api/trait-options?kind=spaceship` and their prose reaches the generator through the same `--set-trait Table=<verbatim bullet>` path. Nothing new is invented on the wire.

**Type→Size gating** is the ship analogue of `pronounBlockReason` (`app.js:2050`) / `clearOverridesBlockedByPronouns` (`:2364`): `sizeBlockReason(sizeBullet, shipTypeSlug)` reads `/api/ship-catalogue`'s `types[].sizes` (from `ship_policy.py:266 sizes_for`) and greys the bands that type may not roll, clearing a now-illegal Size when the Type changes. Without the catalogue route the selects are ungated and the generator refuses an impossible pairing after the job is queued — degraded but not broken, which is why the catalogue is phase 6 rather than phase 1.

Submits to `POST /api/create` with `kind:'spaceship'`; polls `/api/create-status` with the existing `pollCreateJob`. Create presets go to `/api/create-presets?kind=spaceship`.

### 3.5 Tables page

Add `tablesState.kind = 'npc'` (`app.js:3067`) and a `<select id="tables-kind">` at `index.html:177`, above `.tables-layout`. Every table call site appends `?kind=` / adds `kind` to the body:

`loadTables` (`:3095`), `refreshOdds` (`:3342`), `toggleBullet` (`:3363`), `setBulletWeight` (`:3436`), `loadPresets` (`:3458`), the preset apply POST (`:3591`), and the two export `href`s (`:3489` tables presets, `:2694` create presets).

Changing the kind clears `tablesState.selectedTable`, `odds` and `pendingPreset`, then re-runs `loadTables()`. `lib/tableBullets.js`, `lib/tableGroups.js`, `lib/presets.js` and `lib/traitOptions.js` need **no changes at all** — the server does every switch. The `## Backdrop` collision between the two files is why table identity is `(kind, table)` on the wire and why the two staged-imports dirs are siblings; record it in `docs/known-issues.md`.

---

## 4. Foundry import

### 4.1 What a ship token needs that an NPC token does not

A Lancer ship is not 1×1. Foundry needs `prototypeToken.width`/`height` in **grid units**, and for a non-square hull a matching `texture.scaleX/scaleY` and `lockRotation: false`. Nothing in the current payload carries size (`server.js:369-381`).

`ship_policy.py:106-135` already authored the number: `SIZE_BANDS[band].hexes` ∈ `{1, 2, 3, 5}`, described in its own comment as "width in Foundry grid hexes", with the 3→5 jump deliberate ("a token that reads as merely a bit bigger than a cruiser sells it short on the map").

**Contract: the generator writes the footprint, the GUI passes it through untouched.** The manifest entry carries

```json
"tokenWidth": 3, "tokenHeight": 2, "sizeBand": "large"
```

as grid units, computed in Repo B from `SIZE_BANDS[band]["hexes"]` and the token canvas aspect. Putting the geometry decision next to the renderer that chose the canvas is the point — the GUI has no business deriving a footprint from a PNG. **Assumption A2.**

### 4.2 `queueImport` — additive only

```js
const kind = kindOf(item);
const job = {
  jobId, itemId: item.id, kind: item.kind, name, callsign,
  role: item.traits?.Role || null,
  faction: item.traits?.Faction || null,
  portraitPath: dataRelative(itemFile(item, 'portrait')),
  tokenPath: dataRelative(itemFile(item, 'token')),
  ...(kind.foundryActorType ? { actorType: kind.foundryActorType } : {}),
  ...(Number.isInteger(item.tokenWidth) ? { tokenWidth: item.tokenWidth } : {}),
  ...(Number.isInteger(item.tokenHeight) ? { tokenHeight: item.tokenHeight } : {}),
  status: 'queued', queuedAt: Date.now(),
};
```

**Conditional spread, not `null` defaults.** An NPC job's key set stays byte-identical to today's, so `test/importerContract.test.js`'s existing three assertions pass unchanged — which is the whole reason the fields are omitted rather than nulled. `actorType` is likewise omitted when the registry has none, so a config that clears it produces today's payload exactly.

`role`/`faction` are NPC trait names and are `null` for a ship (`item.traits.Role` is `undefined`). Do **not** map `Ship type` into `role`: the module writes `role` onto a Lancer NPC field, and a "Cargo ship" landing in an NPC role slot is worse than an empty one.

### 4.3 `reconcile` — the one real data hazard

`reconcile(entries)` (`server.js:421-436`) **deletes every `importedIndex` id the module did not report** (`:432-434`). The shipped Foundry module scans for flagged actors it knows about. If it only claims Lancer `npc` actors — or only actors under `LancerNPCs/` — then the first `/importer/reconcile` after a ship import silently marks every imported ship un-imported, and the grid re-offers them.

Fix, back-compatible with the released module:

```js
function reconcile(entries, kinds) {
  // Which kinds this reporter actually claims. A module that does not say
  // claims 'npc' alone - the only kind that existed when it shipped - so a
  // ship it has never heard of survives its report instead of being deleted.
  const claimed = Array.isArray(kinds) && kinds.length ? new Set(kinds) : new Set(['npc']);
  const kindById = new Map(loadManifest().map((i) => [i.id, i.kind]));
  …
  for (const itemId of [...importedIndex.keys()]) {
    if (seen.has(itemId)) continue;
    const k = kindById.get(itemId);          // null = the item is gone entirely
    if (k === undefined || claimed.has(k)) importedIndex.delete(itemId);
  }
}
```

The route (`server.js:2493-2504`) passes `body.kinds`. An old module sends no `kinds` → NPC behaviour is bit-identical to today, ships are preserved. This is additive to a request body, not an alteration of a response, so it respects `docs/foundry-importer-contract.md`'s "add a route rather than altering one" rule without needing a new route.

### 4.4 `foundryDestFolder` and `copyIntoFoundry`

- **`foundryDestFolder`** (`server.js:242-247`) — subdir from the registry. A ship lands at `<foundryDataRoot>/LancerSpaceships/<category>/<Name>/`. The `<category>` level is `basename(dirname(folderPath))`, so Repo B's ship output tree **must** keep two-level nesting (`<root>/runN/<Category>/<Name>/`) — see A6.
- **`copyIntoFoundry`** (`server.js:258-281`) — **no change**. It copies `item.files`, rewrites the manifest key, and preserves `sortKeysDeep` ordering (`:227`). Entirely kind-agnostic.
- **`completeJob`** (`:398`), `importedIndex`, `saveIndex` — **no change**, all keyed by `itemId`.

### 4.5 `docs/foundry-importer-contract.md`

Append to the `GET /importer/pending` block (currently `docs/foundry-importer-contract.md:37-66`):

> **Optional fields, present only when the source generator recorded them.** A module that does not know these keys must ignore them; a job that lacks them behaves exactly as before.
>
> - `actorType` — the Foundry Actor type to create (`"npc"`, `"deployable"`). Absent ⇒ the module's existing default.
> - `tokenWidth`, `tokenHeight` — the prototype token's footprint in **grid units**, integers ≥ 1. Absent ⇒ 1×1. A Lancer spaceship is 1, 2, 3 or 5 hexes wide. When the two differ the module should also set `texture.scaleX/scaleY` to fit and leave `lockRotation` false.
> - `role` and `faction` are NPC trait names and are `null` for kinds that have no such traits. Do not substitute another trait into them.
>
> Until the module is bumped, a spaceship imports as a 1×1 actor of the module's default type with correct art — degraded, never wrong.

And to `POST /importer/reconcile`:

> - `kinds` (optional array of strings) — the item kinds this report covers. Omitted ⇒ `["npc"]`, so a module that only scans NPC actors cannot un-import a spaceship it never looked for.

---

## 5. Trait accumulation parity

The parallel work introduces staged multi-trait editing on the NPC path: the manifest entry becomes the accumulator, `--set-trait` persists (fixing `generate-npc.py:4273`, where `if rerolled is not None:` skips the override path), a new no-render `--apply-only` mode applies an edit without queueing ComfyUI, `entry["artStale"]` records that traits moved since the last render, and the client gains `renderDetailTraits(item)` plus `startPolling()` in the two trait handlers (`app.js:2996`, `:3039`).

**Ships share that machinery outright. The design's rule: the spaceship path adds no new function to the detail sheet.**

Concretely:

1. **`POST /api/stage-trait`** is written once, kind-aware from birth. Body `{id, table, value?, reroll?}`; it looks the item up, resolves `kindOf(item)`, refuses on `!supports.stageTrait`, and spawns `kind.script` with `--regen-manifest / --regen-id / --apply-only` plus `--set-trait` or `--reroll-trait`. Because the route resolves the kind from the item, **there is never a ship branch in it.** It awaits the child (fast — no ComfyUI) and answers `itemView(findItem(id))`.
2. **`startRegenJob`** stays the on-demand render step for both kinds, already unified by the registry (§2.6). With the entry carrying accumulated traits, a plain `--regen-manifest --regen-id --new-seed` renders exactly the staged entity, for a ship as for an NPC.
3. **`renderDetailTraits(item)`** — the function extracted from `openDetail:987-994` (plus `:963` and `:998-1000`) — renders `item.traits` through `traitControlCells(k, rerollable)`. Its only kind-dependence is the `rerollable` list, which arrives via `vocabFor(item.kind)` (§3.2). **No `renderShipDetailTraits`. Ever.** If a reviewer sees one, the design has been violated.
4. **`artStale`** rides `itemView` as a plain boolean and drives one "traits changed since this image was made" note in `renderRegenPanel` (`app.js:1037`). Kind-agnostic.
5. **The poll tick** (`app.js:1571-1578`) gains `renderDetailTraits(openItem)` beside `renderRegenPanel(openItem)`. Kind-agnostic.
6. **`startPolling()`** (`app.js:1563`) is already kind-blind and self-terminating; the two missing calls at `:2996` and `:3039` fix both kinds at once.

**Ordering constraint (hard):** land the NPC bug fixes and the staged-edit route **before** any ship client code. If the ship path is written first, it will grow its own copy of the poll/re-render logic and the two will diverge — which is precisely the failure the NPC bug is made of.

**Requirement on Repo B:** `generate-spaceship.py` must implement `--apply-only` and must persist `traits`/`rawTraits` on the `--set-trait` path from day one. It has no legacy `if rerolled is not None:` to inherit; write the unconditional form (`if rerolled is not None or args.overrides:`) and add the regression test that `generate-npc.py` lacked — the gap at `test_set_trait_value.py:349-354`, which never reaches the manifest writer, is exactly why `generate-npc.py:4273` rotted unnoticed.

---

## 6. File-by-file change list and build order

### Repo A — server

| file | est. lines | change |
|---|---:|---|
| `lib/kinds.js` | **+140 (new)** | Registry, `kindFor`, `kindOf`, `requestKind`, `DEFAULT_KIND`, per-kind `createArgs`/`regenArgs`. |
| `lib/paths.js` | +45 | Ship path derivations beside the existing seven; existing return keys untouched. |
| `server.js` | ~+230 / ~−60 | Registry wiring; per-kind vocabulary parse maps; `?kind=` on ~14 routes; `POST /api/create`; `POST /api/stage-trait`; `GET /api/ship-catalogue`; four `supports.*` refusals; `entriesSnapshot(kind)`; `foundryDestFolder`; `queueImport` optional fields; `reconcile(entries, kinds)`; `itemView` +3 fields; `manifestPath` alias. |
| `lib/traitOdds.js` | +6 | `cacheKeyFor` gains the kind. (`oddsArgs` unchanged.) |
| `lib/createPresets.js` | +40 | Second settings schema behind the `create-form-spaceship` discriminator. |
| `lib/tableGroups.js` | +12 | Optional ship group list; unlisted tables already fall to `Other`. |
| `config.example.json` | +11 | The new keys, all defaulting to `""` / derived. |
| `lib/model3d.js`, `lib/tableBullets.js`, `lib/presets.js`, `lib/traitOptions.js`, `lib/traitChoices.js`, `lib/overrideTables.js`, `lib/pronouns.js` | **0** | Already kind-agnostic (path/dir/source-text parameters). |

### Repo A — client

| file | est. lines | change |
|---|---:|---|
| `public/index.html` | +95 | 5th tab button; `#tab-shipcreate` section; `#tables-kind` select; kind-aware banner/empty copy. |
| `public/app.js` | **+280 / ~−25** | `traitVocab`/`vocabFor`/`ensureVocab`; `vocab` param on three functions; three banner literals; `shipCreateState`/`elShipCreate` block (~230); `tablesState.kind` + 8 call sites; `model3dPanel` on `supports`; detail-sub + card composition. |
| `public/style.css` | +25 | Ship card aspect ratio, hex badge, ship-form grid. |

### Repo A — tests and docs

| file | est. lines | change |
|---|---:|---|
| `test/kinds.test.js` | +90 (new) | |
| `test/paths.test.js` | +55 | Extend for the ship path set. |
| `test/api.items.spaceship.test.js` | +170 (new) | The end-to-end proof of the "already generic" claim. |
| `test/api.spaceshipRegenArgs.test.js` | +130 (new) | |
| `test/api.createKind.test.js` | +120 (new) | |
| `test/api.tablesByKind.test.js` | +140 (new) | |
| `test/api.importSpaceshipToken.test.js` | +90 (new) | |
| `test/api.reconcileKinds.test.js` | +80 (new) | |
| `test/ui.shipCreate.test.js` | +110 (new) | |
| `test/ui.kindVocab.test.js` | +100 (new) | |
| `test/importerContract.test.js` | +45 | Additive assertions only; existing three untouched. |
| `test/ui.batchBanner.test.js` | ~±30 | Genuine contract change (banner wording). |
| `test/api.createProduced.test.js` | +40 | Ship snapshot filter. |
| `docs/foundry-importer-contract.md` | +35 | §4.5. |
| `docs/known-issues.md` | +20 | `## Backdrop` collision; `SEEN_VERSION` must not be bumped. |
| `docs/spaceship-support-design.md` | new | This document. |
| `README.md` | +25 | New config keys, the ship tab. |

### Repo B — blocking prerequisites

Nothing in Repo A is testable against real data without these; every Repo A phase below is testable against a **hand-written fixture manifest** in the meantime, which is why the order works.

- `generate-spaceship.py` — CLI mirroring `generate-npc.py` (`--count --seed --name --set-trait --no-portrait --no-token --keep-raw-token --server --dry-run --manifest --regen-manifest --regen-id --new-seed --reroll-trait --release --trait-choices --trait-odds`), plus **`--apply-only`**, **`--out-root`**, **`--ship-catalogue`**. `REQUIRED_TABLES`, `REROLLABLE_TRAITS`, `RAW_REROLLABLE_TRAITS`, `TRAIT_DEPENDENTS` as literal top-level assignments at column 0 (`lib/overrideTables.js:17-46` anchors `^NAME\s*=`).
- Manifest entries: `id: "ship-<slug>-<seed>"`, `kind: "spaceship"`, `name`, `seed`, `traits{}`, `rawTraits{}`, `files[]`, `portrait`, `token`, `portraitPrompt`, `tokenPrompt`, `when`, **`tokenWidth`/`tokenHeight`/`sizeBand`**, optional `artStale`. Written `indent=2, sort_keys=True`.
- Output layout `<root>/runN/<Category>/<Name>/`.
- `prompts/scene-and-spaceship-tables.md` grown from two headings (`:28` Backdrop, `:107` Spaceships) to the full set: `Ship type`, `Size`, `Theme`, `Weapon`, `Shield generator`, `Launch catapult`, `Command bridge`, `Hull`, `Markings`, `Names`, `Backdrop`.
- The `--set-trait` persistence rule and `--apply-only` (§5).

### Build order — the suite is green at the end of every phase

**P0 (Repo B, parallel).** Ship generator + tables. Repo A does not wait on it.

**P1 — pure modules.** `lib/kinds.js`, `lib/paths.js` ship additions, config keys and `manifestPath` alias. No route touched. New: `test/kinds.test.js`; extend `test/paths.test.js`. *Green: nothing else changed.*

**P2 — server data plane.** Registry wired into `foundryDestFolder`, `entriesSnapshot(kind)`, `itemView`'s three additive fields, `/api/categories` labels. Behaviour for an NPC-only library is bit-identical. New: `test/api.items.spaceship.test.js` (fixture manifest with one npc + one ship). *Green.*

**P3 — server generator plane.** `startRegenJob`/`startCreateJob` argv via the registry; the four `supports.*` refusals; `?kind=` on the tables/trait/presets/odds families; `POST /api/create` with `/api/create-npc` as the alias. New: `api.spaceshipRegenArgs`, `api.createKind`, `api.tablesByKind`. *Green — `api.createArgs.test.js`, `api.rerollTrait`, `api.setTrait`, `api.traitChoices`, `api.traitOdds`, `api.presets`, `api.tableBullets` all pass unchanged because every kind defaults to `npc`.*

**P4 — Foundry import.** `queueImport` conditional fields, `reconcile(entries, kinds)`, contract doc. New: `api.importSpaceshipToken`, `api.reconcileKinds`; extend `importerContract`. *Green — the existing three contract assertions are untouched by construction.*

**P5 — client seams (NPC-visible behaviour unchanged).** `vocab` parameters, `traitVocab`/`vocabFor`/`ensureVocab`, the three banner literals, `supports`-driven 3D panel. This is the phase that touches `ui.batchBanner.test.js` (wording) and nothing else. *Green after that one test is updated in the same commit.*

**P6 — client surfaces.** Create Spaceship tab, Tables kind select, `/api/ship-catalogue` + Type→Size gating, card/detail composition, CSS. New: `ui.shipCreate`, `ui.kindVocab`. *Green.*

**P7 — parity tail.** Ship trait-import staging (`?kind=` on the three candidate routes, per-kind `insertBulletIntoTables`), ship table groups, optional `supports.model3d` flip. *Green.*

**Staged-trait work (§5) lands between P4 and P5**, on the NPC path only, and P5/P6 consume it. It is not a phase of this project; it is a dependency of it.

---

## 7. Test plan (`node --test`, `node:test` + `node:assert/strict`, zero deps)

Ports must be unique per file — `node --test` runs files concurrently and every server binds a fixed port (`test/helpers/testServer.js:11-17`). The suite currently occupies **5000, 5193–5220, 5838**. New files take **5221–5228**.

`startTestServer` needs one additive change (~15 lines): accept `spaceshipGeneratorSource` and `spaceshipTablesText`, write them into the fixture dir, and set `generateSpaceshipScript` + `spaceshipTablesPath` in the fixture config (`testServer.js:54-76`). It already repoints `pythonExecutable` at `process.execPath` when a generator source is given (`:70`), so ship argv assertions never need a Python interpreter — reuse that path verbatim.

### `test/kinds.test.js` (pure, no port)
- `kindFor('npc')` and `kindFor('spaceship')` return entries; `kindFor('mech')` returns `null`.
- `kindOf({kind: undefined})` falls back to the `npc` entry (a manifest entry written by an older generator must not crash a route).
- `requestKind` precedence: `body.kind` > `?kind=` > `'npc'`; an unknown kind string resolves to `null` so routes can 400 rather than silently serving NPC data.
- Every registry entry has all of `script, tables, presetsDir, createPresetsDir, foundrySubdir, supports, createArgs` — a table-driven loop, so a third kind added without a field fails here.
- `npc.supports.model3d === true`, `spaceship.supports.model3d === false`.
- `spaceship.createArgs({count:2, seed:7, overrides:[{table:'Ship type', value:'a blunt-nosed bulk hauler'}]})` contains `--manifest` and does **not** contain `--pronouns` or `--unarmed`.

### `test/paths.test.js` (extend, no port)
- The seven existing keys are byte-identical to today for the same input (regression guard on the refactor).
- `spaceshipTablesPath` defaults beside `generateSpaceshipScript`, not beside `generateNpcScript`.
- `spaceshipPresetsDir` is `presetsDir/spaceship` and follows an overridden `presetsDir`.
- `spaceshipStagedImportsDir` is a **sibling** of `stagedImportsDir`, not a child (otherwise `listStagedFiles` would mix the two files' `## Backdrop` candidates).

### `test/api.items.spaceship.test.js` — port **5221**
The load-bearing test: it proves the "browse is already generic" claim end to end. Fixture manifest with one `kind:"npc"` and two `kind:"spaceship"` entries, real files on disk.
- `GET /api/categories` → both ids, correct counts, `label: 'Spaceships'`, `supports.model3d === false` on the ship row.
- `GET /api/items?category=spaceship` → exactly the two ships, name-sorted; each `itemView` carries `kind`, `traits`, `seed`, `roleCategory === null`, `tokenHexes`.
- `GET /api/image?id=<ship>&which=portrait` → 200 `image/png`.
- `POST /api/import` on a ship → `queued: true`; the files land under `FoundryData/LancerSpaceships/<category>/<name>/`, **not** `LancerNPCs`; the manifest key is repointed and re-reads clean.
- `POST /api/delete` on a ship → folder gone, manifest key gone, seen entry pruned, the NPC entry untouched.
- `POST /api/seen {ids:[shipId]}` then `GET /api/unseen` → the ship is gone from the list and the NPC is still in it.
- `GET /api/model-3d?id=<ship>` → 400 naming the kind; `GET /api/model-3d?id=<npc>` → 200. (Pins that the refusal moved to `supports` without changing behaviour.)

### `test/api.spaceshipRegenArgs.test.js` — port **5222**
`spaceshipGeneratorSource` is a Node stub that writes its `process.argv.slice(2)` to a file and exits 0.
- `POST /api/regenerate {id:<ship>, which:'both', seedMode:'specific', seed:99}` → 202; argv starts with the **ship** script and contains `--regen-manifest`, `--regen-id ship-…`, `--new-seed 99`.
- `which:'portrait'` adds `--no-token`; `'token'` adds `--no-portrait`.
- `POST /api/reroll-trait {id:<ship>, table:'Weapon'}` → 202, argv has `--reroll-trait Weapon` and a random `--new-seed`.
- `POST /api/set-trait {id:<ship>, table:'Size', value:'…'}` → 202 (not the old 400) once the ship's `rawTraits` are present and the stub's `--trait-choices` offers the value.
- A ship with **empty** `rawTraits` → 400 with the "recorded no raw bullets" message, same as an NPC.
- A second regen while one runs → 409 `already regenerating`.
- The cwd handed to the child is `dirname(generateSpaceshipScript)` (stub writes `process.cwd()`).

### `test/api.createKind.test.js` — port **5223**
- `POST /api/create-npc` (the alias) produces **byte-identical argv** to today: `--count`, `--seed`, `--name`, `--pronouns`, `--set-trait`, flags — and **no `--manifest`**. This is the regression guard for the alias.
- `POST /api/create {kind:'spaceship', count:2, overrides:[…]}` → the ship script, `--manifest <fixture manifest>`, `--set-trait Ship type=…`, and **neither** `--pronouns` nor `--unarmed` even when the body carries them.
- `POST /api/create {kind:'spaceship', pronouns:'she'}` → 400 (`pronouns are not a spaceship field`), rather than silently dropped.
- `spaceshipOutputRoot` in `extraConfig` → argv contains `--out-root <that path>`; absent → no `--out-root`.
- `GET /api/create-status?jobId=` reports `kind: 'spaceship'`.
- Produced-count: a stub that appends two ship entries to the manifest yields `produced: 2` and two `producedIds`, and the NPC entries in the same manifest are **not** counted (the `entriesSnapshot(kind)` guard).
- `POST /api/create {kind:'mech'}` → 400 unknown kind.

### `test/api.tablesByKind.test.js` — port **5224**
Fixture writes two different tables files, both containing a `## Backdrop` with different bullets.
- `GET /api/table-bullets` (no kind) === `?kind=npc`, and both return the NPC file's Backdrop.
- `?kind=spaceship` returns the ship file's Backdrop — the collision test.
- `POST /api/table-bullets/toggle {kind:'spaceship', table:'Backdrop', …}` rewrites **only** the ship file; the NPC file is byte-identical afterwards. (The most important assertion in this file — a cross-file write here corrupts a 252 KB hand-authored tables file.)
- Same for `/set-weight`.
- `GET /api/trait-options?kind=spaceship` keys on ship tables; `GET /api/pronouns?kind=spaceship` → `{subjects: []}`, status 200.
- `GET /api/presets?kind=spaceship` reads `presets/spaceship/` and does not list NPC presets; saving one does not appear in `?kind=npc`.
- `GET /api/npc-tables?kind=spaceship` returns the ship generator's four parsed constants; an unparseable ship script yields empty lists and status 200 (no reroll buttons is a safe way to be wrong).

### `test/api.importSpaceshipToken.test.js` — port **5225**
- Queue an NPC import → `/importer/pending` job has **exactly** today's key set; `assert.ok(!('tokenWidth' in job))`, `!('actorType' in job)`.
- Queue a ship whose manifest entry has `tokenWidth: 3, tokenHeight: 2` → the job carries `tokenWidth: 3`, `tokenHeight: 2`, `actorType: 'deployable'`, `kind: 'spaceship'`, `role: null`, `faction: null`.
- A ship entry **without** `tokenWidth` → the keys are absent, not `null` (the 1×1 graceful-degradation path).
- `foundrySpaceshipActorType: ''` in `extraConfig` → `actorType` absent.
- `portraitPath`/`tokenPath` are Data-relative and forward-slashed under `LancerSpaceships/`.

### `test/api.reconcileKinds.test.js` — port **5226**
- Import one NPC and one ship (both in `importedIndex`). `POST /importer/reconcile {entries:[npcEntry]}` **with no `kinds`** → the NPC is reconciled and **the ship is still imported**. This is the data-loss guard.
- `POST /importer/reconcile {entries:[npcEntry], kinds:['npc','spaceship']}` → the ship is dropped (an updated module that scanned both and found nothing is authoritative).
- An `itemId` no longer in the manifest is pruned in both cases.
- `tracked` in the response matches `importedIndex.size`.

### `test/ui.shipCreate.test.js` — port **5227**
Source-assertion style, matching `ui.batchBanner`/`ui.regenBanner`.
- `/index.html` has `data-tab="shipcreate"`, `#tab-shipcreate`, and the ids `create-ship-count`, `create-ship-seed`, `create-ship-type`, `create-ship-size`, `create-ship-theme`.
- `#tab-shipcreate` contains **no** `create-ship-pronouns` and no `unarmed` control.
- `/app.js` defines `shipCreateState` and `elShipCreate`, and `switchTab` registers `shipcreate` in its lazy-load block.
- The ship submit posts `/api/create` with `kind: 'spaceship'` — `assert.match(js, /fetch\(['"]\/api\/create['"]/)` style, plus a lifted `shipCreateRequestBody()` returning `{kind:'spaceship'}` and an `overrides` array carrying `Ship type`, `Size`, `Theme`.
- Lift `sizeBlockReason` and assert `sizeBlockReason(hugeBullet, 'patrol')` is truthy (a patrol boat rolls `small` only, `ship_policy.py:243-246`) while `sizeBlockReason(smallBullet, 'patrol')` is null.

### `test/ui.kindVocab.test.js` — port **5228**
The regression guard for §3.2's seam.
- Lift `rerollableForItem` with **one** argument (the `createState`-injection style `ui.rerollConfirm.test.js` uses) and assert it still returns the NPC lists — proving the default parameter did not break the existing lift contract.
- Lift it again and call `rerollableForItem({hasRawTraits:true}, SHIP_STATE)` → the ship lists.
- Lift `traitCascade` and assert `traitCascade('Ship type', SHIP_STATE)` walks the ship dependents map and orders by the ship `overrideTables`.
- `assert.match(js, /function rerollableForItem\(item, vocab = createState\)/)` — pins the seam itself, so a future refactor that removes the default breaks here loudly instead of breaking `ui.rerollConfirm` mysteriously.
- `assert.match(js, /const traitVocab = \{/)` and that `vocabFor` falls back to `createState` for an unknown kind.
- `assert.doesNotMatch(js, /renderShipDetailTraits|renderShipRegenPanel/)` — the §5 no-duplication rule, mechanically enforced.

### Existing files that must be touched (and why it is legitimate)
- `test/ui.batchBanner.test.js` — the banner text becomes kind-aware. A real contract change; update the assertions to the new `CATEGORY_LABELS`-driven wording and keep the "silent on zero" assertion exactly as it is.
- `test/api.createProduced.test.js` — extend with a ship run in a two-kind manifest.
- `test/importerContract.test.js` — **add** the optional-field assertions; the existing three are untouched, and that is the point.

### Files that must **not** change
`ui.newBadge`, `ui.traitColumns`, `ui.setTraitPicker`, `ui.rerollConfirm`, `ui.imageLocation`, `ui.copyPrompts`, `ui.overrideRow`, `ui.regenBanner`, and every `lib/` unit test. If any of them goes red, the change has left the design — stop and re-read §3.2.

---

## 8. Contract assumptions to reconcile with Repo B

| # | Assumption | Consequence if wrong |
|---|---|---|
| **A1** | `generate-spaceship.py` accepts `--manifest <path>` in create mode. | The GUI would have to rely on the ship generator's `DEFAULT_MANIFEST` matching `config.manifestPath` — the same implicit coupling the NPC create path already has (`server.js:1113-1125` passes no `--manifest`). Recoverable, but the coupling becomes silent. |
| **A2** | The manifest entry carries `tokenWidth`/`tokenHeight` as **integers in grid units**, derived in Repo B from `SIZE_BANDS[band]["hexes"]` (`ship_policy.py:106-135`). | Without it every ship imports 1×1. The GUI will not derive a footprint from image dimensions. |
| **A3** | `--out-root <path>` exists on the ship CLI and feeds `next_run_folder(root)`. | `spaceshipOutputRoot` becomes dead config; drop the key and let `COMFYUI_OUTPUT_DIR` (inherited by the child, `generate-npc.py:110`) or the generator's own `DEFAULT_OUTPUT_ROOT` decide. |
| **A4** | `--ship-catalogue` prints `{"types":[{"slug","name","sizes":[…]}],"sizes":{band:{"hexes":n,"label":…}}}` on stdout and nothing else. | The Create form's Type→Size gating is lost; the selects go ungated and an impossible pairing is refused by the generator after the job is queued. Degraded, not broken — which is why it is phase 6. |
| **A5** | The Lancer Foundry Actor type for a ship is `"deployable"`. | One config key (`foundrySpaceshipActorType`) and one registry line. The module must also be bumped to read `actorType`; until then it uses its default type and the ship still imports with correct art. |
| **A6** | Ship output nests two levels: `<root>/runN/<Category>/<Name>/`. | `roleCategory` (`server.js:1570-1573`) and `foundryDestFolder` (`:242-247`) both take `basename(dirname(folderPath))`. A flat `<root>/runN/<Name>/` would import every ship under a Foundry folder named `runN`. |
| **A7** | `REQUIRED_TABLES`, `REROLLABLE_TRAITS`, `RAW_REROLLABLE_TRAITS`, `TRAIT_DEPENDENTS` are literal top-level assignments at column 0 in `generate-spaceship.py`. | `lib/overrideTables.js:17-46` anchors on `^NAME\s*=`. A parse miss yields empty lists: no override dropdown, no reroll buttons, no cascade warnings — silently, with a stderr warning nobody reads. |
| **A8** | The ship generator persists `traits`/`rawTraits` on the `--set-trait` path and implements `--apply-only`. | The staged-edit parity in §5 does not work for ships, and the ship inherits the exact bug being fixed on the NPC side (`generate-npc.py:4273`). |

---

## 9. Summary of the commitment

- **One manifest, one seen store, one imported index, one job machine.** No data migration anywhere; `SEEN_VERSION` stays `1`.
- **`lib/kinds.js` is the only new abstraction.** It exists because five things vary per kind (script, tables file, presets root, Foundry subdir, capability set) and every current variation point already reads one of them from a module-level constant.
- **Every existing route keeps its exact current behaviour when `kind` is absent**, so 43 test files, a shipped Foundry module, and a stale browser tab all keep working.
- **The client gets one tab, one select, one optional parameter on three functions, and three literal fixes** — engineered so that the nine source-asserting `ui.*.test.js` files pass unchanged except `ui.batchBanner`, whose change is a real contract change and is called out as one.
- **The staged multi-trait editing machinery is written once, on the NPC path, and consumed by ships** — enforced by a test that fails if a `renderShipDetailTraits` ever appears.
- **The one genuine hazard to existing data is `reconcile`'s wholesale prune** (`server.js:432-434`), fixed by an optional `kinds` field that defaults to `['npc']` and is therefore back-compatible with the module already in the wild.