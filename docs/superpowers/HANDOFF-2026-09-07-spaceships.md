# Handoff — spaceship support across two repos (2026-09-07)

> **Superseded** by [`COMPLETION-2026-09-07-spaceships.md`](COMPLETION-2026-09-07-spaceships.md):
> the remaining task finished, and both branches have since merged to `main` (GUI `2d02d57`,
> ART `f7752ac`). The state below is as of this handoff.

Two implementation plans were executed with `superpowers:subagent-driven-development`:
one implementer subagent per task, a task review after each, fix rounds until clean, then
a whole-branch final review. **11 of 12 tasks are complete and reviewed clean. One task
remains, plus one review.**

Everything below was measured, not assumed. Where a number is contested, both readings are given.

---

## 1. Where the work lives

| | path | branch | state |
|---|---|---|---|
| **ART** (generator) | `G:/GIT-REPOS/lancer-art-generator/.claude/worktrees/ultracode-spaceships` | `ultracode-spaceships` | **complete**, 11 commits, tree clean |
| **GUI** (import GUI) | `G:/GIT-REPOS/lancer-npc-import-gui/.claude/worktrees/ultracode-features` | `ultracode-features` | 6 of 7 tasks, 8 commits, tree clean |

Nothing is pushed. Nothing is on `main`. Both worktrees have clean status.

**The plans** (both live in the ART worktree, even the GUI one):
- `docs/superpowers/plans/2026-09-07-spaceship-generator-completion.md` — ART, Tasks 1, 1b, 2, 3, 4
- `docs/superpowers/plans/2026-09-07-gui-spaceship-support.md` — GUI, Tasks 1–7

**The ledgers** — read these first, they are the authoritative record and carry every ruling with its reasoning:
- `.superpowers/sdd/2026-09-07-spaceship-generator-completion/progress.md` (in the ART worktree)
- `.superpowers/sdd/2026-09-07-gui-spaceship-support/progress.md` (in the GUI worktree)

Alongside each ledger: `task-N-brief.md` (the task text extracted for its implementer),
`task-N-report.md` (what the implementer did), and `review-<base>..<head>.diff` packages.
Briefs for all remaining tasks are already generated.

---

## 2. What is done

**ART plan — complete.** Suite **1072 passing, 0 failing, 0 skipped** (`python -m unittest discover -s test -q`, ~92s).
- **T1/T1b** — merged `_ship_roll.py` + `_ship_cli.py` into `generate-spaceship.py` (~2,900 lines), byte-identical behaviour, added `--out-root`. Fixed a pre-existing bug where `--out` carried `--out-root` as an argparse *alias*, and adopted the guarded bootstrap so `ship.art is ship.npc.art` (previously two module objects with one name, making `isinstance` silently answer `False`).
- **T2** — sentence-join capitalization. The plan said four join sites; there were **five**.
- **T3** — six new test files. Caught two real generator defects: `weather_sentence()` returned pre-substitution text (a `{...}` placeholder would ship literally into a prompt), and `token_size()`'s clamp distorted aspect ratio.
- **T4** — first real ComfyUI renders. **The wide-token framing FAILED** (see §4).
- Final whole-branch review: all 13 findings closed, one cosmetic residual parked (§5).

**GUI plan — 6 of 7.** Suite **503 passing, 0 failing** (see §3 for the invocation that works).
- **T1** kind registry + paths · **T2** data plane · **T3** generator plane · **T4** Foundry import · **T5** client vocab seam · **T6** Create Spaceship tab (committed, **not yet reviewed**).

The plan's central architectural claim was *proven*, not asserted: the import, delete, seen
and unseen route handlers are untouched by the whole branch. Browse and import were already generic.

---

## 3. Read this before you run anything

**Use this command. Not bare `node --test`, not the README's current one:**

```bash
node --test --test-concurrency=8 "test/*.test.js"     # 503 pass, 0 fail, ~8.8s
```

The suite **hangs** at default concurrency. This is a real defect the branch introduced and
it is diagnosed with a fix; it is Important finding #1 for the GUI final review. Measured on a 16-CPU box:

| files | invocation | result |
|---|---|---|
| 53 (before T5/T6) | default | 7.9s clean |
| 54 (either new file) | default | **hangs** |
| 55 (all) | default, bare **and** documented glob | **hangs** |
| 55 | `--test-concurrency=8` | **503 pass, 8.8s** |
| 55 | `--test-concurrency=1` | 504 pass, 59.9s |

Mechanism: every test file spawns a real `server.js` child on a fixed port with a 20s readiness
timeout (README:346-350). `node --test` defaults concurrency to CPU count, so 55 files fan across
16 workers each booting a real server; past ~54 files they cannot all come up inside the window,
one loses, and the runner waits forever instead of failing. The runner blames whichever file is
still outstanding — always `api.rerollTrait.test.js`, which is why it looked guilty despite passing
in 1.4s alone. **Do not close this by telling developers to run serially:** 59.9s vs 8.8s is paid every run.
Fix belongs in `README.md`'s documented command and `.github/workflows/test.yml`.

Other operational rules learned the hard way:
- **Never truncate a test run.** Killing one orphans child servers that hold fixed ports and stall the next run.
- **Never run the suite while an implementer subagent is active** — fixed ports, you will collide and each can fail the other.
- **Tell implementers to run tests in the FOREGROUND as one blocking call.** Three separate agents stalled this session by backgrounding a run and ending their turn waiting for a notification that never arrives.
- Test ports 5000 and 5193–5232 are all allocated, one per file. 5232 is the last.

ART suite: `python -m unittest discover -s test -q`. There is **no pytest** in this environment,
despite what the design doc says.

---

## 4. The one thing that needs a human decision

**The multi-hex token framing does not work, and no amount of prompt wording fixed it.**

Task 4 put the first real images through ComfyUI. The 1-hex patrol boat rendered cleanly. The
5-hex carrier came back — twice — as a forced-perspective "looking down the flight deck" view
rather than a flat orthographic top-down, with the trailing edge cropped flush against the canvas bottom.

A prompt-tuning attempt (rewriting `PLAN_FRAMING["huge"]` and the token template's framing sentence)
narrowed the crop and symmetrized the margins but **never produced an orthographic view**, and it
cost real budget: token prompt max went to 513 against a 512 limit, with 2 of 800 ships truncating
outright. Truncation cuts the prompt *tail*, which is where the framing language lives — self-defeating
for exactly the ships at risk. **I reverted the tuning** (ruling R10) and kept the evidence.

Everything is written up in `docs/spaceship-render-notes.md` (479 lines, in the ART worktree): both
seeds, both prompts verbatim, both attempts' images described first-hand, explicit answers to each
acceptance question, and the measured budget so the next attempt knows what it can afford
(~52 tokens of headroom at p99).

**The recommendation on record is that the next attempt work at the workflow or CFG level, not with
more words. That was deliberately not attempted — it is outside both plans' scope and is your call.**
Only the `carrier` type at the `huge` band was tested, so whether the perspective bias is type-specific
is unknown.

Everything else about ships works end to end: rolling, prompts, the 1-hex render, the manifest
contract, and the GUI's browse/create/import.

---

## 5. What remains — in order

### Step 1 — Review GUI Task 6 (committed at `de28916`, unreviewed)

Build the package and dispatch a task reviewer:
```bash
bash "C:/Users/Evan/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/review-package" \
  "G:/GIT-REPOS/lancer-art-generator/.claude/worktrees/ultracode-spaceships/docs/superpowers/plans/2026-09-07-gui-spaceship-support.md" \
  f8d4b36 de28916
```
Brief: `.superpowers/sdd/2026-09-07-gui-spaceship-support/task-6-brief.md`.
Report: `task-6-report.md`. Diff: 1,099 insertions across 4 files; no protected file touched; port 5232 correct.

**Three things the implementer self-declared that need a reviewer's verdict, none pre-approved:**
1. The Type→Size gating matches bullets to type slugs and size bands with a **substring heuristic**, because the generator hands the client no structured tag. Verified only against the test fixture, **not** against the real tables. This is checkable — run `python generate-spaceship.py --ship-catalogue` in the ART worktree and test the gating against real data.
2. It added `kind` to **three Tables-preset call sites beyond the eight** the plan named, judging their omission a correctness gap.
3. Its full-suite verdict came from a serialized run; see §3.

Also confirm finding **G4**: `--ship-catalogue` returns `sizes` as an **array of objects** keyed by
`sizeBand`, not the `{band:{...}}` map the design doc predicts. Getting this wrong empties the size dropdown.

### Step 2 — GUI Task 7, with ruling R16 folded in

Brief: `task-7-brief.md`. The plan marks it "Optional"; **it is not optional** (ruling N2) — it
carries the doc accuracy work, and R16 now makes it load-bearing.

Its original scope: `?kind=` on `/api/trait-candidates`, `/api/trait-image` and
`POST /api/trait-candidates/import`; `insertBulletIntoTables` targeting `kind.tables`;
`lib/tableGroups.js` ship group list; `docs/known-issues.md`; `README.md`.

**Plus, added by ruling R16 — a real user-visible gap:**

Task 5 built the client vocab seam but it is **inert at the three live call sites**
(`public/app.js:1055`, `:272`, `:3247`), which still resolve the **NPC** vocabulary for every item.
The task review claimed ships therefore show *no* reroll buttons; **I checked and that is wrong.**
The two vocabularies intersect on `Glow colour` and `Glow placement`, so today a ship's detail sheet
shows reroll buttons on **2 of its 16 rerollable traits**, evaluated against the NPC cascade — meaning
the confirm dialog can name the wrong freed traits. The other 14 show nothing.

The wiring is genuinely blocked by two protected test files (independently verified):
- `test/ui.rerollConfirm.test.js:394` does an **exact-substring match** on the served source
  (`rerollNeedsConfirm(trait) && !(await confirmReroll(trait))`), so any second argument breaks it.
- `test/ui.detailRepaint.test.js:123-134` lifts `renderDetailTraits` via `new Function()` with a fixed
  helper list that never includes `vocabFor`, so even a *default parameter* of `vocab = vocabFor(item.kind)`
  throws `ReferenceError` in that lift.
- A third site, `confirmReroll(trait)`, has no `item` or kind in scope at all — its signature must be threaded.

**Ruling R16 permits minimal contract updates to both of those test files**, in the same commit as the
source change: the one literal substring, and the one helper list. Every other assertion in both files
must be preserved, and a new test must prove a ship's reroll buttons come from the **ship** vocabulary.
Rationale: the "these files must not change" constraint exists to prevent accidental drift, not to make
a specified feature unbuildable — and the plan already grants exactly this treatment to
`test/ui.batchBanner.test.js`, calling it "a genuine contract change".

**Also in Task 7 — stale docs to correct:**
- `docs/superpowers/plans/2026-09-07-gui-spaceship-support.md:225,353` and
  `docs/superpowers/specs/2026-09-06-gui-spaceships-design.md:84,148` still say `foundryNpcActorType`
  defaults to `'npc'`. Ruling R14 changed it to `''`. (These live in the **ART** worktree.)
- `REMAINING-WORK.md`'s Task 4 section (ART worktree) still reads "No ship image has ever actually been
  generated" under a DONE header — now false. This is parked ruling R13; one line closes it.
- The README test command (§3).

### Step 3 — GUI whole-branch final review

Base at `294c2ed` (the commit the plan's Task 1 branched from), **not** `git merge-base main HEAD` —
the branch predates this plan and the earlier range is its premise, not its output. Dispatch on the
most capable model. Feed it §3's concurrency finding and the deferred-minor list in the ledger.

### Step 4 — `superpowers:finishing-a-development-branch` on both branches.

---

## 6. Decisions taken on your behalf

Full reasoning and the cost-if-wrong for each is in the ledgers. The ones that changed the work:

**ART**
- **R1** — moved a test helper one task earlier; the plan's own ordering made Task 1b unrunnable (`ImportError`, not the predicted `AttributeError`).
- **R2 (amended)** — the plan's "999 passing, 1 skipped" baseline never described this worktree (real: 1014/0). Acceptance became "0 failures, 0 skips, count only rises".
- **R4** — the skip guard Task 3 was sent to delete is at `test_ship_policy.py:901`, not `:551-556`; the plan's line numbers had drifted and its premise about the skip count was false.
- **R5** — accepted a **fifth** capitalization join site; the plan's finding F5 asserts four and calls them "measured". Fixing four left 94 offenders across 60 seeds.
- **R7** — fixed a vacuous-assertion gap the plan's own code mandated; the brief violated a rule it states two paragraphs earlier.
- **R10** — reverted Task 4's prompt tuning (§4). A change that fails its purpose while consuming the budget is worse than no change.
- **R11** — scoped the final review to the plan's own range, excluding settled prior art the plan forbade touching.
- **R13** — parked the `REMAINING-WORK.md` stale sentence (no second fix wave). Fix in Task 7.

**GUI**
- **N1** — Task 5 declares `shipCreateState` itself; the plan had Task 5 reference a variable only Task 6 produces, which would throw on every page load in between.
- **N2** — Task 7 is executed, not skipped.
- **N3 — WITHDRAWN.** I claimed the plan's test baseline was unreproducible; that measurement was contaminated by my own concurrent run. The plan was right.
- **N4** — never run the port-binding suite while an implementer is active.
- **R9** — accepted a guard added to a route outside the plan's file list; the plan's own test list required it.
- **R12** — a cache keyed on mtime alone can stand; the sibling pattern it was compared against is itself only a partial mitigation.
- **R14** — `foundryNpcActorType` defaults to `''` so NPC Foundry payloads are unchanged. A shipped module consumes that endpoint and is not vendored here, so nobody can verify it tolerates an unexpected field.
- **R15** — the imported-index path is configurable so tests stop overwriting real repo-root state. **This hazard fired in practice**: `.imported.json` was rewritten to `{}` at 05:20 during pre-fix test runs.
- **R16** — Task 7 owns the detail-sheet vocab wiring and may minimally update two protected tests (§5).

---

## 7. Known-good verification commands

```bash
# ART — 1072 pass, 0 fail, 0 skip
cd G:/GIT-REPOS/lancer-art-generator/.claude/worktrees/ultracode-spaceships
python -m unittest discover -s test -q

# ART — zero-churn guarantee, must print NOTHING
git diff --stat c7e1bae HEAD -- generate-npc.py generate-art.py generate-3d.py ship_policy.py

# ART — the cross-repo gate the whole GUI plan rests on; must print: 18 16 16 9
node -e "
const ot=require('G:/GIT-REPOS/lancer-npc-import-gui/.claude/worktrees/ultracode-features/lib/overrideTables.js');
const s=require('fs').readFileSync('generate-spaceship.py','utf8');
console.log(ot.parseRequiredTables(s).length, ot.rerollableTraitsFrom(s).length,
            ot.rawRerollableTraitsFrom(s).length, Object.keys(ot.traitDependentsFrom(s)).length);"

# GUI — 503 pass, 0 fail, ~8.8s
cd G:/GIT-REPOS/lancer-npc-import-gui/.claude/worktrees/ultracode-features
node --test --test-concurrency=8 "test/*.test.js"
```

---

## 8. Deferred minors

Both ledgers carry `minor (deferred)` lines for the GUI final review to triage. The ones worth
knowing about now:
- `server.js` is 3,218 lines, up from ~2,500. No split was called for; a future task should consider
  extracting the tables/presets/create route families.
- `lib/kinds.js`'s `available()` — the one function touching the filesystem — has no test.
- The `Backdrop`/`Faction` `"||"` exclusion in the ART suite is a blanket skip where a positive
  assertion (`count("||") == 2`, measured true across 200 seeds) is free and strictly stronger.
