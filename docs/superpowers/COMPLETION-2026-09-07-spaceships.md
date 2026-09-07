# Completion — spaceship support across two repos (2026-09-07)

Supersedes `HANDOFF-2026-09-07-spaceships.md`. Both implementation plans are **complete**: 12 of 12
tasks implemented, individually reviewed, fixed to clean, and closed by a whole-branch final review.

Everything here was measured. Where a claim was contested during execution, the correction is given
rather than the original.

---

## 1. Final state

| | path | branch | state |
|---|---|---|---|
| **ART** (generator) | `G:/GIT-REPOS/lancer-art-generator/.claude/worktrees/ultracode-spaceships` | `ultracode-spaceships` | complete — 14 commits, tree clean, **1072 tests OK** |
| **GUI** (import GUI) | `G:/GIT-REPOS/lancer-npc-import-gui/.claude/worktrees/ultracode-features` | `ultracode-features` | complete — 13 commits (`294c2ed..c286e61`), tree clean, **528 tests passing** |

Nothing was pushed. Neither branch was merged by this work.

### Verification commands

```bash
# ART — 1072 tests, OK
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

# GUI — 528 passing, ~11s
cd G:/GIT-REPOS/lancer-npc-import-gui/.claude/worktrees/ultracode-features
node --test --test-concurrency=8 --test-timeout=120000 "test/*.test.js"
```

**Never use bare `node --test`** on the GUI repo — it hangs. See §4.

---

## 2. `main` is currently broken, and this branch did not do it

`main`'s HEAD is `a326c85 "Merge branch 'worktree-table-flag-editor'"`, whose parents are
`409f65d` (a mid-flight commit of this branch) and `c400fd5` (a separate feature branch). That merge
committed **unresolved conflict markers** into `public/app.js:4107-4111`, inside `loadTables()`.
Conflict markers are a hard `SyntaxError`, so `public/app.js` does not parse at all on `main`: no
handlers bind and no grid renders. `node --check public/app.js` fails there; `server.js` is fine.

**The correct resolution is the union of the two sides, not either one:**

```js
const { groups, flags } = await api(`/api/table-bullets?kind=${encodeURIComponent(tablesState.kind)}`);
```

Verified against `main`'s own merged `server.js`: the `/api/table-bullets` route calls
`resolveKind(url, null)` **and** builds a `flags` payload, so it serves both. The line directly below
the conflict already reads `tablesState.flags = flags || {}`, so taking this branch's side alone would
still throw a `ReferenceError` once the markers were removed.

**Whoever merges this branch should expect that same `loadTables()` region to conflict again**, and
should resolve it the same way.

---

## 3. What was built

**ART.** `_ship_roll.py` + `_ship_cli.py` merged into `generate-spaceship.py` (~2,900 lines) with
byte-identical behaviour and a new `--out-root`; a pre-existing bug fixed where `--out` carried
`--out-root` as an argparse *alias*; the guarded bootstrap adopted so `ship.art is ship.npc.art`
(previously two module objects under one name, making `isinstance` silently answer `False`);
sentence-join capitalization at **five** sites (the plan asserted four); six new test files, which
caught two real generator defects — `weather_sentence()` returned pre-substitution text, so a `{...}`
placeholder could ship literally into a prompt, and `token_size()`'s clamp distorted aspect ratio.

**GUI.** A kind registry and derived paths; the data plane (browse/import/delete); the generator plane
(create/re-roll/re-render); Foundry import at the ship's real grid size; a per-kind client trait
vocabulary, wired live; a Create Spaceship tab and a Tables kind switch; kind-aware trait staging.

The plan's central architectural claim was **proven, not asserted**: the import, delete, seen and
unseen route handlers are untouched by the whole branch, and after the final task there is not a
single `item.kind === 'spaceship'` in `server.js` — every kind-sensitive decision reads a registry
field or a capability flag.

---

## 4. The test suite hangs under its own default command — diagnosed and fixed

`node --test` with no flags **hangs** on this repo. Mechanism: every test file spawns a real
`server.js` child bound to a fixed port with a 20s readiness window, and `node --test` defaults
concurrency to the CPU count. Measured on a 16-CPU box: 53 files clean at default in 7.9s; 54 hangs;
55 hangs; 55 at `--test-concurrency=8` → 8.8s; at `--test-concurrency=1` → 59.9s.

Three things ship as the fix, and the third is the important one:

1. `--test-concurrency=8` in the README's documented command **only** — deliberately *not* in CI.
   GitHub's `ubuntu-latest` is 4 vCPU, so CI's default was already 4; pinning 8 would have *doubled*
   CI concurrency on a machine a quarter the size of the one the number was measured on.
2. `timeout-minutes: 10` on the CI job, which previously would have burned the 360-minute default.
3. **`--test-timeout=120000` in both**, which converts any stuck file — this cause or the next one —
   into a named failure instead of an unbounded wait. A CI job that hangs instead of failing is worse
   than one that fails.

A separate unbounded hang was found and fixed in `test/helpers/testServer.js`, which all 55 files use:
`stop()` awaited `child.once('exit')` unconditionally, so if the child had already exited the promise
never settled inside a `t.after` hook.

**Known caveat.** Two attempts to reproduce the green suite from a controller session stalled at
`--test-concurrency=8`, with the one environmental difference being a developer dev server running
alongside. The number is machine-specific; README now says to use roughly half your CPU count and to
lower it if you also run the app. With `--test-timeout` in place, a bad number now fails loudly
instead of silently.

---

## 5. The multi-hex token framing does not work — the one thing needing a human

The 1-hex patrol boat renders cleanly. The 5-hex carrier came back twice as a forced-perspective
"looking down the flight deck" view rather than a flat orthographic top-down, trailing edge cropped
flush to the canvas bottom. A prompt-tuning attempt narrowed the crop and symmetrized margins but
never produced an orthographic view, and it pushed the token prompt to 513 characters against a 512
limit (2 of 800 ships truncating — and truncation cuts the *tail*, which is where the framing language
lives, so it is self-defeating for exactly the ships at risk). It was reverted.

The full record — both seeds, both prompts verbatim, both attempts' images described first-hand, and
the measured budget (~52 tokens of headroom at p99) — is in `docs/spaceship-render-notes.md` in the
ART worktree.

**The recommendation on record is to work at the workflow or CFG level, not with more prompt words.**
That was deliberately not attempted; it is outside both plans' scope. Only the `carrier` type at the
`huge` band was tested, so whether the perspective bias is type-specific is unknown.

---

## 6. Not done, and deliberately so

- **The plan's eight manual end-to-end acceptance steps were never run.** Step 4 in particular —
  re-roll `Weapon`, then set `Size`, and confirm the second edit *keeps* the first — has no automated
  coverage on this branch. Run steps 2, 4, 6, 7 and 8 by hand before trusting the branch in anger.
- **`foundrySpaceshipActorType: 'deployable'` is an unverified guess.** The Foundry module that
  consumes it is not vendored here, so nothing in this repo can confirm it is accepted. A wrong guess
  costs one config line, not a code change (the field is omitted entirely when the config is empty).

---

## 7. Follow-ups, triaged by the final review

**As one change, with its own protected-file exception grant:** the kind-aware UI copy pass. Six live
sites plus `traitScopeNote` still speak in NPC voice on ship surfaces — "re-render this NPC" on all 16
ship traits, "Show NPC" on a ship regen banner, "Rolled on about X% of NPCs" on the Tables tab, and a
400 reading "`--name` only makes sense with a single NPC". The notes are *factually correct* for ships;
only the voice is wrong. `lib/kinds.js` already carries a `subject` field ('NPC' / 'spaceship') to
thread through. Two of the sites live in protected files' assertions, which is why this needs its own
task rather than a squeezed-in patch.

**Three one-line test gaps, all in non-protected files:** `tokenHexes === null` for the NPC fixture;
the `#tables-kind` change handler's state-clearing (it correctly clears `pendingPreset`, so this is a
missing regression guard rather than a live bug); and a group-name assertion for the NPC kind.

**Later, deliberately:** split `server.js`, now 3,312 lines. The final review was explicit that this
should **not** precede the merge — a 3,300-line reshuffle immediately after fourteen reviewed commits
is the change most likely to introduce the regression the whole branch avoided. The natural seams are
the tables/presets family, the trait-candidate family, and the four spawn wrappers that share one
spawn-collect-parse shape.

**One-clause copy edit, parked:** README's new concurrency section says "adding tests to an existing
file eats the same headroom that adding a file does". Under a fixed concurrency cap that is not true —
peak concurrent servers is bounded by `min(concurrency, files)`, and each file holds one server at a
time — and it contradicts the sentence right after it. Strictly less wrong than the affirmatively
backwards claim it replaced; the surrounding advice is correct.

**Accepted, not a defect:** on an install whose ship script has moved away but whose manifest still
holds ships, the Spaceships category still renders and ship controls still fail server-side. That is
the price of not hiding content a user already has.

---

## 8. Decisions taken on the user's behalf

Every ruling, both plans, with what it costs if wrong. Full reasoning is in each plan's ledger.

### ART

- **R1** — moved a test helper one task earlier; the plan's own ordering made Task 1b unrunnable
  (`ImportError`, not the predicted `AttributeError`). *Cost: a helper lands one task early.*
- **R2 (amended)** — the plan's "999 passing, 1 skipped" baseline never described this worktree (real:
  1014/0). Acceptance became "0 failures, 0 skips, count only rises". *Cost: a real pre-existing
  failure could hide behind a baseline nobody pinned.*
- **R3** — scratch paths in Task 1 Step 5. *Cost: test scratch lands in a different temp dir.*
- **R4** — the skip guard Task 3 was sent to delete is at `test_ship_policy.py:901`, not `:551-556`;
  the plan's line numbers had drifted and its premise about the skip count was false. *Cost: the wrong
  guard is deleted and a skip survives.*
- **R5** — accepted a **fifth** capitalization join site; the plan's finding F5 asserts four and calls
  them "measured". Fixing four left 94 offenders across 60 seeds. *Cost: none measurable; the fifth is
  demonstrably real.*
- **R6** — a review item resolved in the implementer's favour. *Cost: one accepted deviation.*
- **R7** — fixed a vacuous-assertion gap the plan's own code mandated; the brief violated a rule it
  states two paragraphs earlier. *Cost: a test asserts more than the plan wrote.*
- **R8** — the reviewer's warning item adjudicated. *Cost: one warning deferred.*
- **R10** — reverted Task 4's prompt tuning (§5). A change that fails its purpose while consuming the
  budget is worse than no change. *Cost: the framing problem stays open, documented.*
- **R11** — scoped the ART final review to the plan's own range, excluding settled prior art the plan
  forbade touching. *Cost: a defect in the excluded range goes unreviewed here.*
- **R13** — parked `REMAINING-WORK.md`'s stale sentence. **Now closed** (`37de710`): the "No ship image
  has ever actually been generated" premise under a DONE header is replaced by the measured record.
  *Cost: none; closed.*

### GUI

- **N1** — Task 5 declares `shipCreateState` itself; the plan had Task 5 reference a variable only Task
  6 produces, which would throw on every page load in between. *Cost: a few lines of churn.*
- **N2** — Task 7 is executed, not skipped, despite the plan marking it "Optional". *Cost: doc churn
  and two routes gaining a `?kind=` not yet exercised.*
- **N3 — WITHDRAWN.** The claim that the plan's test baseline was unreproducible came from a
  measurement contaminated by a concurrent run. The plan was right.
- **N4** — never run the port-binding suite while an implementer is active. *Cost: one sequencing
  constraint; removes a class of phantom failure.*
- **R9** — accepted a `model3d` capability guard added to a route outside the plan's file list; the
  plan's own test list required it. *Cost: one route changes outside its declared scope.*
- **R12** — a cache keyed on mtime alone can stand; the sibling pattern it was compared against is
  itself only a partial mitigation. *Cost: a same-tick edit evades invalidation, dev-time only,
  self-healing.*
- **R14** — `foundryNpcActorType` defaults to `''` so NPC Foundry payloads are unchanged. A shipped
  module consumes that endpoint and is not vendored here, so nobody can verify it tolerates an
  unexpected field. *Cost: anyone wanting NPC jobs to carry `actorType` sets one config line.*
- **R15** — the imported-index path is configurable so tests stop overwriting real repo-root state.
  **This hazard fired in practice**: `.imported.json` was rewritten to `{}` during pre-fix test runs.
  *Cost: one more config key.*
- **R16** — Task 7 owns the detail-sheet vocab wiring and may minimally update two protected tests.
  Without it the seam was inert: a ship's sheet showed reroll buttons on 2 of 16 traits, evaluated
  against the NPC cascade. *Cost: two guard tests loosened, minimally and reviewed.*
- **R17** — the new ship-vocab test goes in the existing `ui.kindVocab.test.js`, not a 56th file:
  ports were exhausted at 5232 and file count is the measured cause of the suite hang. *Cost: one test
  file grows; no coverage lost.*
- **R18** — the stale-doc fix is split across both repos, because each worktree carries a copy of the
  plan and only the GUI repo holds the spec. *Cost: two commits instead of one.*
- **R19** — Task 7 absorbed the suite-concurrency fix rather than deferring it to the final review.
  *Cost: the final review inherited a fix it might have specified differently — and in fact did
  refine, see §4.*
- **R20** — **corrects R18.** The plan's `foundryNpcActorType: 'npc'` at `:225` stays `'npc'`: that
  block transcribes the `test/kinds.test.js` fixture (which really does set `'npc'`), while the
  *shipped* default is `''`. The original instruction would have made the plan contradict the test it
  quotes. Caught by an implementer refusing the instruction. *Cost: a comment on one doc line.*
- **R21** — the missing "no generator, no tab" guard is fixed by **wiring `available()`**, not by
  softening the README. Correcting the docs instead would have documented a regression as intended
  behaviour: every existing user without the ship generator got a visible tab that 500s. *Cost: a late
  additive change carrying one scoped re-review rather than a full task review.*
- **R22** — the one-clause README overreach is **parked**, not fixed: the process allows one fix wave
  after the final review and it was spent, and this is documentation, not a code defect. *Cost: one
  misleading sentence whose surrounding advice is sound; a reader who believes it over-caps
  concurrency, which errs safe.*
