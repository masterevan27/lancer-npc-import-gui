# Remaining work — spaceships

> **⚠️ Superseded by two step-by-step implementation plans. Work those, not this file.**
>
> - [`docs/superpowers/plans/2026-09-07-spaceship-generator-completion.md`](docs/superpowers/plans/2026-09-07-spaceship-generator-completion.md) — ART, tasks 1–4 below
> - [`docs/superpowers/plans/2026-09-07-gui-spaceship-support.md`](docs/superpowers/plans/2026-09-07-gui-spaceship-support.md) — GUI, tasks 5–8 below
>
> Both carry findings measured against the running code that **contradict this file and the
> design docs**. Three matter enough to name here:
>
> 1. **Task 4 below is wrong about the manifest.** `tokenWidth`/`tokenHeight` are **pixels**;
>    `gridWidth`/`gridHeight` are the grid units Foundry wants. The GUI design's assumption A2
>    says otherwise, and following it would set a cruiser's token 1728 hexes wide.
> 2. **The capitalization defect has four join sites, not three.** Exactly 20 of the 40
>    occurrences are `{plan}` after the token template's white-void sentence — Task 2 below
>    names only Detail, Command bridge and Markings, so fixing what it lists fixes half the bug.
> 3. **`--out-root` does not exist** (GUI assumption A3 is false), and the ship tables file is
>    `prompts/spaceship-generator-tables.md`, not the `scene-and-spaceship-tables.md` the GUI
>    design derives.
>
> Also settled: design §4's "no new ComfyUI workflow JSON needed" claim is **verified**, and the
> merge in Task 1 has been **validated end to end** — the spliced file's dry run is byte-identical
> to today's and the GUI's parser reads all four constants out of it.

Task list for picking this up. The plan and the reasoning are in
[`docs/superpowers/plans/2026-09-07-spaceships-and-trait-fixes.md`](docs/superpowers/plans/2026-09-07-spaceships-and-trait-fixes.md);
**read that first**, then the two implementation plans above.

**Repos and branches** (nothing is on `main`, nothing is pushed):

- **ART** `G:\GIT-REPOS\lancer-art-generator`, branch `ultracode-spaceships`
- **GUI** `G:\GIT-REPOS\lancer-npc-import-gui`, branch `ultracode-features`

**Done already:** both reported GUI bugs, staged multi-trait editing, all 18 spaceship roll tables,
and `ship_policy.py` with the type/size equipment matrix. GUI suite 422 pass / 0 fail; ART suite
999 pass / 1 skip.

Design documents to work from, all committed:

| Document | Repo | Covers |
| --- | --- | --- |
| `docs/superpowers/specs/2026-09-06-spaceship-generator-design.md` | ART | tasks 1–4 |
| `docs/superpowers/specs/2026-09-06-gui-spaceships-design.md` | GUI | tasks 5–8 |
| `docs/superpowers/specs/2026-09-06-trait-editing-fixes-design.md` | both | the finished bug fixes |

---

## Task 1 — Merge the two halves into `generate-spaceship.py`

**Repo** ART · **Blocked by** nothing · **Size** medium, mostly mechanical

Two uncommitted files are halves of one entry point, written in parallel by separate agents so they
would not collide. Both work; `_ship_cli.py` runs end to end today.

- `_ship_roll.py` (1,074 lines) — module loading, `REQUIRED_TABLES`, the filters, `roll_ship()`,
  `ship_fields()`, the prompt templates, `build_ship_prompts()`.
- `_ship_cli.py` (2,129 lines) — token sizing, output layout, `write_ship_dossier()`, the manifest
  entry, regeneration, `reroll_ship_trait()`, `trait_choices()`, and the full argparse surface.
  Its header comment (around line 62) contains its own merge instructions.

**Do:**

1. Merge into a single `generate-spaceship.py` beside `generate-npc.py`, in the shape design §1
   gives. Delete `_ship_roll.py` and `_ship_cli.py` — the deliverable is one hyphenated entry point.
2. **Dedupe.** Both files independently define `TRAIT_DEPENDENTS`, `REROLLABLE_TRAITS`,
   `RAW_REROLLABLE_TRAITS`, `check_tables`, `trait_cascade`, `PORTRAIT_SIZE`, `PLAN_FRAMING`,
   `TOKEN_LIMIT` and `CHARS_PER_TOKEN`. Reconcile each — they may not be identical, and the
   `_ship_cli.py` copy is generally the later one.
3. Drop the `from _ship_roll import ...` line; those names become local.

**Acceptance:**

```bash
python generate-spaceship.py --help
python generate-spaceship.py --dry-run --count 20
python generate-spaceship.py --ship-catalogue
python -m unittest discover -s test -q                 # still 999 pass, 1 skip
git diff --stat HEAD -- generate-npc.py generate-art.py generate-3d.py ship_policy.py   # empty
```

**Critical — the GUI parses this file's source text.** `REQUIRED_TABLES`, `REROLLABLE_TRAITS`,
`RAW_REROLLABLE_TRAITS` and `TRAIT_DEPENDENTS` must survive the merge as **literal top-level
assignments anchored at column 0**. `lib/overrideTables.js:17-46` in the GUI matches `^NAME\s*=`; a
parse miss silently yields empty dropdowns and no reroll buttons, with only a stderr warning nobody
reads. Verify by running that JS against the merged file.

---

## Task 2 — Fix the sentence-join capitalization bug

**Repo** ART · **Blocked by** 1 · **Size** small · **Do this before any real render**

The Detail, Command bridge and Markings clauses are joined with `". "` but never capitalized, so
every prompt contains lowercase sentence starts:

> ...short barrels and open ammunition lockers bolted beside each mount. **a** faired-over sensor
> blister of solid armour plate... **a** stencilled hull code repeated small beside each airlock...

**Measured: 40 occurrences across 20 ships**, about two per ship. Reproduce:

```bash
python generate-spaceship.py --dry-run --count 20 --seed 11 2>&1 | grep -coE '\. [a-z]'
```

Fix by capitalizing on join, or by making those clauses comma-joined continuations of the preceding
sentence. Check how `generate-npc.py`'s `headgear_line()` / `carry_sentence()` handle the same
problem and follow that idiom. Add a test asserting no prompt contains `. ` followed by a lowercase
letter.

---

## Task 3 — Tests for the generator

**Repo** ART · **Blocked by** 1 · **Size** medium

Design §8 has the test plan. **The environment has no pytest** — the design says pytest, but the
suite is `unittest` and every existing `test/test_*.py` is written for it. Match the existing files;
read `test/helpers.py`, `test/test_weapon_role.py` and `test/test_role_lock.py` first.

At minimum:

- The equipment policy end to end **through the real roller**, not just through `ship_policy`: roll
  ~200 ships at a fixed seed and assert no cargo/support/smuggler ship ever gets a launch catapult,
  and every carrier does.
- Token sizing: every ship's recorded `tokenWidth` matches `sp.hexes_for()` of its rolled band.
- Prompt budget: no portrait or token prompt exceeds `TOKEN_LIMIT`.
- **The borrowed-surface pin** (design §1 lists exactly 19 names borrowed off `generate-npc.py`), so
  an NPC-side rename fails at test time rather than at render time.
- `--apply-only` parity with `generate-npc.py`'s implementation (commit `8e78e07`): stdout is pure
  JSON, diagnostics go to stderr, `artStale` is popped rather than set false.

---

## Task 4 — One real render against ComfyUI

**Repo** ART · **Blocked by** 2 · **Size** small, but needs a running ComfyUI

Everything so far is dry-run only. **No ship image has ever actually been generated.** Render at
least a small ship (1 hex) and a huge one (5 hexes) and confirm:

- The portrait looks like the campaign's house style.
- The token comes back cleanly background-removable, and the multi-hex token's aspect ratio is right
  for its grid footprint — this is the part most likely to disappoint, since the wide-token framing
  language has never been tested against the model.
- `write_ship_dossier()` output is correct and the manifest entry carries `kind`, `tokenWidth` and
  `tokenHeight` as integers in grid units.

Design §4 claims no new ComfyUI workflow JSON is needed. **That claim is unverified** — check it
against `workflows/api/*.json`.

---

## Task 5 — GUI: the entity-kind abstraction

**Repo** GUI · **Blocked by** 1 · **Size** medium

Design `2026-09-06-gui-spaceships-design.md` §1–2. Add `lib/kinds.js` (~140 lines): the five things
that vary per kind — generator script, tables file, presets root, Foundry subdirectory, capability
set. Extend `lib/paths.js` (~+45 lines) and add the config keys in §2.3.

**Every existing route must keep its exact current behaviour when `kind` is absent.** 43 test files,
a shipped Foundry module and a stale browser tab all depend on that. No data migration: one manifest,
one seen store, one imported index, `SEEN_VERSION` stays `1`.

The one real data hazard is `reconcile`'s wholesale prune (`server.js:432-434`) — see §4.3.

---

## Task 6 — GUI: kind-aware server routes

**Repo** GUI · **Blocked by** 5 · **Size** medium

Design §2.5 goes route by route. Includes the child-process spawn for `generate-spaceship.py`
(§2.4). Reuse the staged-edit machinery from commit `ee3991e` rather than duplicating it — the
design (§5) asks for a test that fails if a `renderShipDetailTraits` ever appears.

Tests in §7. **Ports 5193–5224 are taken** (5221–5224 by the new trait-editing tests). Start at
5225. Two files on one port hang the run rather than failing it — that fault cost real time already.

---

## Task 7 — GUI: the client

**Repo** GUI · **Blocked by** 6 · **Size** large — the biggest single piece left

Design §3. Navigation between NPCs and Spaceships, the list view, the detail view, the ship trait
panel, and a new Create Spaceship form (~230 lines) with type→size gating driven by
`--ship-catalogue`. Ship traits differ from NPC traits, but the trait-editing *machinery* is shared.

`public/app.js` is 3,621 lines. §3.2 identifies the one seam that matters and is honest about how
much is hardcoded to `npc`.

---

## Task 8 — GUI: Foundry import of multi-hex tokens

**Repo** GUI · **Blocked by** 6 · **Size** medium

Design §4. A ship token spans 1–5 grid hexes; an NPC token is always 1×1. The importer contract
(`docs/foundry-importer-contract.md`) needs the grid-width metadata, and `queueImport` /
`foundryDestFolder` / `copyIntoFoundry` need the kind. §4.3 covers the `reconcile` hazard.

**Assumption to verify:** the design assumes the Lancer Foundry Actor type for a ship is
`"deployable"` (§8, A5). Confirm against the actual Foundry module before relying on it.

---

## Open contract assumptions

`2026-09-06-gui-spaceships-design.md` §8 lists eight assumptions (A1–A8) the GUI work makes about
the generator's CLI. Most are now settled by `_ship_cli.py` — `--ship-catalogue` exists and emits
the shape A4 wants, and A8's `--apply-only` is implemented on the NPC side. **Re-check each against
the merged `generate-spaceship.py` before starting task 5**, and record the answers in that section
so the GUI work is not built on a guess.
