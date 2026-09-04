# Showing a bullet's real roll chance on the Tables page

> **Status:** design 2026-09-04. Companion spec:
> `lancer-art-generator`'s `2026-09-04-trait-roll-odds-design.md` covers the
> generator half and **ships first** — it defines the `--trait-odds` JSON this
> page reads, and there is nothing to display until it exists.

## 1. Problem

The Tables page shows a weight input beside every bullet and nothing else. A
weight is a comparison — `x4` is four plain bullets — and the question someone
tuning these tables has is not a comparison but a rate: *how often does this
actually turn up?*

Dividing by the table's total does not answer it, for two reasons set out in
full in the companion spec: disabled bullets have to be excluded first, and
most tables are filtered before they are drawn from. A Stance bullet flagged
`|| gun` cannot be rolled at all unless the Weapon came up a firearm; a Hair
bullet tagged `@neosamurai` is *more* likely than its weight suggests when that
theme comes up and unreachable when it does not. The bullets whose weight is
most misleading are exactly the flagged ones — the ones worth tuning.

### Goals

- A percentage on every bullet row, correct under the generator's own filters.
- Reactive: editing a weight, enabling or disabling a bullet, or importing a
  new candidate all update it without a manual refresh.
- Never blocks the page. The percentages are advisory; the editor keeps working
  when they cannot be produced.

### Non-goals

- Computing the odds here. `lib/` deliberately does not reimplement generator
  logic (see §7 of the tables-page spec, which replaced a drifted
  `OVERRIDE_TABLES` with a list parsed from the generator's own source). The
  odds arrive as JSON from `--trait-odds` and this page formats them.
- Decimal precision. §4.2.
- Odds anywhere but the Tables page.

## 2. `GET /api/table-odds`

Spawns `pythonExecutable generate-npc.py --trait-odds N` with `cwd` set to the
script's directory, the same shape `startRegenJob()` and `startCreateJob()`
already use, and parses its stdout as JSON.

```json
{ "ok": true, "samples": 20000, "tables": { "Weapon": { "…": 0.0413 } } }
```

Unlike those two, this is not a job with a poll endpoint. It is a plain request
that resolves when the child exits, because the caller is a render and not a
progress bar.

**Failure is `ok: false`, never a 5xx.** A missing `python`, a missing
`generate-npc.py`, a non-zero exit or unparseable stdout all return
`{ ok: false, reason }` with a 200. The precedent is `startRegenJob()`'s
`generate-npc.py not found at …`, and the reason matters more here: someone
running the GUI purely to review staged imports has no need of a Python
interpreter, and must not be shown a broken Tables page because of it. The
front end drops back to its local estimate (§4.1) and says so quietly.

### 2.1 Caching

A full run is ~6 s (20,000 rolls at 0.29 ms — see the companion spec §3.2), so
the result is cached in memory against a key derived from the tables file's
`mtimeMs` and `size`.

That key is exactly right for the reactivity this feature needs, and it is
worth being explicit about why: *every* input to the odds lives in
`npc-generator-tables.md`. A weight edit, a toggle, a preset apply and a trait
import all reach the odds by rewriting that file, and all of them go through
this server, which already writes it via `tableBullets`. So one `stat()`
invalidates the cache for all four, and no code path needs to remember to
invalidate anything by hand.

Concurrent requests for the same key share one spawn — a promise held in the
cache slot, not a completed value — so the burst of requests a page load and a
weight edit can produce together does not start two 6 s Python processes.

Only the newest key is kept. There is no value in remembering the odds for a
version of the file that no longer exists.

### 2.2 `lib/traitOdds.js`

The pure parts live in `lib/`, testable without a spawn, matching every other
module there:

- `cacheKeyFor(stat)` — the mtime/size key.
- `parseOddsOutput(stdout)` — JSON to a validated `{ samples, tables }`, or a
  thrown error with a message naming what was wrong.
- `oddsArgs(scriptPath, samples)` — the argv, so a test can assert on the
  command line without running it.

The spawn, the cache and the route stay in `server.js` with the other two
spawners.

## 3. `samples` is configurable

`config.json` gains `traitOddsSamples`, default `20000`, surfaced in
`config.example.json` with a comment on the trade: fewer samples settle sooner
and wobble more, more samples settle later and hold still. Someone on a slow
machine editing a lot of weights may reasonably want 8,000; someone who wants
to trust the last digit may want 100,000 and to wait.

It is a config value rather than a query parameter because it is a property of
the machine, not of the request.

## 4. The percentage cell

`renderTableBullets()` currently builds `[checkbox] [weight] [text]`. A cell
goes in after the weight input, before the text — beside the number it
explains, and in a fixed-width column so the rows stay aligned. `.chance-cell`
mirrors `.weight-input`'s metrics for that reason.

### 4.1 Two stages

The odds take ~6 s to settle, and a weight edit is already debounced 400 ms
before it is even written. Waiting six seconds for any feedback would make the
weight input feel broken, so the cell has two states:

**Estimate**, instant and computed in the browser: `weight ÷ Σ enabled weights`
in this table, rendered dim with a leading tilde — `~12%`. It needs no server
and no new state; `tablesState.tables[].bullets[]` already holds every weight
and `enabled` flag on the client. It repaints synchronously on every toggle and
every keystroke in a weight input.

**Settled**, from `/api/table-odds`: `12%`, normal weight, no tilde.

The tilde is doing real work and is not decoration. On a filtered table the two
numbers legitimately differ — that is the entire point of the feature — so the
cell will visibly change when the sampled value lands. Marking the first as an
estimate makes `~12% → 9%` read as *"the estimate resolved"*. Without it the
same transition reads as *"the number moved on its own"*, and a number that
appears to move on its own is worse than no number.

A request is fired on the first Tables-tab load and after any successful toggle
or weight write, debounced 1 s beyond the existing 400 ms weight debounce so
that holding an arrow key produces one run and not thirty. While one is in
flight the settled values already on screen stay put, dimmed — stale-but-shown
beats a column of blanks.

### 4.2 Formatting

Whole percentages. At 20,000 samples the standard error near p = 0.1 is about
0.2 pp, which is stable at whole-number precision; one decimal place would need
roughly 100× the samples and about a minute to hold still. Showing a digit that
flickers between runs would actively mislead — it would look like the edit did
something.

- Disabled row: `—`. It cannot be rolled, and `0%` would imply it was in the
  running and lost.
- Present in the output but below 0.5%: `<1%`, not `0%`. The difference between
  rare and impossible is the thing a reader is looking for.
- Absent from the output: blank, with a title attribute saying the generator
  does not roll this heading. This should not happen for any heading in the
  live file and is a diagnostic, not a feature.

### 4.3 The notes

A caption under the bullet list, always present:

> Chance that a rolled NPC gets this option, sampled from the generator over
> 20,000 rolls. Filters are included, so a flagged option can read lower than
> its weight suggests.

And on the `Weather` table only, a second line:

> Weather is always rolled, but only reaches the prompt when the Backdrop is
> flagged `weather` — most NPCs show none.

And on any per-pronoun variant heading — one matching `(subject)` — a third:

> This is a per-pronoun variant table, so its rows total less than 100% — only
> some NPCs roll from it.

Because they genuinely do. A `Build (she)` bullet only ever lands on a woman,
so the heading sums to the share of NPCs who are women (about 50%) rather than
to 100%. The generator reports it that way on purpose: the number is the chance
a *rolled NPC* gets this option, not the chance it wins a roll it was eligible
for, and the first is what someone tuning a table wants. What sums to 100% is
the whole family — the base heading plus its variants — which is not something
the page can usefully show on one table's panel, hence the note.

All three are keyed on the heading name. Two hardcoded strings and one regex,
which is the right size of mechanism for facts about specific headings; a
general "which tables are conditionally rendered" facility would be inventing a
category to hold one member.

### 4.4 A weight typed but not yet written

The weight input's write is debounced 400 ms, and `bullet.weight` is only
updated once that write succeeds — it is what the *file* says. The estimate
must follow the typing rather than the file, or it lags by the debounce and
then jumps.

So a typed value is held separately as `bullet.pendingWeight`, read by the
share calculation in preference to `bullet.weight` and cleared when the write
settles either way. While any bullet in a table has one, every settled figure
in that table is shown as an estimate — not just that row's, since one weight
moves the whole denominator.

## 5. Tests

`node --test`, no new dependencies, and — as with every existing test —
**nothing may depend on a real Python interpreter**: CI runs ubuntu-latest,
which has no reliable bare `python`. The `generatorSource` option in
`test/helpers/testServer.js` writes a stub script and repoints
`pythonExecutable` at `process.execPath`, which is how `api.createArgs.test.js`
already asserts on a generator command line. A stub that prints fixed odds JSON
gives the endpoint a real subprocess to parse without needing Python.

| Test | Asserts |
|---|---|
| `traitOdds.test.js` | `cacheKeyFor`, `parseOddsOutput` on good and malformed input, `oddsArgs` |
| `api.traitOdds.test.js` | route returns the stub's odds under `ok: true` |
| " | second request with the file untouched does not re-spawn |
| " | touching the tables file does re-spawn |
| " | two concurrent requests share one spawn |
| " | stub exiting non-zero → `ok: false` with a reason, status 200 |
| " | stub printing garbage → `ok: false`, status 200 |
| " | missing script → `ok: false` naming the path, status 200 |
| " | `traitOddsSamples` from config reaches the argv |

### Not covered by tests

The percentage arithmetic and the two-stage cell are front-end code in
`public/app.js`, which this suite has never covered — it tests `lib/` and the
HTTP surface. Checked by hand instead: that the estimate appears instantly on a
weight keystroke, that the settled value replaces it, that a disabled row reads
`—`, and that the numbers down a themed table visibly differ from their weight
shares.

## 6. Out of scope

- Odds on the Create tab's trait-override dropdowns.
- Sorting or filtering a table by probability.
- Any "target this percentage, solve for the weight" tool. That is a different
  feature and would need the analytic model the companion spec's §2 argues
  against building.
