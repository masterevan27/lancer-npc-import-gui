# Spaceship generator completion — implementation plan (Repo ART)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the two working halves of the ship generator into one `generate-spaceship.py`, fix the sentence-join capitalization defect visible in every render, cover the generator with the `unittest` suite, and put the first real images through ComfyUI.

**Architecture:** `generate-spaceship.py` is a new top-level entry point beside `generate-npc.py`. It loads `generate-art.py` and `generate-npc.py` **by path** (never by import) for the parser, theme, glow and ComfyUI machinery, imports `ship_policy.py` normally for the type/size equipment matrix, and changes **zero lines** of any of them. Four constants stay literal column-0 assignments because a sibling GUI regex-parses this file's source text.

**Tech Stack:** Python 3.13, stdlib only. Tests are `unittest`, run by `python -m unittest discover`. **There is no pytest in this environment** — the design doc says pytest; it is wrong, follow the existing `test/test_*.py` files. ComfyUI over HTTP for renders.

**Spec:** [`docs/superpowers/specs/2026-09-06-spaceship-generator-design.md`](../specs/2026-09-06-spaceship-generator-design.md) — §1 the borrowed surface, §4 token sizing and workflows, §6 the manifest entry, §7 the CLI, §8 the test plan.
Companion: [`docs/superpowers/plans/2026-09-07-spaceships-and-trait-fixes.md`](2026-09-07-spaceships-and-trait-fixes.md) (why), [`REMAINING-WORK.md`](../../../REMAINING-WORK.md) (the original task list).
**Sibling plan:** `docs/superpowers/plans/2026-09-07-gui-spaceship-support.md` covers the GUI. Task 1 here unblocks all of it.

---

## Global Constraints

- **Stdlib only.** No new dependencies. `generate-art.py` sets the precedent and the ship script follows it.
- **`generate-npc.py`, `generate-art.py`, `generate-3d.py` and `ship_policy.py` must not change.** Verified by `git diff --stat HEAD -- generate-npc.py generate-art.py generate-3d.py ship_policy.py` returning empty at the end of every task.
- **`REQUIRED_TABLES`, `REROLLABLE_TRAITS`, `RAW_REROLLABLE_TRAITS` and `TRAIT_DEPENDENTS` must remain literal top-level assignments anchored at column 0.** The GUI's `lib/overrideTables.js:17-46` regex-parses this file's source text with `^NAME\s*=` patterns. A parse miss is silent: empty trait dropdowns, no reroll buttons, one stderr warning nobody reads.
- **Test suite baseline: 999 passing, 1 skipped**, `python -m unittest discover -s test -q` (~92s). Every task ends green.
- **Tests are `unittest`, not pytest.** Read `test/helpers.py`, `test/test_ship_policy.py` and `test/test_apply_only.py` before writing a new file.
- **Commit after every task.** Nothing is on `main` and nothing is pushed; the branch is `ultracode-spaceships`.
- Working directory for every command in this plan:
  `G:/GIT-REPOS/lancer-art-generator/.claude/worktrees/ultracode-spaceships`

---

## Findings that change the spec

These were measured against the running code on 2026-09-07. Where they contradict the design doc or `REMAINING-WORK.md`, **these win**.

| # | Finding | Effect |
|---|---|---|
| **F1** | `token_metadata()` (`_ship_cli.py:234-252`) writes **`gridWidth`/`gridHeight` in grid units** and **`tokenWidth`/`tokenHeight` in PIXELS** (`large` → `gridWidth: 3`, `tokenWidth: 1728`). `REMAINING-WORK.md` Task 4 and the GUI design's assumption A2 both say `tokenWidth` is a grid count. **They are wrong.** | The GUI must send `gridWidth`/`gridHeight` to Foundry. Sending `tokenWidth` would draw a cruiser 1728 hexes wide. Carried into the GUI plan as its highest-priority correction. |
| **F2** | **`--out-root` does not exist.** The CLI has `--out` (a run folder) only. GUI assumption A3 is false. | Task 1b below adds `--out-root`; it is four lines, and the GUI's `spaceshipOutputRoot` key depends on it. |
| **F3** | `--ship-catalogue` emits `{"types":[{slug,name,sizes,folder}], "sizes":[{sizeBand,hexes,gridWidth,gridHeight,tokenWidth,tokenHeight,gloss}], "themes":[…]}`. `sizes` is an **array of objects**, not the `{band:{hexes,label}}` map assumption A4 predicts. | The GUI's Type→Size gating reads the array. Recorded in the GUI plan. |
| **F4** | Design §4's claim that no new ComfyUI workflow JSON is needed is **verified**: `Lancer_Scene_Workflow_v1.json` node `57` ("Token Image Size") is the only `EmptyLatentImage` wired to KSampler `54`'s `latent_image`; `Util_RemoveBackground_makeTransparent.json` has exactly one `RMBG` node (`process_res: 1024`). | Task 4 does not need to author a workflow. `--rmbg-res` (default 1536) and the hard `SystemExit` on a missing latent slot are **already implemented** (`_ship_cli.py:990`, `:1351`, `:1380`). |
| **F5** | The capitalization defect has **four** join sites, not three. Exactly **20 of the 40** occurrences are `{plan}` following `"…an empty plain white void. "` in `TOKEN_TEMPLATE` — `PLAN_FRAMING`'s values are all lowercase. `REMAINING-WORK.md` names only Detail, Command bridge and Markings. | Task 2's fix must cover `{plan}`, or it fixes half the bug. |
| **F6** | All nine duplicated definitions across the two halves are **semantically identical**; only comments and docstrings differ. | The merge is a choice of prose, not a reconciliation of logic. Task 1 records which copy wins and why. |
| **F7** | `traitDependentsFrom` on `_ship_cli.py` alone returns **`{}`** — it bails when the same source carries no `REQUIRED_TABLES` (`overrideTables.js`, `if (!tables.size) return {}`). On `_ship_roll.py` and on the merged file it returns the correct 9 non-empty edges (leaves are dropped by design, `if (freed.length)`). | Another reason the merged single file is required before any GUI work: neither half alone parses. |

---

### Task 1: Merge the two halves into `generate-spaceship.py`

**Files:**
- Create: `generate-spaceship.py` (2,897 lines, spliced)
- Delete: `_ship_roll.py`, `_ship_cli.py`
- Reference (do not modify): `generate-npc.py`, `generate-art.py`, `ship_policy.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces, at module top level and column 0 —
  `REQUIRED_TABLES: list[str]` (18 names), `THEMED_TABLES: tuple[str, ...]` (5),
  `TRAIT_DEPENDENTS: dict[str, tuple[str, ...]]` (18 keys, 9 with non-empty edges),
  `REROLLABLE_TRAITS: tuple[str, ...]` (16), `RAW_REROLLABLE_TRAITS: tuple[str, ...]` (16),
  `PORTRAIT_SIZE: tuple[int, int]`, `PLAN_FRAMING: dict[str, str]`,
  `TOKEN_GRID: dict[str, tuple[int, int]]`, `TOKEN_PX_PER_HEX: dict[str, int]`, `MAX_TOKEN_PX: int`,
  `SHIP_FOLDERS: dict[str, str]`, `TOKEN_LIMIT: int`, `CHARS_PER_TOKEN: float`, `COMFY_PREFIX: str`.
  Functions: `check_tables(tables, path, repeated=()) -> None`, `trait_cascade(name) -> tuple[str, ...]`,
  `roll_ship(tables, rng, overrides=None, probe=None) -> dict`, `ship_fields(ship) -> dict`,
  `build_ship_prompts(ship) -> tuple[str, str]`, `token_size(band, max_px=MAX_TOKEN_PX) -> tuple[int, int]`,
  `token_metadata(band, max_px=MAX_TOKEN_PX) -> dict`, `ship_type_of(ship) -> str`,
  `write_ship_dossier(...)`, `manifest_entry(...) -> dict`, `reroll_ship_trait(tables, ship, name, rng)`,
  `trait_choices(tables, ship, name) -> dict`, `parse_args(argv=None)`, `main(argv=None) -> int`.

**Which copy of each duplicate wins, and why** (all nine are logically identical — F6 — so this is a prose decision):

| definition | keep from | reason |
|---|---|---|
| `TRAIT_DEPENDENTS` | `_ship_roll.py` | Its `"Theme": THEMED_TABLES` is derived rather than retyped, and `overrideTables.js`'s `DEPENDENT_ENTRY_RE` explicitly supports a named-tuple reference. Its comments are the longer, better ones. |
| `REROLLABLE_TRAITS` | `_ship_roll.py` | Literal multi-line tuple — the shape the GUI regex needs. |
| `RAW_REROLLABLE_TRAITS` | `_ship_roll.py` | Same block; keeps the pair adjacent. |
| `check_tables`, `trait_cascade` | `_ship_roll.py` | Sit with `REQUIRED_TABLES`, which they read. |
| `PORTRAIT_SIZE`, `PLAN_FRAMING` | `_ship_roll.py` | They live in the prompt-template section, and `build_ship_prompts` reads `PLAN_FRAMING`. Keeping them there makes every use in the CLI half a strictly forward reference. |
| `TOKEN_LIMIT`, `CHARS_PER_TOKEN` | either (identical) | One copy, in the borrowed-surface block. |

**The bootstrap comes from `_ship_roll.py`, and this is a correctness fix, not a style choice.** `_ship_cli.py:117-118` loads `generate-art.py` first and `generate-npc.py` second with an unguarded loader. `generate-npc.py:97` runs *its own* by-path load of `generate-art.py` under the same `sys.modules` name, replacing the module object — so `art.Entry` and `npc.art.Entry` become two distinct classes with the same name. Nothing crashes; an `isinstance` check downstream simply starts answering `False`. `_ship_roll.py:39-97` loads npc **first** and guards `_load_art()` on `sys.modules`, which is the cure. Step 2 of Task 3 asserts it with `assertIs(ship.art, ship.npc.art)`.

- [ ] **Step 1: Capture the behavioural baseline the merge must not change**

```bash
cd G:/GIT-REPOS/lancer-art-generator/.claude/worktrees/ultracode-spaceships
mkdir -p .merge-baseline
python _ship_cli.py --dry-run --count 20 --seed 11 > .merge-baseline/dry20.txt 2>&1
python _ship_cli.py --ship-catalogue                > .merge-baseline/catalogue.json 2>&1
python _ship_cli.py --help                          > .merge-baseline/help.txt 2>&1
wc -l .merge-baseline/*
```

Expected: `dry20.txt` non-empty, `catalogue.json` valid JSON, `help.txt` listing the full flag set. **This is the test.** The merge passes only if the merged file reproduces all three byte for byte.

- [ ] **Step 2: Write the splice script**

The line ranges below were validated by running them — the resulting file is byte-identical on all three baselines. Do not adjust them by eye.

Create `build_merge.py` at the repo root:

```python
"""One-shot splice of _ship_roll.py + _ship_cli.py -> generate-spaceship.py.

Delete this file (and the two halves) once the merge is committed. The ranges
are 1-based inclusive and were validated against the dry-run baseline; see the
plan's Task 1 for which copy of each duplicated definition survives.
"""
from pathlib import Path

roll = Path('_ship_roll.py').read_text(encoding='utf-8').split('\n')
cli = Path('_ship_cli.py').read_text(encoding='utf-8').split('\n')


def seg(src, first, last):
    """1-based inclusive slice, the way the plan's ranges are written."""
    return src[first - 1:last]


BOOT = '''from __future__ import annotations

import argparse
import importlib.util
import json
import os
import random
import string
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent'''.split('\n')

# The six names the render/output half binds that the roll half does not.
SURFACE_EXTRA = '''
# Bound only by the render/output half below. asset_folder is npc_folder under
# a name that does not say NPC; the rest are used verbatim. The design's list
# is nineteen names; these six take this file's total to twenty-five, and
# test/test_shared_surface.py pins all of them.
Knobs = npc.Knobs
entry_for = npc.entry_for
fetch = npc.fetch
_safe = npc._safe
next_run_folder = npc.next_run_folder
asset_folder = npc.npc_folder              # <root>/<category>/<Name>/, suffixed'''.split('\n')

out = []
out += seg(cli, 1, 56)          # shebang + module docstring; drops the FOLD NOTE at 57-80
out += ['']
out += BOOT                     # union of both halves' imports
out += ['']
out += seg(roll, 38, 137)       # guarded _load_art/_load_npc, npc/art/sp, borrowed surface
out += SURFACE_EXTRA
out += seg(roll, 138, 1074)     # roll half: constants, filters, roller, prompt templates
out += ['']
out += seg(cli, 157, 160)       # "Token sizing" section header
out += seg(cli, 166, 212)       #   skips 161-165: duplicate PORTRAIT_SIZE
out += seg(cli, 233, 479)       #   skips 213-232: duplicate PLAN_FRAMING
out += seg(cli, 640, 2129)      #   skips 480-639: duplicate TRAIT_DEPENDENTS,
                                #   trait_cascade, check_tables, REROLLABLE_TRAITS
                                #   and RAW_REROLLABLE_TRAITS, and the
                                #   `from _ship_roll import ...` block with them
Path('generate-spaceship.py').write_text('\n'.join(out), encoding='utf-8')
print('wrote generate-spaceship.py (%d lines)' % len(out))
```

- [ ] **Step 3: Run the splice and check it parses**

```bash
python build_merge.py
python -c "import ast; ast.parse(open('generate-spaceship.py',encoding='utf-8').read()); print('AST OK')"
```

Expected: `wrote generate-spaceship.py (2897 lines)` then `AST OK`.

- [ ] **Step 4: Confirm the cross-import is gone and each duplicate survives once**

```bash
grep -n '_ship_roll\|_ship_cli' generate-spaceship.py
grep -cE '^TRAIT_DEPENDENTS =|^REROLLABLE_TRAITS =|^RAW_REROLLABLE_TRAITS =|^PLAN_FRAMING =|^PORTRAIT_SIZE =|^def check_tables|^def trait_cascade' generate-spaceship.py
```

Expected: **no output** from the first command (the `from _ship_roll import (...)` block sat inside the skipped 480-639 range); **`7`** from the second — one of each, no duplicates.

- [ ] **Step 5: Verify behaviour is byte-identical to the baseline**

```bash
python generate-spaceship.py --dry-run --count 20 --seed 11 > /tmp/dry20.new 2>&1
python generate-spaceship.py --ship-catalogue                > /tmp/cat.new  2>&1
python generate-spaceship.py --help                          > /tmp/help.new 2>&1
diff .merge-baseline/dry20.txt      /tmp/dry20.new && echo "dry-run IDENTICAL"
diff .merge-baseline/catalogue.json /tmp/cat.new   && echo "catalogue IDENTICAL"
diff .merge-baseline/help.txt       /tmp/help.new  && echo "help IDENTICAL"
```

Expected: three `IDENTICAL` lines and no diff output. If any differs, the splice ranges drifted — do **not** hand-patch the output; fix the range and re-run Step 3.

- [ ] **Step 6: Verify the GUI's parser reads all four constants out of the merged source**

This is the acceptance gate the whole GUI plan rests on (Global Constraints, and F7).

```bash
node -e "
const ot = require('G:/GIT-REPOS/lancer-npc-import-gui/.claude/worktrees/ultracode-features/lib/overrideTables.js');
const src = require('fs').readFileSync('generate-spaceship.py', 'utf8');
const rt = ot.parseRequiredTables(src);
const rr = ot.rerollableTraitsFrom(src);
const raw = ot.rawRerollableTraitsFrom(src);
const dep = ot.traitDependentsFrom(src);
console.log('REQUIRED_TABLES', rt.length, '| REROLLABLE', rr.length,
            '| RAW_REROLLABLE', raw.length, '| DEPENDENTS', Object.keys(dep).length);
const ok = rt.length === 18 && rr.length === 16 && raw.length === 16 && Object.keys(dep).length === 9;
console.log(ok ? 'PARSE OK' : 'PARSE FAIL');
process.exit(ok ? 0 : 1);
"
```

Expected: `REQUIRED_TABLES 18 | REROLLABLE 16 | RAW_REROLLABLE 16 | DEPENDENTS 9` then `PARSE OK`.

`DEPENDENTS 9`, not 18, is **correct**: `traitDependentsFrom` drops leaf entries (`if (freed.length)`), and 9 of the 18 keys have non-empty tuples (`Theme`, `Ship type`, `Size`, `Faction`, `Hull`, `Weapon`, `Shield generator`, `Launch catapult`, `Backdrop`).

- [ ] **Step 7: Run the full suite and confirm the untouched-files guarantee**

```bash
python -m unittest discover -s test -q
git diff --stat HEAD -- generate-npc.py generate-art.py generate-3d.py ship_policy.py
```

Expected: `OK (skipped=1)` over 999 tests, and **no output at all** from `git diff --stat` — that silence is the zero-churn guarantee.

- [ ] **Step 8: Delete the halves and the scaffolding, then commit**

```bash
git rm -q _ship_roll.py _ship_cli.py
rm -rf .merge-baseline build_merge.py
git add generate-spaceship.py
git status --short
git commit -F - <<'MSG'
feat: fold the ship roller and the ship CLI into generate-spaceship.py

The two halves were authored in parallel so they would not collide in one
file; both worked, and each carried its own copy of nine definitions. The
copies were logically identical, so this is one file's worth of prose picked
between two, not a reconciliation of logic.

The bootstrap is the roller's rather than the CLI's, and that is a fix. The
CLI's loader took generate-art.py first and generate-npc.py second, and
generate-npc.py runs its own by-path load of generate-art.py under the same
sys.modules name - so art.Entry and npc.art.Entry were two classes with one
name, and any isinstance between them quietly answered False. The roller's
loader takes npc first and guards the art load on sys.modules.

A dry run of twenty ships at seed 11 is byte-identical to the pre-merge file's,
and the import GUI's lib/overrideTables.js parses all four source-read
constants out of the merged text - which neither half managed on its own.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019AYPnwSrCWF7pppwUnA8pq
MSG
```

---

### Task 1b: Add `--out-root` (unblocks the GUI's `spaceshipOutputRoot`)

**Files:**
- Modify: `generate-spaceship.py` — `parse_args` (the output group) and `default_root()`
- Test: `test/test_ship_cli.py` (new file if Task 3 has not run yet)

**Interfaces:**
- Consumes: `parse_args`, `default_root()` from Task 1.
- Produces: `args.out_root: Path | None`. When set, run folders are numbered under it via `next_run_folder`. `--out` (an explicit run folder) still wins over it.

**Why:** F2 — the GUI design's assumption A3 says `--out-root` exists. It does not. The GUI's `spaceshipOutputRoot` config key is dead without it, and the alternative (`--out`) pins every run to one folder because `--out` names a *run* folder, not a root.

- [ ] **Step 1: Write the failing test**

Create (or extend) `test/test_ship_cli.py`:

```python
"""The ship CLI's argument surface.

The import GUI builds argv for this script by hand, so every flag it emits has
to parse and every refusal has to be a refusal rather than a silently dropped
argument.
"""
import unittest
from pathlib import Path

from test.helpers import load_ship_generator

ship = load_ship_generator()


class TestOutRoot(unittest.TestCase):
    """--out-root picks the tree run folders are numbered under."""

    def test_out_root_is_parsed_as_a_path(self):
        self.assertEqual(ship.parse_args(["--out-root", "D:/ships"]).out_root,
                         Path("D:/ships"))

    def test_absent_out_root_is_none(self):
        self.assertIsNone(ship.parse_args([]).out_root)

    def test_explicit_out_wins_over_out_root(self):
        args = ship.parse_args(["--out-root", "D:/ships", "--out", "D:/one-run"])
        self.assertEqual(args.out, Path("D:/one-run"))
```

- [ ] **Step 2: Run it and watch it fail**

```bash
python -m unittest test.test_ship_cli.TestOutRoot -v
```

Expected: FAIL — `AttributeError: 'Namespace' object has no attribute 'out_root'`.

- [ ] **Step 3: Implement it**

In `parse_args`, beside the existing `--out` argument:

```python
    out.add_argument("--out-root", type=Path, default=None, metavar="DIR",
                     help="tree to number run folders under; --out names one "
                          "run folder and wins over this. The import GUI "
                          "passes it from config.spaceshipOutputRoot.")
```

And in `default_root()`, prefer it:

```python
def default_root(args=None):
    """The tree run folders are numbered under.

    --out-root before the environment before the module default, because the
    GUI configures a root per kind and the ship tree is not the NPC tree.
    """
    if args is not None and args.out_root:
        return args.out_root
    return DEFAULT_OUTPUT_ROOT
```

Update the one `default_root()` call site to pass `args`.

- [ ] **Step 4: Run the tests**

```bash
python -m unittest test.test_ship_cli.TestOutRoot -v
python -m unittest discover -s test -q
```

Expected: 3 passing, then the full suite green.

- [ ] **Step 5: Commit**

```bash
git add generate-spaceship.py test/test_ship_cli.py
git commit -F - <<'MSG'
feat: --out-root, so the GUI can put ships somewhere of its own

--out names a run folder, so a configured --out would pin every ship run to
one directory and the second run would collide with the first. --out-root
names the tree the run folders are numbered under, which is the shape
config.spaceshipOutputRoot needs.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019AYPnwSrCWF7pppwUnA8pq
MSG
```

---

### Task 2: Fix the sentence-join capitalization defect

**Files:**
- Modify: `generate-spaceship.py` — add `sentence_case()`, use it in `build_ship_prompts()`
- Modify: `test/helpers.py` — add `load_ship_generator()`
- Create: `test/test_ship_prompts.py`

**Interfaces:**
- Consumes: `build_ship_prompts(ship)`, `PLAN_FRAMING`, `sp.bridge_sentence`, `sp.armament_sentence` from Task 1.
- Produces: `sentence_case(text: str) -> str` — upper-cases the first character only, leaving the rest untouched.
- Produces (test helper): `load_ship_generator() -> module`.

**The defect.** 40 lowercase sentence-starts across 20 ships, two per ship, in every prompt the model ever sees:

> …short barrels and open ammunition lockers bolted beside each mount. **a** faired-over sensor blister of solid armour plate…

**Four join sites, measured** (F5):

| site | template | share of the 40 |
|---|---|---|
| `"…an empty plain white void. "` + `{plan}` | `TOKEN_TEMPLATE` | **20** — all four `PLAN_FRAMING` values are lowercase |
| `sp.bridge_sentence()`'s `"%s. "` — the Command bridge bullet, after `armament_line`'s or `{detail}`'s full stop | both | the bulk of the rest |
| `{markings}` after `bridge_line`'s trailing `". "` | both | the remainder |

**Use `text[:1].upper() + text[1:]`, never `str.capitalize()`.** `capitalize()` lower-cases the remainder — `"a Karrakin hull".capitalize()` is `"A karrakin hull"` — and the tables carry proper nouns (`Karrakin`, `Chartered`, `Unaligned`, `Trader`, `Free`). The slice-upper form is already the house idiom in this very file: `ship_fields()` builds its `"Ship"` key with exactly it.

**Fix in `build_ship_prompts`, not in `ship_policy.py`.** `ship_policy.py` is a settled 930-line module with 86 passing tests, and `test_ship_policy.py` asserts on `bridge_sentence`'s exact output. Capitalizing there is a wider blast radius for no gain: the generator owns sentence assembly.

- [ ] **Step 1: Add `load_ship_generator()` to `test/helpers.py`**

Twelve lines, mirroring `load_3d()` at `test/helpers.py:33-45`:

```python
_cached_ship = None


def load_ship_generator():
    """The generate-spaceship.py module object, loaded once per process.

    Same by-path load as load_generator(), for the same reason: the hyphen
    keeps generate-spaceship.py off the normal import path.
    """
    global _cached_ship
    if _cached_ship is None:
        spec = importlib.util.spec_from_file_location(
            "genship", REPO / "generate-spaceship.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules["genship"] = module
        spec.loader.exec_module(module)
        _cached_ship = module
    return _cached_ship
```

- [ ] **Step 2: Write the failing test**

Create `test/test_ship_prompts.py`:

```python
"""No ship prompt starts a sentence in lower case.

The Detail, Command bridge, Markings and {plan} clauses are all bullets or
phrases written to sit mid-sentence, and the templates join several of them
with a full stop. Nothing capitalized them, so every prompt the model ever saw
carried about two lowercase sentence-starts - 40 across twenty ships, and half
of those were {plan} following the token template's white-void sentence.

The NPC script never has this problem because each of its clauses opens with a
{Subject} slot that pronoun_fields() capitalizes (generate-npc.py:1727). A hull
has no pronoun, so the ship script capitalizes at the join instead.

Asserted over the LIVE tables rather than a fixture: the defect is a property
of how the real bullets are punctuated, and a fixture would only prove that the
assertion runs.
"""
import random
import re
import unittest

from test.helpers import load_ship_generator

ship = load_ship_generator()
TABLES = ship.parse_tables(ship.DEFAULT_TABLES)

# A full stop, a space, then a lower-case letter. Safe against decimals -
# "1.5" has no space - and the tables carry no abbreviation in this shape.
LOWER_SENTENCE_START = re.compile(r'\. [a-z]')


class TestNoLowercaseSentenceStarts(unittest.TestCase):
    def test_no_prompt_starts_a_sentence_in_lower_case(self):
        offenders = []
        for seed in range(60):
            rolled = ship.roll_ship(TABLES, random.Random(seed))
            for label, text in zip(("portrait", "token"),
                                   ship.build_ship_prompts(rolled)):
                for m in LOWER_SENTENCE_START.finditer(text):
                    offenders.append(
                        "seed %d %s: ...%s..."
                        % (seed, label, text[max(0, m.start() - 40):m.end() + 30]))
        self.assertEqual(
            offenders, [],
            "%d lowercase sentence-starts, first ten:\n%s"
            % (len(offenders), "\n".join(offenders[:10])))


class TestSentenceCase(unittest.TestCase):
    def test_capitalises_only_the_first_character(self):
        self.assertEqual(ship.sentence_case("a Karrakin hull"), "A Karrakin hull")

    def test_leaves_an_already_capital_alone(self):
        self.assertEqual(ship.sentence_case("A Karrakin hull"), "A Karrakin hull")

    def test_an_empty_string_is_safe(self):
        self.assertEqual(ship.sentence_case(""), "")
```

- [ ] **Step 3: Run it and watch it fail with the real count**

```bash
python -m unittest test.test_ship_prompts -v
```

Expected: `TestNoLowercaseSentenceStarts` FAILS reporting well over 100 offenders across 60 seeds (the 20-ship sample measured exactly 40), and all three `TestSentenceCase` cases fail with `AttributeError: module 'genship' has no attribute 'sentence_case'`.

- [ ] **Step 4: Implement `sentence_case`**

Add it beside `ship_fields()` in `generate-spaceship.py`:

```python
def sentence_case(text):
    """`text` with its first character upper-cased and nothing else touched.

    Not str.capitalize(), which lower-cases the remainder: 'a Karrakin hull'
    would come back 'A karrakin hull' with the house name flattened, and the
    live tables carry Karrakin, Chartered, Unaligned, Free and Trader. This is
    the same slice-upper that ship_fields() already builds its 'Ship' key with.

    The clauses this is applied to are bullets, and a bullet is authored to sit
    mid-sentence; the templates then join several of them with a full stop.
    Nothing capitalized them, so every prompt carried about two lowercase
    sentence-starts. The NPC templates never hit this, because every clause of
    theirs opens with a {Subject} that pronoun_fields() capitalizes
    (generate-npc.py:1727) - a hull has no pronoun, so the capital has to be
    put on here.
    """
    return text[:1].upper() + text[1:]
```

- [ ] **Step 5: Apply it at all four joins**

In `build_ship_prompts()`, **after** the `fields.update({...})` block (or the assignments will be overwritten) and after `faction_line` is computed:

```python
    fields["armament_line"] = sp.armament_sentence(ship)

    # bridge_sentence() returns "<bullet>. " and the bullet is authored lower
    # case to sit mid-sentence. It always follows either the armament
    # sentence's full stop or {detail}'s, so it always starts a sentence.
    fields["bridge_line"] = sentence_case(sp.bridge_sentence(ship))

    # Markings follows bridge_line's full stop - unless a faction visual sits
    # between them, which ends in ", " and leaves Markings mid-sentence. The
    # two unaffiliated Faction bullets have empty visuals, so faction_line
    # cannot be relied on either way and the branch is real.
    fields["markings"] = (ship["Markings"] if fields["faction_line"]
                          else sentence_case(ship["Markings"]))

    # {plan} opens the token's closing tag block, straight after "...an empty
    # plain white void. ". Half of every occurrence of this defect was here,
    # and the first write-up of the bug missed it.
    fields["plan"] = sentence_case(PLAN_FRAMING[band])
```

- [ ] **Step 6: Run the tests and the original reproduction**

```bash
python -m unittest test.test_ship_prompts -v
python generate-spaceship.py --dry-run --count 20 --seed 11 2>&1 | grep -coE '\. [a-z]'
```

Expected: all four tests PASS, and the grep prints **`0`** (it printed `40` before).

- [ ] **Step 7: Read two prompts by eye**

```bash
python generate-spaceship.py --dry-run --count 2 --seed 11
```

Expected: a capital only ever after a full stop. No `", A "` sequences (that would mean Markings was capitalized mid-sentence), no `". ."`, no doubled capitals.

- [ ] **Step 8: Run the full suite and commit**

```bash
python -m unittest discover -s test -q
git add generate-spaceship.py test/test_ship_prompts.py test/helpers.py
git commit -F - <<'MSG'
fix: a capital after every full stop in a ship prompt

The Detail, Command bridge, Markings and {plan} clauses are bullets and
phrases authored to sit mid-sentence, and the templates join several of them
with ". ". Nothing capitalized them, so every prompt carried about two
lowercase sentence-starts - 40 across twenty ships. Half of those were {plan}
following the token template's white-void sentence, which the first write-up
of this bug missed entirely.

Capitalized with a slice-upper rather than str.capitalize(), which would
lower-case the remainder and flatten Karrakin, Chartered and Unaligned. It is
the idiom ship_fields() already builds its 'Ship' key with. Markings keeps its
lower case when a faction visual precedes it, because it is mid-sentence there.

Fixed at the join in the generator rather than in ship_policy.bridge_sentence,
which is a settled module with 86 tests asserting on its exact output.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019AYPnwSrCWF7pppwUnA8pq
MSG
```

---

### Task 3: Cover the generator with tests

**Files:**
- Create: `test/fixtures/ship-tables-minimal.md`
- Create: `test/test_shared_surface.py`, `test/test_ship_size.py`, `test/test_ship_roll.py`, `test/ship_prompt_budget.py`, `test/test_ship_prompt_budget.py`, `test/test_ship_manifest.py`
- Modify: `test/test_ship_cli.py` (started in Task 1b)
- Modify: `test/test_ship_policy.py` — delete the skip guard at `:551-556`, **last**

**Interfaces:**
- Consumes: everything Task 1 produces, plus `sentence_case` from Task 2 and `load_ship_generator` from Task 2 Step 1.
- Produces: no production code. `test/ship_prompt_budget.py` exposes `measure(ship, tables, count=1500, seed=0) -> list[tuple[int, int]]` and is deliberately **not** named `test_*`, mirroring `test/prompt_budget.py`.

Design §8 is the full test plan (§8.1–§8.14). This task implements the five items `REMAINING-WORK.md` calls the minimum, in dependency order. Take the rest from §8 if time allows — they are specified there and need no re-derivation.

- [ ] **Step 1: Build the fixture tables file**

`test/fixtures/ship-tables-minimal.md`, per design §8.14: every `REQUIRED_TABLES` heading; a `none` bullet plus ≥3 neutral bullets plus one bullet at each band in each of the four equipment tables; ≥1 bullet carrying each `SHIP_TYPES` slug; one `@tag` on each of the five `THEMED_TABLES`; one bullet per table carrying a `{...}` placeholder.

**Every bullet must be one physical line.** `parse_tables`' bullet regex is `^-\s+(.*?)\s*$` and continuation lines match nothing, so a hard-wrapped bullet is silently truncated at its first physical line and loses its whole flag segment. That is the exact defect that made `scene-and-spaceship-tables.md` unparseable and it is easy to reintroduce by hand.

Verify it parses before writing anything against it:

```bash
python -c "
from test.helpers import load_ship_generator
from pathlib import Path
s = load_ship_generator()
t = s.parse_tables(Path('test/fixtures/ship-tables-minimal.md'))
missing = [n for n in s.REQUIRED_TABLES if n not in t]
print('tables:', len(t), 'missing:', missing)
print('shortest bullet:', min(len(b) for bs in t.values() for b in bs))
"
```

Expected: `missing: []` and a shortest bullet comfortably over 20 characters — a truncated bullet is conspicuously short.

- [ ] **Step 2: Write `test/test_shared_surface.py` — the churn guard, first because it is cheapest**

```python
"""What generate-spaceship.py borrows off its two siblings, written down.

The ship generator changes zero lines of generate-npc.py and generate-art.py
and loads both by path instead. That is only safe while somebody can see what
it depends on, so this file is the list: an NPC-side rename fails here, at test
time, rather than three hundred lines into a render.

It is also the input to the deferred lancerlib extraction (design 1, phase 2) -
the empirical surface rather than the guessed one.
"""
import unittest

from test.helpers import load_ship_generator

ship = load_ship_generator()

NPC_SURFACE = ("parse_tables", "variant_table", "heading_for", "split_flags",
               "split_backdrop", "split_faction", "flags_for", "themes_of",
               "filter_by_theme", "apply_theme_share", "filter_by_mil",
               "THEME_SHARE", "has_light_source", "light_hues",
               "glow_hue_families", "filter_by_hue", "estimate_tokens",
               "TOKEN_LIMIT", "CHARS_PER_TOKEN", "Knobs", "entry_for",
               "fetch", "_safe", "next_run_folder", "npc_folder")

ART_SURFACE = ("WORKFLOW_DIR", "DEFAULT_WORKFLOW", "POST_ALIASES", "Entry",
               "_slug", "parse_set", "locate_slots", "locate_post_slots",
               "image_ref", "build_post_job", "build_job", "Comfy",
               "find_server", "load_api_workflow", "load_manifest",
               "save_manifest", "WorkflowError")


class TestBorrowedSurface(unittest.TestCase):
    def test_every_npc_name_still_exists(self):
        for name in NPC_SURFACE:
            with self.subTest(name=name):
                self.assertTrue(hasattr(ship.npc, name),
                                "generate-npc.py no longer has %r" % name)

    def test_every_art_name_still_exists(self):
        for name in ART_SURFACE:
            with self.subTest(name=name):
                self.assertTrue(hasattr(ship.art, name),
                                "generate-art.py no longer has %r" % name)

    def test_flags_for_still_returns_the_third_segment(self):
        bullet = "a name || a visual || mil palette"
        self.assertIn("mil", ship.flags_for("Faction", bullet))
        self.assertIn("mil", ship.flags_for("Backdrop", bullet))

    def test_knobs_still_takes_a_size(self):
        args = ship.parse_args(["--dry-run"])
        knobs = ship.Knobs(args, (1536, 768), ship.COMFY_PREFIX)
        self.assertEqual((knobs.width, knobs.height), (1536, 768))

    def test_the_art_module_is_the_one_generate_npc_is_holding(self):
        """The guarded loader's whole reason: one art module, not two.

        generate-npc.py runs its own by-path load of generate-art.py under the
        same sys.modules name. Load art first and unguarded and ship.art and
        ship.npc.art become two module objects with the same name - nothing
        crashes, but an isinstance between their Entry classes starts quietly
        answering False.
        """
        self.assertIs(ship.art, ship.npc.art)
```

- [ ] **Step 3: Run it**

```bash
python -m unittest test.test_shared_surface -v
```

Expected: all PASS. A failure here names the renamed symbol directly.

- [ ] **Step 4: Write `test/test_ship_size.py` — token sizing (design §8.4)**

```python
"""The token's canvas, its grid footprint, and the one number Foundry reads.

Two numbers are easy to confuse and the manifest carries both: gridWidth is a
HEX COUNT and tokenWidth is PIXELS. A 1728 in Foundry's token.width would draw
a cruiser across a map the size of a continent, so the distinction is asserted
here rather than trusted - the GUI's importer reads these fields.
"""
import unittest

from test.helpers import load_ship_generator

ship = load_ship_generator()
sp = ship.sp


class TestTokenGrid(unittest.TestCase):
    def test_width_is_read_off_ship_policy_not_typed_twice(self):
        for band in sp.SIZE_ORDER:
            with self.subTest(band=band):
                self.assertEqual(ship.TOKEN_GRID[band][0], sp.hexes_for(band))

    def test_every_band_is_covered_exactly_once(self):
        self.assertEqual(set(ship.TOKEN_GRID), set(sp.SIZE_ORDER))
        self.assertEqual(set(ship.TOKEN_PX_PER_HEX), set(sp.SIZE_ORDER))
        self.assertEqual(set(ship.PLAN_FRAMING), set(sp.SIZE_ORDER))

    def test_grid_widths_are_one_two_three_five_and_increasing(self):
        self.assertEqual([ship.TOKEN_GRID[b][0] for b in sp.SIZE_ORDER],
                         [1, 2, 3, 5])

    def test_every_plan_phrase_is_non_empty(self):
        for band, phrase in ship.PLAN_FRAMING.items():
            with self.subTest(band=band):
                self.assertTrue(phrase.strip())


class TestTokenCanvas(unittest.TestCase):
    def test_both_dimensions_are_multiples_of_64(self):
        for band in sp.SIZE_ORDER:
            w, h = ship.token_size(band)
            with self.subTest(band=band):
                self.assertEqual((w % 64, h % 64), (0, 0))

    def test_area_is_within_the_budget(self):
        for band in sp.SIZE_ORDER:
            w, h = ship.token_size(band)
            with self.subTest(band=band):
                self.assertLessEqual(w * h, ship.MAX_TOKEN_PX)

    def test_canvas_aspect_equals_grid_aspect(self):
        for band in sp.SIZE_ORDER:
            gw, gh = ship.TOKEN_GRID[band]
            w, h = ship.token_size(band)
            with self.subTest(band=band):
                self.assertAlmostEqual(w / h, gw / gh, places=2)

    def test_a_tighter_budget_preserves_aspect_and_the_64_floor(self):
        for band in sp.SIZE_ORDER:
            gw, gh = ship.TOKEN_GRID[band]
            w, h = ship.token_size(band, max_px=1_000_000)
            with self.subTest(band=band):
                self.assertLessEqual(w * h, 1_000_000)
                self.assertGreaterEqual(min(w, h), 64)
                self.assertEqual((w % 64, h % 64), (0, 0))
                self.assertAlmostEqual(w / h, gw / gh, delta=0.02 * gw / gh)


class TestTokenMetadata(unittest.TestCase):
    def test_grid_fields_are_hexes_and_token_fields_are_pixels(self):
        meta = ship.token_metadata("large")
        self.assertEqual(meta["gridWidth"], 3)
        self.assertEqual(meta["gridHeight"], 2)
        self.assertEqual((meta["tokenWidth"], meta["tokenHeight"]),
                         ship.token_size("large"))
        self.assertGreater(
            meta["tokenWidth"], 100,
            "tokenWidth is PIXELS; a hex count here would be a cross-repo "
            "contract break - see the GUI plan's F1")

    def test_every_numeric_field_is_an_int(self):
        for band in sp.SIZE_ORDER:
            for key, value in ship.token_metadata(band).items():
                if key == "sizeBand":
                    continue
                with self.subTest(band=band, key=key):
                    self.assertIsInstance(value, int)
```

- [ ] **Step 5: Run it**

```bash
python -m unittest test.test_ship_size -v
```

Expected: all PASS.

- [ ] **Step 6: Write `test/test_ship_roll.py` — the equipment policy through the REAL roller**

This is the assertion `REMAINING-WORK.md` singles out: `test_ship_policy.py` proves the filters, and this proves the roller actually calls them.

```python
"""The user's hard constraint, asserted through the roller rather than the filter.

    "non-combat ships like cargo ships, should have minimal shielding and
     weapons (if any) and no launch catapults. combat ships depending on their
     type and size may have some or many of the previously described features."

test_ship_policy.py holds that against filter_by_ship_policy directly. This
file holds it against roll_ship, which is the only thing that proves the roller
reaches the filter at all - a roller that forgot the policy call would leave
that whole file green.

Reachability is asserted before legality, for test_role_lock.py's reason: an
assertion about what never happens passes on an empty set.
"""
import random
import unittest

from test.helpers import load_ship_generator

ship = load_ship_generator()
sp = ship.sp
TABLES = ship.parse_tables(ship.DEFAULT_TABLES)

NO_CATAPULT_TYPES = ("cargo", "support", "smuggler")


def roll_many(count, seed=0, overrides=None):
    return [ship.roll_ship(TABLES, random.Random(seed + n), overrides)
            for n in range(count)]


class TestDeterminism(unittest.TestCase):
    def test_the_same_seed_gives_the_same_ship(self):
        self.assertEqual(ship.roll_ship(TABLES, random.Random(7)),
                         ship.roll_ship(TABLES, random.Random(7)))

    def test_a_probe_changes_nothing(self):
        """The guarantee that makes trait_choices safe to call read-only."""
        plain = ship.roll_ship(TABLES, random.Random(7))
        probed = ship.roll_ship(TABLES, random.Random(7), probe={})
        self.assertEqual(plain, probed)


class TestTheRollIsClean(unittest.TestCase):
    def test_no_flag_segment_or_placeholder_survives(self):
        for rolled in roll_many(200):
            for name, value in rolled.items():
                if name.startswith("_"):
                    continue
                with self.subTest(trait=name):
                    self.assertNotIn("||", value)
                    self.assertNotIn("{", value)

    def test_every_required_table_is_a_key_of_both_dicts(self):
        rolled = ship.roll_ship(TABLES, random.Random(1))
        for name in ship.REQUIRED_TABLES:
            with self.subTest(trait=name):
                self.assertIn(name, rolled)
                self.assertIn(name, rolled["_raw"])


class TestTheEquipmentPolicyThroughTheRoller(unittest.TestCase):
    def test_no_hauler_ever_gets_a_launch_catapult(self):
        seen = {t: 0 for t in NO_CATAPULT_TYPES}
        for rolled in roll_many(200):
            slug = ship.ship_type_of(rolled)
            if slug not in NO_CATAPULT_TYPES:
                continue
            seen[slug] += 1
            self.assertEqual(
                rolled["Launch catapult"], sp.NO_EQUIPMENT,
                "%s rolled a launch catapult: %r"
                % (slug, rolled["Launch catapult"]))
        for slug, n in seen.items():
            self.assertGreater(
                n, 0, "no %s ever rolled - the assertion is vacuous" % slug)

    def test_every_carrier_gets_one(self):
        carriers = 0
        for rolled in roll_many(400):
            if ship.ship_type_of(rolled) != "carrier":
                continue
            carriers += 1
            self.assertNotEqual(rolled["Launch catapult"], sp.NO_EQUIPMENT)
        self.assertGreater(carriers, 0, "no carrier ever rolled")

    def test_a_forced_hauler_still_cannot_get_one(self):
        for slug in NO_CATAPULT_TYPES:
            bullet = next(b for b in TABLES["Ship type"]
                          if slug in ship.split_flags(b)[1])
            for rolled in roll_many(40, seed=1000,
                                    overrides={"Ship type": bullet}):
                with self.subTest(slug=slug):
                    self.assertEqual(rolled["Launch catapult"], sp.NO_EQUIPMENT)


class TestTheReverseGates(unittest.TestCase):
    def test_a_huge_hull_is_never_a_patrol_boat(self):
        for rolled in roll_many(300):
            if sp.size_of(rolled["_raw"]["Size"]) == "huge":
                self.assertNotEqual(ship.ship_type_of(rolled), "patrol")

    def test_a_fitted_catapult_means_carrier_or_battleship(self):
        for rolled in roll_many(300):
            if rolled["Launch catapult"] != sp.NO_EQUIPMENT:
                self.assertIn(ship.ship_type_of(rolled),
                              ("carrier", "battleship"))


class TestTokenSizeMatchesTheRolledBand(unittest.TestCase):
    def test_every_ships_metadata_matches_hexes_for_its_band(self):
        for rolled in roll_many(200):
            band = sp.size_of(rolled["_raw"]["Size"])
            meta = ship.token_metadata(band)
            with self.subTest(band=band):
                self.assertEqual(meta["gridWidth"], sp.hexes_for(band))
                self.assertEqual(meta["hexes"], sp.hexes_for(band))


class TestTraitCascade(unittest.TestCase):
    def test_it_is_ordered_by_required_tables(self):
        cascade = ship.trait_cascade("Ship type")
        order = [ship.REQUIRED_TABLES.index(t) for t in cascade]
        self.assertEqual(order, sorted(order))

    def test_an_unknown_name_raises_rather_than_closing_to_empty(self):
        with self.assertRaises(ValueError):
            ship.trait_cascade("Hairstyle")
```

- [ ] **Step 7: Run it**

```bash
python -m unittest test.test_ship_roll -v
```

Expected: all PASS. If `test_no_hauler_ever_gets_a_launch_catapult` fails, `roll_ship` is not calling `filter_by_ship_policy` — that is a real defect, not a test problem.

- [ ] **Step 8: Write the prompt-budget instrument and its test (design §8.5)**

`test/ship_prompt_budget.py` — **not** named `test_*`, so the runner does not collect it:

```python
"""Measure ship prompt lengths. An instrument, not a test - see test/prompt_budget.py."""
import contextlib
import io
import random


def measure(ship, tables, count=1500, seed=0):
    """[(portrait_tokens, token_tokens)] over `count` rolled ships.

    stderr is swallowed because build_ship_prompts warns on every prompt over
    the limit, and the point of this instrument is to count those rather than
    to print fifteen hundred of them.
    """
    results = []
    with contextlib.redirect_stderr(io.StringIO()):
        for n in range(count):
            rolled = ship.roll_ship(tables, random.Random(seed + n))
            portrait, token = ship.build_ship_prompts(rolled)
            results.append((ship.estimate_tokens(portrait),
                            ship.estimate_tokens(token)))
    return results
```

`test/test_ship_prompt_budget.py`:

```python
"""No ship prompt is truncated by the model's token limit.

p99 rather than max, for the reason test/test_prompt_budget.py:23-32 gives: the
tail is one unlucky pairing of the two longest bullets in the file, and holding
the max under the limit would cost more content than the one truncated render
is worth.
"""
import unittest

from test import ship_prompt_budget
from test.helpers import load_ship_generator

ship = load_ship_generator()
TABLES = ship.parse_tables(ship.DEFAULT_TABLES)
RESULTS = ship_prompt_budget.measure(ship, TABLES, count=1500, seed=0)


def p99(values):
    return sorted(values)[int(len(values) * 0.99)]


class TestPromptBudget(unittest.TestCase):
    def test_the_sample_is_not_vacuous(self):
        self.assertEqual(len(RESULTS), 1500)
        self.assertGreater(min(min(r) for r in RESULTS), 200)

    def test_portrait_p99_is_under_the_limit(self):
        self.assertLess(p99([r[0] for r in RESULTS]), ship.TOKEN_LIMIT)

    def test_token_p99_is_under_the_limit(self):
        self.assertLess(p99([r[1] for r in RESULTS]), ship.TOKEN_LIMIT)
```

- [ ] **Step 9: Run it**

```bash
python -m unittest test.test_ship_prompt_budget -v
```

Expected: PASS. A dry run currently measures the portrait at ~328 tokens and the token at ~363 against a 512 limit, so there is real headroom.

- [ ] **Step 10: Write `test/test_ship_manifest.py` — `--apply-only` parity and the entry shape**

Model it on `test/test_apply_only.py`, the NPC equivalent written for commit `8e78e07`. **Drive it through `regenerate_one()`**, not by rebuilding the writer's dicts inline — `test_reroll_trait.py::TestTheRegenWriterActuallyRuns` explains why: a test that reconstructs the writer by hand proves the shape is right and stays green when the writer is deleted, which is exactly how the NPC `--set-trait` gate rotted unnoticed.

Assert at minimum:

- `set(ship.SHIP_FOLDERS) == set(sp.SHIP_TYPES)`, every value non-empty and `_safe`-stable.
- A written entry carries `id`, `kind == "spaceship"`, `name`, `callsign`, `seed`, `traits`, `rawTraits`, `files`, `portrait`, `token`, `portraitPrompt`, `tokenPrompt`, `dossier`, `when`, `sizeBand`, `hexes`, `gridWidth`, `gridHeight`, `tokenWidth`, `tokenHeight`; `id` matches `^ship-[a-z0-9-]+-\d+$`; the five numeric size fields are `int`.
- The folder is `<out>/<Category>/<Name>` — two levels, so `basename(dirname(folder))` recovers the category the way the GUI's `server.js:1570` does. A flat layout would file every ship under a category called `run1`.
- The manifest round-trips through `art.save_manifest`/`load_manifest` with no key collision when NPC entries share the file.
- **`TestSetTraitPersists`** — after a `--set-trait` regen, `entry["traits"]` and `entry["rawTraits"]` reflect the new value. This is the `generate-npc.py:4273` bug ships must not inherit, and the GUI's assumption A8 depends on it.
- **`--apply-only`**: stdout is pure JSON and nothing else, diagnostics go to stderr, and `artStale` is **popped** rather than set to false (parity with `generate-npc.py` commit `8e78e07`).
- After a regen, `sizeBand`/`gridWidth`/`gridHeight`/`tokenWidth`/`tokenHeight` are re-derived from the current `Size` trait rather than carried over.

- [ ] **Step 11: Run it**

```bash
python -m unittest test.test_ship_manifest -v
```

Expected: all PASS.

- [ ] **Step 12: Delete the skip guard in `test_ship_policy.py` — last, as the acceptance gate**

`test/test_ship_policy.py:551-556` skips `TestTheLiveTables` until the tables file exists. It has existed since commit `b6552d2`. The file's own comment (`:36-40`) says to delete the guard the day it lands — a skipping guard is a guard that is not guarding.

```bash
sed -n '545,560p' test/test_ship_policy.py     # read it before cutting
```

Remove the guard, then:

```bash
python -m unittest test.test_ship_policy -v
```

Expected: `TestTheLiveTables` now RUNS and passes. **The suite total becomes 1000 passing, 0 skipped** — the `1 skip` in the baseline was this one.

- [ ] **Step 13: Run the whole suite and commit**

```bash
python -m unittest discover -s test -q
git diff --stat HEAD -- generate-npc.py generate-art.py generate-3d.py ship_policy.py
git add test/
git commit -F - <<'MSG'
test: hold the ship generator to the brief, through the roller

test_ship_policy.py proved the filters; nothing proved the roller called them,
so a roller that forgot the policy call would have left that whole file green.
test_ship_roll.py asserts the user's constraint through roll_ship itself - no
cargo, support or smuggler hull ever reaches a launch catapult, and every
carrier does - and asserts reachability before legality, since a claim about
what never happens passes on an empty set.

test_ship_size.py pins the distinction the manifest makes and the importer
depends on: gridWidth is a hex count, tokenWidth is pixels.

test_shared_surface.py writes down the twenty-five names borrowed off
generate-npc.py and the seventeen off generate-art.py, so a rename over there
fails here rather than mid-render, and asserts the guarded loader really does
hold one art module rather than two.

The skip in test_ship_policy.py is gone. The tables file it was waiting for
has been there since b6552d2, and a skipping guard is not guarding.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019AYPnwSrCWF7pppwUnA8pq
MSG
```

---

### Task 4: The first real render against ComfyUI

**Files:**
- Modify: none expected. If the render exposes a defect, fix it in `generate-spaceship.py` and add the covering test.
- Create: `docs/spaceship-render-notes.md` — what came back, with both prompts and both images named.

**Interfaces:**
- Consumes: everything above.
- Produces: evidence. No API.

**Nothing has ever rendered.** Every check so far is `--dry-run`. The multi-hex token framing language has never met the model, and it is the part most likely to disappoint: `TOKEN_TEMPLATE` asserts framing three times because at CFG 1.0 a single "whole hull in frame" loses to the detail the rest of the prompt asks for, and the stern is the first thing cropped.

**Design §4's "no new workflow JSON needed" claim is verified** (F4) — do not re-derive it:

- `Lancer_Scene_Workflow_v1.json` has five `EmptyLatentImage` nodes; node `57` ("Token Image Size", 1024×1280) is the **only** one wired to KSampler `54`'s `latent_image`, so `locate_slots` picks it and `build_job` overwrites its `width`/`height`. The other four are pruned by `art.prune_orphans`.
- `Util_RemoveBackground_makeTransparent.json` has exactly one `RMBG` node, `process_res: 1024`, patched to `args.rmbg_res` by the post-workflow loader.
- `--rmbg-res` (default 1536) and the hard `SystemExit` on a missing latent slot are **already implemented**.

- [ ] **Step 1: Confirm ComfyUI is reachable before spending a render**

```bash
python generate-spaceship.py --dry-run --count 1 --seed 4242 --ship-type patrol --size small
```

Expected: one ship, both prompts printed, no stderr warnings. If ComfyUI is not running, start it. **This task cannot be completed without it — if it cannot be started, stop and report Task 4 as blocked. Do not mark it done on a dry run.**

- [ ] **Step 2: Render the 1-hex case**

```bash
python generate-spaceship.py --count 1 --seed 4242 --ship-type patrol --size small --out-root ./render-check
```

Expected: exit 0, and a run folder at `render-check/run1/Patrol boats/<Name>/` holding `<Name> Portrait.png`, `<Name> Token.png` and `<Name>.md`.

- [ ] **Step 3: Check the 1-hex results**

```bash
ls -la render-check/run1/*/*/
python -c "
import glob
from PIL import Image                      # any image reader will do
for p in glob.glob('render-check/run1/*/*/*.png'):
    im = Image.open(p); print(p, im.size, im.mode)
"
```

Expected: portrait `(1216, 832)` mode `RGB`; token `(1024, 1024)` mode `RGBA` — the alpha channel is what proves the RMBG pass ran. Open both. The portrait should read as the campaign's painterly house style; the token should be one hull on transparency with clear margin on all four sides.

- [ ] **Step 4: Render the 5-hex case — the one most likely to disappoint**

```bash
python generate-spaceship.py --count 1 --seed 9001 --ship-type carrier --size huge --out-root ./render-check
```

Expected: `render-check/run2/Carriers/<Name>/`, with the token canvas at `1920x1152` — a 5:3 aspect matching the 5×3 grid footprint.

- [ ] **Step 5: Judge the wide token against its grid footprint**

This is the acceptance question the whole multi-hex design rests on. Check in this order:

1. **Aspect.** Token is `1920x1152`; `5/3 = 1.667` and `1920/1152 = 1.667`. Foundry stretches the image into the token rectangle, so an exact match means no distortion on the map.
2. **Framing.** Is the hull *long*, filling the frame bow to stern? Or did the model draw a roughly square ship centred in a wide canvas with dead space either side? The second is the failure mode, and `PLAN_FRAMING["huge"]` ("a vast hull filling the frame bow to stern, half again as long as it is broad") is the sentence meant to prevent it.
3. **Cropping.** Is any of the stern, bow or wingtip cut off at the frame edge?
4. **Alpha quality.** At `--rmbg-res 1536`, are the antenna masts, sensor booms and catapult rails still in the alpha, or did the mask eat them? Re-run with `--rmbg-res 1024` to compare if they look thin — RMBG-2.0 infers at a square resolution and a 5:3 input is squashed 1.67× on the way in, which is exactly what drops thin high-frequency structure.

- [ ] **Step 6: Verify the dossier and the manifest entry**

```bash
cat render-check/run2/Carriers/*/*.md
python -c "
import json
m = json.load(open('.generated-npcs.json', encoding='utf-8'))
e = [v for v in m.values() if v.get('kind') == 'spaceship'][-1]
for k in ('id','kind','sizeBand','hexes','gridWidth','gridHeight','tokenWidth','tokenHeight'):
    print('%-12s %r  %s' % (k, e[k], type(e[k]).__name__))
"
```

Expected: `kind` is `spaceship`; `sizeBand` is `huge`; `gridWidth`/`gridHeight` are `5`/`3` as `int`; `tokenWidth`/`tokenHeight` are `1920`/`1152` as `int`.

**Confirm F1 with your own eyes here.** `tokenWidth` is pixels. The GUI must send `gridWidth` to Foundry, and the GUI plan's first task depends on this being read correctly.

- [ ] **Step 7: If the wide-token framing disappoints, tune the prompt and re-render**

Change `PLAN_FRAMING["huge"]` and/or the opening framing sentence of `TOKEN_TEMPLATE`, and nothing else. Do **not** change the canvas aspect — it is derived from the grid footprint and the manifest records it, so changing it desynchronises the render from the importer. Re-run Step 4 at the same seed so the comparison is honest, and record both prompts in the notes file.

- [ ] **Step 8: Write the notes, clean up the scratch renders, commit**

Record in `docs/spaceship-render-notes.md`: the two seeds, both prompts verbatim, the observed image sizes and modes, an answer to each of Step 5's four questions, and any prompt change made with its before/after. This is the only durable record that the framing was ever tested against the model.

```bash
rm -rf render-check
git add docs/spaceship-render-notes.md generate-spaceship.py
git commit -F - <<'MSG'
docs: what the first real ship renders actually looked like

Everything before this was --dry-run. The multi-hex token framing had never
met the model, and it was the part most likely to disappoint - at CFG 1.0 a
single "whole hull in frame" loses to the detail the rest of the prompt asks
for, and the stern is the first thing cropped. Recorded here at one hex and at
five, with both prompts, so the next change to PLAN_FRAMING has a baseline to
argue against rather than a memory.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019AYPnwSrCWF7pppwUnA8pq
MSG
```

---

## Acceptance for the whole plan

```bash
cd G:/GIT-REPOS/lancer-art-generator/.claude/worktrees/ultracode-spaceships

python generate-spaceship.py --help
python generate-spaceship.py --dry-run --count 20 --seed 11 2>&1 | grep -coE '\. [a-z]'   # 0
python generate-spaceship.py --ship-catalogue | python -m json.tool > /dev/null && echo "catalogue OK"
python -m unittest discover -s test -q                    # 1000 pass, 0 skip
git diff --stat HEAD~5 -- generate-npc.py generate-art.py generate-3d.py ship_policy.py   # empty
ls _ship_roll.py _ship_cli.py 2>&1                        # both gone

node -e "
const ot=require('G:/GIT-REPOS/lancer-npc-import-gui/.claude/worktrees/ultracode-features/lib/overrideTables.js');
const s=require('fs').readFileSync('generate-spaceship.py','utf8');
console.log(ot.parseRequiredTables(s).length, ot.rerollableTraitsFrom(s).length,
            ot.rawRerollableTraitsFrom(s).length, Object.keys(ot.traitDependentsFrom(s)).length);
"                                                          # 18 16 16 9
```

Then start `docs/superpowers/plans/2026-09-07-gui-spaceship-support.md`.
