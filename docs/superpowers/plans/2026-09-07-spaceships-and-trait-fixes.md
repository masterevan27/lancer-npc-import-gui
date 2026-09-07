# Spaceships + trait-editing fixes — implementation plan and remaining work

**Written** 2026-09-07, at the point work was paused for handoff.
**Scope** spans two sibling repositories:

| Repo | Path | Branch |
| --- | --- | --- |
| **ART** — the generator | `G:\GIT-REPOS\lancer-art-generator` | `ultracode-spaceships` |
| **GUI** — the import GUI | `G:\GIT-REPOS\lancer-npc-import-gui` | `ultracode-features` |

Both branches exist as git worktrees under each repo's `.claude/worktrees/`. **All finished work is
committed to the branches**, so it survives the worktrees being deleted. Nothing is on `main`;
nothing has been pushed.

The companion document [`REMAINING-WORK.md`](../../REMAINING-WORK.md) is the task list. This file is
the plan and the reasoning behind it; read this first, then work the tasks.

---

## 1. What the user asked for

Verbatim, in four parts:

1. **GUI bug** — "the regenerating pill doesnt seem to disappear until the user refreshes, and the
   regenerated npc completed banner also does not seem to appear unless an npc is created as well?"
2. **GUI bug** — "when re-rolling a trait for an npc, it doesnt seem to update their trait value on
   their page? also when re-rolling a 2nd trait, it then creates a new image without the 1st
   re-rolled or specified trait value? The intent is for users to be able to customize an npc by
   specifying multiple traits, or re-rolling ones they want randomly decided, and then regenerate an
   image once theyve selected or re-rolled what they want."
3. **Spaceships in the art generator** — a second kind of generatable content beside NPCs, with a
   portrait and a Foundry token; the token spanning one grid hex for a small ship up to about five
   for a large one. Ships vary in size, theme, glow, weapons, shield generators, launch catapults
   (for launching mechs into space), command bridges, and ten types (carriers, battleships,
   destroyers, cruisers, patrol boats, stealth ships, reconnaissance ships, smuggler ships, cargo
   ships, support ships). **"non-combat ships like cargo ships, should have minimal shielding and
   weapons (if any) and no launch catapults. combat ships depending on their type and size may have
   some or many of the previously described features."**
   Plus (3a) 20 ship descriptions, (3b) 20 backdrop descriptions, (3c) descriptions for the other
   traits — all drawing on Gundam, Armored Core, Cowboy Bebop, Space Battleship Yamato and
   Warhammer 40k.
4. **Spaceships in the GUI** — "with all the same capabilities the npc support (re-rolling traits,
   setting traits, creating a new spaceship, etc.)"

Parts 1 and 2 are **done and verified**. Part 3 is **~80% done**. Part 4 is **not started**.

---

## 2. Status

### Done and committed

| Commit | Repo | What |
| --- | --- | --- |
| `ee3991e` | GUI | Both bug fixes + staged multi-trait editing |
| `8e78e07` | ART | The manifest write-back fix + `--apply-only` |
| `b6552d2` | ART | The 18 spaceship roll tables + `ship_policy.py` |

**Verified by running, not by reading:**

- GUI suite: **422 passing, 0 failing** (`node --test`, ~7.6s).
- ART suite: **999 passing, 1 skipped** (`python -m unittest discover -s test -q`, ~92s).
- Every one of the 21 legal (ship type, size band) pairs yields a non-empty pool for all four
  equipment tables — no roll can crash or come up blank.
- The user's hard constraint holds in the real filters: cargo, support and smuggler ships reach the
  `none` launch-catapult bullet **and nothing else** at every legal size; a carrier can **never**
  reach it. Cargo weapons/shields are "minimal" — 5 of 13 reachable weapon bullets are the empty
  one, so most haulers come out unarmed and none can reach a spinal lance.

### Uncommitted work in progress

Two files in the ART worktree, **deliberately left uncommitted** because they are halves of one
file that were never merged:

- `_ship_roll.py` (1,074 lines) — the roller and prompt builder.
- `_ship_cli.py` (2,129 lines) — token sizing, output, dossier, manifest, regeneration, CLI.

They were written by two agents in parallel to avoid edit collisions. **Both work.** `_ship_cli.py`
imports the four names it needs from `_ship_roll.py` and runs end to end today:

```
python _ship_cli.py --help                      # full CLI surface
python _ship_cli.py --dry-run --count 20        # rolls, builds prompts, prints them
python _ship_cli.py --ship-catalogue            # JSON the GUI create-form needs
```

A dry run currently produces correct, good-looking prompts under the token budget (portrait ~328
tokens, token ~363, limit 512).

---

## 3. The architecture, and why

These decisions came out of a design pass that was adversarially reviewed. Do not relitigate them
without reading the two design docs in `docs/superpowers/specs/`:

- `2026-09-06-spaceship-generator-design.md` (77 KB) — the generator.
- `2026-09-06-trait-editing-fixes-design.md` (62 KB) — the bug fixes. The GUI repo has this one too,
  plus `2026-09-06-gui-spaceships-design.md` (63 KB) for part 4.

**A separate `generate-spaceship.py`, not a mode inside `generate-npc.py`.** The NPC script is 4,544
lines under ~50 test files, and the GUI regex-parses four of its module-level constants out of the
source text. Extracting a shared library would touch `parse_tables`'s function-attribute trick, the
`_bullet_cache` identity that `test_trait_odds.py` pins, and those four constants — fifty green
tests put at risk for a feature that has not shipped. Instead the new entry point loads
`generate-npc.py` **by path** for the machinery it borrows. That is established house precedent:
`generate-npc.py:77-97` loads `generate-art.py` this way, and `generate-3d.py:1452` already loads
`generate-npc.py` this way. **Zero lines of `generate-npc.py` change**, and `git diff` confirms it.

**A new `prompts/spaceship-generator-tables.md`, not growth of `scene-and-spaceship-tables.md`.**
Three reasons, the second decisive:

1. `test/test_ship_policy.py` already names the new file.
2. **The staged file has never been parseable.** All 41 of its bullets are hard-wrapped at ~72
   columns. `parse_tables` matches a bullet with `^-\s+(.*?)\s*$` and matches continuation lines
   against nothing, so every bullet is silently truncated at its first physical line and loses its
   whole flag segment. Every real bullet in `npc-generator-tables.md` is one physical line; the
   longest is 825 characters.
3. Its `## Backdrop` bullets are deliberately subject-free with no `shot || scene || flags` split,
   no weights and no weather gating — the ship generator needs all three.

Its 21 ship bullets were **mined for vocabulary, not moved**: each stacks silhouette, hardware,
markings *and an embedded scene* into one sentence, and four of them duplicate a `## Backdrop`
bullet outright. Composed against a separately-rolled backdrop that yields two settings in one
prompt. `scene-and-spaceship-tables.md` is otherwise untouched.

**Ships share `.generated-npcs.json` with NPCs**, distinguished by a `kind` field. This is what lets
the GUI reuse one manifest, one seen-index, one imported-index and one job machine, with no data
migration. The GUI's new `api.stageTrait.test.js` already asserts `a non-npc kind is refused`, so the
two halves are built to the same contract.

**The manifest entry is the accumulator for staged trait edits** — no new persistent state. Each
edit is a fast, no-render `--apply-only` invocation that rewrites the entry and marks `artStale`;
Regenerate renders the accumulated result and clears the marker. The rejected alternative, a
server-side pending map, loses everything on restart and forces the trait-choices cache to key on
unstaged overrides.

---

## 4. Root causes of the two bugs, for the record

Eight distinct defects sat behind four reported symptoms. The two that mattered:

**The pill never cleared** because both trait handlers started a regen job and called
`refreshItems()` exactly once, then nothing looked again. There is no regen-status endpoint — status
rides on each item in `/api/items`, and the only thing that re-reads that on a timer is
`startPolling()`, which the handlers never called despite a comment claiming a hand-off to "the
regen poller". The completion banner was never lost, only deferred: `detectRegenFinished` had
already recorded `'running'`, so the next refresh from any source announced it — which is why
creating an NPC surfaced a banner for a reroll that finished minutes earlier.

**A second edit discarded the first**, and this was not a display bug. In `generate-npc.py:4273` the
write-back of `traits`/`rawTraits` was gated on `rerolled`, which is only ever assigned inside the
`--reroll-trait` branch. So `--set-trait` wrote the new seed, the new prompts and all eight derived
flag registers while leaving the **old** bullets in `entry["traits"]`. `npc_from_entry()` then
reloaded those new registers over the old traits to build the filters the *next* roll ran against.
That is corruption, not staleness — and it also pinned the GUI's trait-choices cache, whose key
fingerprints `rawTraits` and so never invalidated.

An adversarial pass caught the first investigation claiming that reopening the detail sheet recovers
the state. It does not — `openDetail` renders from the stale in-memory row it is handed. Had that
gone into the fix, the fix would not have worked.

---

## 5. Known issues found along the way

Record these; they are real but were out of scope.

1. **Sentence-join capitalization bug in ship prompts — fix this first, it is visible in every
   render.** The Detail, Command bridge and Markings clauses are joined with `". "` but never
   capitalized, so prompts read `"...bolted beside each mount. a faired-over sensor blister..."`.
   Measured: **40 occurrences across 20 rolled ships**, roughly two per ship. Reproduce with
   `python _ship_cli.py --dry-run --count 20 --seed 11 2>&1 | grep -coE '\. [a-z]'`.
   Either capitalize on join or make those clauses comma-joined continuations.
2. **Two pre-existing test-port collisions in the GUI**, unrelated to this work and present before
   it: `api.traitImage`/`api.traitOdds` both bind 5203, and `api.createPresets`/`ui.traitColumns`
   both bind 5218. `node --test` runs files in parallel, so these are latent flakiness — the same
   fault that hung the suite on 5222 until it was moved to 5221.
3. **Role reroll strands the folder** (pre-existing, from the design doc's out-of-scope list).
   `generate-npc.py:4159` recomputes the category but reuses the stored folder and never re-keys
   `manifest[folder_path]`. The GUI derives the displayed category from the folder's parent, so
   after re-rolling Role the sheet shows a category contradicting `traits.Role`.
4. **`ship_policy.py` was written by an agent that had been told to be read-only.** It is 930 lines
   with 86 passing tests and the design references it, so it was kept — but it was not reviewed as
   carefully as code written under an implementation brief. Worth a read before trusting it deeply.

---

## 6. Build order for what remains

Each phase leaves both suites green. Do not start a phase before the one above it is green.

| # | Phase | Repo | Blocked by |
| --- | --- | --- | --- |
| 1 | Merge the two halves into `generate-spaceship.py` | ART | — |
| 2 | Fix the capitalization bug (§5.1) | ART | 1 |
| 3 | Tests for the generator | ART | 1 |
| 4 | A real end-to-end render against ComfyUI | ART | 2 |
| 5 | GUI: entity-kind abstraction (`lib/kinds.js`) | GUI | 1 |
| 6 | GUI: server routes made kind-aware | GUI | 5 |
| 7 | GUI: client — nav, list, detail, create form | GUI | 6 |
| 8 | GUI: Foundry import of multi-hex tokens | GUI | 6 |

Phases 5–8 are specified file-by-file, with a build order that keeps the suite green at every step,
in `docs/superpowers/specs/2026-09-06-gui-spaceships-design.md` §6. Follow it rather than improvising.

---

## 7. Verification commands

```bash
# ART
cd G:/GIT-REPOS/lancer-art-generator/.claude/worktrees/ultracode-spaceships
python -m unittest discover -s test -q        # expect 999 pass, 1 skip (pytest is NOT installed)
python _ship_cli.py --dry-run --count 20      # after the merge: python generate-spaceship.py ...
git diff --stat HEAD -- generate-npc.py generate-art.py generate-3d.py ship_policy.py   # must be empty

# GUI
cd G:/GIT-REPOS/lancer-npc-import-gui/.claude/worktrees/ultracode-features
node --test                                    # expect 422 pass, 0 fail
```

Note the environment has **no pytest** — the design says pytest, but the suite is `unittest` and the
existing test files are written for it. Match the existing files.
