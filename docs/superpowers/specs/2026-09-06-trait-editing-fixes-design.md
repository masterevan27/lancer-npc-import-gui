# Trait editing: bug fixes and staged edits — implementation design

**REPO A** = `G:/GIT-REPOS/lancer-npc-import-gui/.claude/worktrees/ultracode-features` (all `server.js`, `public/`, `lib/`, `test/` paths below).
**REPO B** = `G:/GIT-REPOS/lancer-art-generator/.claude/worktrees/ultracode-spaceships` (all `generate-npc.py`, `generate-art.py`, `test/test_*.py` paths below).

All line numbers were re-verified against the working trees on 2026-09-06. Where the original investigation and the adversarial verification disagreed, the verification wins and the divergence is called out.

---

## 1. Settled root causes

### D1 — The two trait handlers start a regen job and never start the poller (primary)

**Where.** `public/app.js:2995-2996` (the `.reroll-btn` delegated handler, which begins at `public/app.js:2963`) and `public/app.js:3038-3039` (the `.set-trait-btn` handler, beginning at `public/app.js:3003`). Both tails read:

```js
    state.regenLastStatus = 'running';
    await refreshItems();
```

**Mechanism.** `POST /api/reroll-trait` (`server.js:1913-1916`) and `POST /api/set-trait` (`server.js:1982-1985`) call `startRegenJob` (`server.js:697`), which synchronously writes `{ status: 'running', … }` into `regenJobsByItemId` (`server.js:734-741`) *before* the route answers 202. There is no regen-status endpoint anywhere in `handleApi` — the status is only a field on each item in `/api/items` (`itemView`, `server.js:1592-1593`; route `server.js:1675-1683`). The only thing that re-reads that list on a timer is `startPolling()` (`public/app.js:1563`), and it has exactly three call sites: `public/app.js:1197` (3D), `:1244` (Regenerate button), `:1498` (import). Neither trait handler is among them, despite the comment at `public/app.js:2992-2994` asserting a hand-off to "the regen poller".

So the single `await refreshItems()` does two things and then nothing ever happens again:

1. `render()` (`public/app.js:519`) paints the `badge pending` "Regenerating…" pill (`public/app.js:703-707`).
2. `detectRegenFinished` (`public/app.js:1799`) records `regenSeen.set(id, 'running')` (`:1805`).

When the child exits and `child.on('close')` (`server.js:760-769`) flips the job to `done`/`error`, nothing observes it. `state.pollTimer` is null, so there is no timer to clear. The detail sheet is frozen too: `renderRegenPanel` is reachable only from `openDetail` (`public/app.js:1008`) and the poll tick (`:1575`), so the sibling trait buttons stay enabled (`:1062-1065` never re-runs), the `justFinished` art swap (`:1067`, `:1081-1084`) never happens, and the clicked button — disabled at `:2975` / `:3019` — is re-enabled only on the error paths.

**Symptom B (the banner appearing later, "after a create").** `detectRegenFinished`'s gate `if (previous !== 'running') continue;` (`public/app.js:1809`) is *already satisfied* — `regenSeen[id]` is `'running'` from step 2 — so the next `refreshItems()` from any source announces the finish. `regenSeen` is never pruned (`public/app.js:1782`, and the comment above it), so the announcement is late, not lost.

**Verification correction (must not be repeated in the fix).** The investigation claimed `markSeen()` → `refreshItems()` at `public/app.js:458`, i.e. that reopening a sheet recovers. **False.** `markSeen` is `public/app.js:423-430` and only fires `/api/seen`; `openDetail` calls it at `:1029`. Line 458 is inside `markBatchSeen` (`:450-460`), whose only caller is the batch-banner dismiss (`:1733`), and it is gated on `tabState.current === 'import'`. The complete `refreshItems()` caller list is `public/app.js:458, 488, 1195, 1243, 1497, 1529, 1556, 1571, 1698, 2996, 3039`. **Closing and reopening the detail sheet does not recover** — `openDetail(item)` renders from the `state.items` row handed to it (`:750`, `:1409`, `:1883`) and nothing refreshed it. Only a category switch (`selectCategory`, `:488`), a delete (`:1529`, `:1556`), a create/import run (`:1497`, `:1698`) or a page reload recovers.

### D2 — The detail sheet is never repainted, even when polling runs

**Where.** `el.detailTraits.innerHTML` is assigned in exactly one place in the whole file: `public/app.js:988`, inside `openDetail()` (preceded by `const rerollable = rerollableForItem(item);` at `:987`, closing `.join('')` at `:994`).

**Mechanism.** The poll tick (`public/app.js:1571-1578`) calls `refreshItems()`, `renderRegenPanel(openItem)` and `refreshModel3d(...)` — nothing else. `renderRegenPanel` (`public/app.js:1037-1086`) touches only `el.regenCurrentSeed`, the radios, `el.regenBtn`, `el.regenSeedInput`, the trait buttons' `.disabled` (`:1062-1065`), `el.regenStatus` (`:1067-1076`) and the two `<img>` `src`s under `justFinished` (`:1081-1084`).

Everything else the sheet shows is written once in `openDetail` and never again:

| Field | Line |
|---|---|
| `el.detailName` | `public/app.js:962` |
| `el.detailSub` (Role category / Role / Faction) | `:963` |
| `el.detailGenerated` | `:966` |
| `renderDetailFiles(item)` (folder + filenames) | `:967` (fn at `:944`) |
| `el.detailTraits.innerHTML` (the whole trait table, incl. which buttons exist) | `:987-994` |
| `el.detailPrompts.hidden`, `el.detailPortraitPrompt`, `el.detailTokenPrompt` | `:997-1000` |

The fresh traits *are* in the payload — `itemView` sends `traits: item.traits || {}` (`server.js:1564`) and `loadManifest()` re-reads the file on every call with no cache (`server.js:160-176`). They are simply never painted.

### D3 — `--set-trait` on a regen never persists `traits`/`rawTraits` (the real data loss)

**Where.** `generate-npc.py:4273`:

```python
    if rerolled is not None:
        entry["traits"] = {k: v for k, v in npc.items() if not k.startswith("_")}
        if npc.get("_raw") is not None:
            entry["rawTraits"] = dict(npc["_raw"])
```

`rerolled` is `None` at `generate-npc.py:4063` and assigned only at `:4080`, inside `if args.reroll_trait:` (`:4064`). The `--set-trait` branch (`:4099-4155`) calls `reroll_from_raw(..., dict(args.overrides))` at `:4142-4145` and never touches `rerolled`.

**Mechanism, corrected and sharpened by verification.** The entry is not merely stale, it is left **internally inconsistent**. `generate-npc.py:4247-4271` writes, *unconditionally or gated only on "not None"*, from the post-edit `npc`: `seed`, `files`, `portrait`, `portraitPrompt`, `token`, `tokenPrompt`, `young` (`:4253`), `outfit_notac`, `gear_helmet`, `hair_updo`, `headgear_helmet`, `headgear_crown`, `hair_covered`, `headgear_bare` (`:4255-4271`), and `when` (`:4281`). Only `traits`/`rawTraits` sit behind the `:4273` gate. `reroll_from_raw` replaces `npc` wholesale (`npc.clear(); npc.update(fresh)` at `:3541-3543`) and `npc_from_entry` copies (`migrate_traits` → `rename_legacy_traits`'s `out = dict(traits)` at `generate-npc.py:1012`), so there is no aliasing that would save it.

Consequences, in order of severity:

1. `npc_from_entry` (`generate-npc.py:3980-4043`) reloads the **new** derived flag registers under the **old** bullets, so the next roll's `filter_by_hardtech` / `filter_by_dress` / notac filters run against a register that contradicts the entry's own trait text. Silent corruption of what the next roll is *allowed* to draw.
2. The next edit — reroll or set — starts from the pre-set NPC, so the first pin is gone. This is defect (b) as the user reported it.
3. `entry["portraitPrompt"]` describes an NPC `entry["traits"]` contradicts. The GUI's Prompts pane and Traits table disagree permanently, across reloads.
4. The trait-choices cache is poisoned. `readTraitChoices` (`server.js:1393-1400`) keys through `traitChoices.cacheKeyFor` (`lib/traitChoices.js:81-86`), which fingerprints `item.rawTraits`. `rawTraits` never changes on a pin, so the key never changes: the picker, and `/api/set-trait`'s own verbatim re-check (`server.js:1958-1966`), keep serving the pre-pin answer with `current` pointing at the old value. **This makes D3 a hard prerequisite for the staging design in §3** — accumulation is invisible to the choices query until it is fixed.

**Verification correction.** The investigation's "reroll→reroll also loses edits" is **not** a Python bug. `--reroll-trait` persists correctly (`:4273-4280`), driven end-to-end by `test/test_reroll_trait.py:1022-1072`. Sequential rerolls do accumulate in the manifest; the user cannot see it because of D1+D2 (the sheet keeps showing pre-reroll traits, and the browser keeps the cached image because the `&v=<mtime>` bust at `server.js:1616`/`:1619` only takes effect when `renderRegenPanel` reassigns `src`). **On the `Set…` path, however, D3 alone is decisive** — with D1 and D2 both fixed, a pin still shows the old value forever, and survives a full reload.

### D4 — A regen that fails before the client sees `running` is never announced

`startRegenJob`'s `spawn` catch (`server.js:743-749`) records `status: 'error'` synchronously and still returns `{ ok: true }`, so the route answers 202 (`server.js:1916`, `:1985`). `child.on('error')` (`server.js:756-759`) can likewise fire before the client's first `refreshItems()` lands. `detectRegenFinished`'s gate (`public/app.js:1809`) then sees `previous === undefined` and skips the item: no banner, no sheet message, only a "Regen failed" card badge (`public/app.js:708-712`).

*Verification note:* the investigation called this "the commonest hard failure". Overstated — a missing script is caught earlier and returns `{ok:false}` → 409 (`server.js:703-705`), and a bad `pythonExecutable` on Windows surfaces via the async `child.on('error')`, making it a race rather than a certainty. The defect is real; its frequency is not established.

### D5 — The poller abandons a live job (independent; on the path the investigation exonerated)

`public/app.js:1590`: `if (!stillPending || ticks > (building3d ? 1800 : 600))` with one tick per 2000 ms (`:1565-1568`). 600 ticks = 20 minutes for a regen. A regen queues portrait + token + the RMBG pass, each with `generate-npc.py --timeout` defaulting to 1800 s (`generate-npc.py:3144`, used at `:4190`/`:4201`), i.e. up to ~90 minutes of legal runtime against a 20-minute client cap. The code comment at `public/app.js:1583-1585` states the mismatch without reconciling it. Nothing re-arms the poller. Result: stuck pill + late banner, reached from the **Regenerate button** (`public/app.js:1243-1244`), which the investigation called correct. Adding `startPolling()` at `:2996`/`:3039` inherits this.

### D6 — A transient empty item list kills the poller mid-job

`save_manifest` is a non-atomic truncate-and-write: `path.write_text(json.dumps(...))` at `generate-art.py:638-639`. `regenerate_one` rewrites the whole manifest at `generate-npc.py:4282-4283`, milliseconds before the child exits. `loadManifest()` returns `[]` on a JSON parse failure (`server.js:167-174`). A poll tick landing inside the rewrite window gets `state.items = []`, which makes `stillPending` false (`public/app.js:1580-1582`) and clears the interval (`:1591-1592`) with the job still running — plus a momentarily blank grid. The race window is time-aligned with exactly the transition being watched. This becomes materially more likely under §3, which writes the manifest on every trait click.

### D7 — `startPolling()` placed after `await refreshItems()` is skipped on a transient error

`refreshItems()` uses `api()` (`public/app.js:401-409`), which throws on any non-OK response. Both trait handlers wrap the tail in `try`/`catch` (`:2966-3000`, `:3020-3042`), as does the Regenerate button (`:1229-1249`). A 202 followed by a failing `/api/items` therefore lands in the catch, prints `Couldn't re-roll X: /api/items: HTTP 500` for a job that is genuinely running, re-enables the button (whose next click gets a 409 from `server.js:699`), and skips whatever follows the `await`.

### D8 — `renderRegenPanel` clobbers the trait-specific status line

`public/app.js:1068-1069` unconditionally writes the generic `'Regenerating… this can take a few minutes (ComfyUI must be running).'` in its `running` branch, discarding `Re-rolling <trait>…` (`:2989-2991`) / `Setting <trait>…` (`:3033-3035`) on the first poll tick, two seconds after the click. Fixing D1 without fixing this makes the trait-named message dead code.

### Ruled out — do not chase

- **Item id drift.** `manifestItemsFrom` takes `entry.id` straight off the manifest (`server.js:187-194`); `regenerate_one` reuses the entry dict (`generate-npc.py:4056`), rewrites `entry["seed"]` at `:4247` and re-keys by the same `folder_path` at `:4282`. The only `"id"` write in the file is the create path (`generate-npc.py:4484`). Ids are stable across a regen.
- **Markup/CSS.** `public/index.html:26-39` ships both banners inside `.banner-stack` with `hidden`; `public/style.css:71` has `.banner[hidden] { display: none; }`; `elRegenBanner` (`public/app.js:1756-1761`) resolves and `announceRegenComplete` (`:1831-1848`) cannot throw on a null element.
- **Server-side manifest caching or clobbering.** `loadManifest()` re-reads on every call. The only `writeFileSync(config.npcManifestPath, …)` sites are `copyIntoFoundry` (`server.js:272`) and `deleteItem` (`server.js:315`), neither on the regen path.

### Out of scope, recorded

- **Role reroll strands the folder.** `generate-npc.py:4159` computes `category = role_category(npc)` but uses it only for the ComfyUI output prefix; `:4160` reuses the stored folder and the writer never re-keys `manifest[folder_path]`. The GUI derives the displayed category from the folder's parent (`server.js:1570-1575`), so after re-rolling Role the sheet shows a category contradicting `traits.Role`. Real, independent, not fixed here. Record it in `docs/known-issues.md`.
- **Category-switch teardown.** `stillPending` is computed over `state.items`, i.e. the selected category only (`public/app.js:1580-1582`), so a regen left running while the user browses another category still takes the poller down. This is an acknowledged design limitation stated in `test/ui.regenBanner.test.js:120-126`; §3 makes it far less relevant because trait edits no longer wait on a render.

---

## 2. Phase 1 — the fixes

Phase 1 is independently shippable and valuable. It leaves the "edit renders immediately" behaviour intact. Phase 2 (§3) then re-points the two trait buttons at a new synchronous route; the `startPolling()` calls added in P1-A are deleted at that point along with the `fetch` they follow, but **every other Phase-1 edit is load-bearing for Phase 2** — the detail re-render extraction, the poller robustness fixes, the `regenSeen` seeding, and the Python writer fix.

### P1-A · `public/app.js` — start the poller, before the await

In **both** trait handlers, replace the tail. Reroll handler, currently `public/app.js:2989-2996`:

```js
    el.regenStatus.textContent =
      `Re-rolling ${trait} and re-rendering… this can take a few minutes `
      + '(ComfyUI must be running).';
    state.regenLastStatus = 'running';
    await refreshItems();
```

becomes:

```js
    state.regenRunningMessage =
      `Re-rolling ${trait} and re-rendering… this can take a few minutes `
      + '(ComfyUI must be running).';
    el.regenStatus.textContent = state.regenRunningMessage;
    state.regenLastStatus = 'running';
    // Before the await, not after: refreshItems() throws through api() on any
    // non-OK /api/items, and a poller that only starts on the happy path is
    // exactly the omission this handler already had once. See D7.
    noteRegenStarted(id);
    startPolling();
    await refreshItems();
```

Same shape at `public/app.js:3033-3039`, with `Setting ${trait} and re-rendering…`.

Apply the same reordering to the Regenerate button, `public/app.js:1242-1244`:

```js
    state.regenRunningMessage = null;   // the generic line is correct here
    el.regenStatus.textContent = 'Regenerating… this can take a few minutes (ComfyUI must be running).';
    noteRegenStarted(id);
    startPolling();
    await refreshItems();
```

and to the 3D handler at `public/app.js:1195-1197` (move `startPolling()` above `await refreshItems()`; leave the `refreshModel3d` calls where they are).

**New state.** In the `state` object (`public/app.js:11-27`) add:

```js
  // The trait-specific "Re-rolling Hair…" line, so renderRegenPanel's running
  // branch stops overwriting it with the generic one two seconds later (D8).
  // Cleared by openDetail and whenever the job leaves 'running'.
  regenRunningMessage: null,
```

**New function**, placed immediately after `detectRegenFinished` (`public/app.js:1814`):

```js
/**
 * Record that THIS page started a regen for `id`, so detectRegenFinished's
 * "was it running when we last looked" gate is satisfied from the click rather
 * than from a poll that may arrive after the job has already failed.
 * startRegenJob records status:'error' synchronously on a spawn failure and the
 * route still answers 202 (server.js:743-749), so the gate would otherwise drop
 * the commonest silent failure. See D4.
 */
function noteRegenStarted(id) {
  regenSeen.set(id, 'running');
}
```

The gate at `public/app.js:1809` is left exactly as it is — `test/ui.regenBanner.test.js:100-105` pins it, and seeding is what makes it mean "this page started or witnessed the job", which is what its own comment (`:1806-1808`) already claims.

### P1-B · `public/app.js` — repaint the whole detail sheet, not just the regen panel

Extract three functions from `openDetail`, then compose them.

**`renderDetailHeader(item)`** — move `public/app.js:962-967` verbatim (`detailName`, `detailSub`, `detailGenerated`, `renderDetailFiles(item)`).

**`renderDetailTraits(item)`** — move `public/app.js:987-994` verbatim:

```js
/**
 * The trait table for one item. Extracted from openDetail so a completed
 * re-roll repaints it in place - the values, and the button set, which is
 * computed from rerollableForItem() and changes when a legacy entry gains
 * rawTraits from its first re-roll. Nothing here reads the DOM, so it is safe
 * to call on every poll tick.
 */
function renderDetailTraits(item) {
  const rerollable = rerollableForItem(item);
  el.detailTraits.innerHTML = Object.entries(item.traits || {})
    .filter(([k]) => !TRAIT_KEY_EXCLUDE.includes(k))
    .map(([k, v]) => {
      const cells = traitControlCells(k, rerollable);
      return `<tr>${cells}<td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`;
    })
    .join('');
}
```

Note the one deliberate change: the inline `['name', 'Given names', 'Family names']` at `:990` becomes `TRAIT_KEY_EXCLUDE` (already defined at `public/app.js:9`). `test/ui.traitColumns.test.js:130-139` regexes the **row template literal**, which is preserved character-for-character, and asserts `<td class="reroll-cell">` appears once — both survive.

**`renderDetailPrompts(item)`** — move `public/app.js:997-1000`.

**`renderDetailFor(item)`** — the composition point, and the **only** correct call order:

```js
/**
 * Repaint everything in the open sheet that comes from the item row.
 *
 * Order is load-bearing. renderDetailTraits() replaces el.detailTraits'
 * innerHTML, handing back freshly-ENABLED buttons; renderRegenPanel() is what
 * disables them for a running job (app.js:1062-1065). Painting the traits after
 * the panel would re-enable both gutters every two seconds during a render and
 * reopen the 409 'already regenerating' window (server.js:699).
 */
function renderDetailFor(item) {
  renderDetailHeader(item);
  renderDetailTraits(item);
  renderDetailPrompts(item);
  renderRegenPanel(item);
}
```

`openDetail` keeps its own ordering (it must set `state.detailItemId` and `state.regenLastStatus` and reset the radios before `renderRegenPanel` runs, `public/app.js:1002-1007`); replace `:962-967`, `:987-994`, `:997-1000` and `:1008` with the four calls in that order, i.e. `renderDetailHeader` / `renderDetailTraits` / `renderDetailPrompts` early, then the existing state assignments, then `renderRegenPanel(item)` as today.

**Poll tick** — `public/app.js:1572-1578` becomes:

```js
    if (state.detailItemId) {
      const openItem = state.items.find((i) => i.id === state.detailItemId);
      if (openItem) {
        renderDetailFor(openItem);
        await refreshModel3d(state.detailItemId);
      }
    }
```

No guard on `regenStatus`. Repainting a table of ~20 rows every two seconds is cheap, the guard variant the investigation suggested (`justFinished`) is **not implementable** — `justFinished` is a function-local `const` at `public/app.js:1067` and `renderRegenPanel` destructively overwrites `state.regenLastStatus` on its last line (`:1085`), so no caller can observe it — and an unconditional repaint is what makes Phase 2's staged edits appear without a special case.

### P1-C · `public/app.js` — stop `renderRegenPanel` clobbering the status line

`public/app.js:1067-1076` becomes:

```js
  const justFinished = item.regenStatus === 'done' && state.regenLastStatus !== 'done';
  if (running) {
    el.regenStatus.textContent = state.regenRunningMessage
      || 'Regenerating… this can take a few minutes (ComfyUI must be running).';
  } else if (item.regenStatus === 'error') {
    state.regenRunningMessage = null;
    el.regenStatus.textContent = `Failed: ${item.regenError || 'unknown error'}`;
  } else if (justFinished) {
    state.regenRunningMessage = null;
    el.regenStatus.textContent = `Done — new seed ${item.seed}.`;
  } else if (item.regenStatus !== 'done') {
    state.regenRunningMessage = null;
    el.regenStatus.textContent = '';
  }
```

Add `state.regenRunningMessage = null;` to `openDetail`, beside `state.regenLastStatus = item.regenStatus ?? null;` (`public/app.js:1003`) — the message belongs to one item and one job.

### P1-D · `public/app.js` — poller robustness (D5, D6)

`startPolling`'s termination block, `public/app.js:1579-1593`:

```js
    const building3d = state.items.some((i) => i.model3dStatus === 'running');
    const stillPending = building3d || state.items.some((i) =>
      i.jobStatus === 'queued' || i.jobStatus === 'sent' || i.regenStatus === 'running');
    // An empty list is not "nothing is pending". generate-npc.py rewrites the
    // whole manifest non-atomically (generate-art.py:638) at the very end of a
    // regen, and loadManifest() answers [] for a half-written file
    // (server.js:167-174) - so the one tick most likely to read empty is the
    // one landing on the transition this poller exists to see. Keep polling;
    // the tick cap below still bounds it. See D6.
    const listUnreadable = state.items.length === 0;
    // The cap is a safety net against an unreachable ComfyUI, not a deadline
    // for the job. A regen queues portrait, token and the background-removal
    // pass, each with generate-npc.py's own --timeout default of 1800s
    // (generate-npc.py:3144), so 20 minutes cut off runs that were still fine.
    const cap = building3d ? 2700 : 2700;   // 90 minutes at 2s/tick
    if ((!stillPending && !listUnreadable) || ticks > cap) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      if (!stillPending && sawImportPending) el.status.textContent = 'Import complete.';
      // Never stop silently on a job that is still going: the card keeps its
      // "Regenerating…" pill and nothing else on the page would say why.
      if (stillPending) {
        el.status.textContent =
          'Still working after 90 minutes — reload the page to check on it.';
      }
    }
```

Also fix the guard race noted in verification: `if (state.pollTimer) return;` (`public/app.js:1564`) makes a start a no-op while a tick is mid-flight, and that tick can then clear the timer using a list fetched before the POST landed. Make the guard restartable:

```js
function startPolling() {
  state.pollWanted = (state.pollWanted || 0) + 1;   // bump; a tick in flight sees it
  if (state.pollTimer) return;
  …
```

and inside the tick, capture `const wantedAtEntry = state.pollWanted;` at the top and refuse to clear when `state.pollWanted !== wantedAtEntry`. Add `pollWanted: 0` to `state`.

### P1-E · REPO B `generate-npc.py` — persist a pinned trait (D3)

`generate-npc.py:4272-4280`. Change the gate:

```python
    # Only when a trait actually changed: a plain regen reproduces the entry
    # and rewriting traits it did not touch would just churn the manifest.
    #
    # args.overrides counts as a change. --set-trait runs reroll_from_raw()
    # with `pinned`, which replaces `npc` wholesale, and the derived-flag
    # writes above (young, outfit_notac, gear_helmet, ...) already persist the
    # NEW roll unconditionally - so gating only on `rerolled` left the entry
    # holding new flag registers over old bullets, which npc_from_entry() then
    # reloads and filters the NEXT roll against. That is corruption, not
    # staleness.
    if rerolled is not None or args.overrides:
        entry["traits"] = {k: v for k, v in npc.items() if not k.startswith("_")}
        if npc.get("_raw") is not None:
            entry["rawTraits"] = dict(npc["_raw"])
```

**Completeness of the gate, verified:** `--release` is rejected without `--set-trait` (`generate-npc.py:3214-3215`) and `--trait-choices` refuses both edit flags (`:3204-3208`). There is no third mutating path.

### P1-F · REPO B `generate-art.py` — atomic manifest write (D6's other half)

`generate-art.py:638-639`:

```python
def save_manifest(path, data):
    # Written to a sibling temp file and renamed, because the Import GUI reads
    # this file every two seconds and answers [] for a half-written one
    # (server.js:167-174) - which reads to the browser as "the library is
    # empty" and stops its poller mid-job. os.replace is atomic on both
    # POSIX and Windows when source and destination share a directory.
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)
```

`import os` is already present at the top of `generate-art.py`; confirm before editing.

---

## 3. Phase 2 — staged, accumulating trait edits with rendering as a separate action

### The chosen design, in one paragraph

**The manifest entry is the accumulator. There is no new persistent state anywhere.** A trait edit becomes a fast, synchronous, no-render invocation of the generator that applies the roll and writes `traits` / `rawTraits` / the derived flags back to the entry, marks `artStale`, and prints the updated trait dict on stdout. The GUI applies edits one click at a time — each one re-reads the now-updated entry, so `--trait-choices`, the conflict/`releases` reporting and every filter stay correct by construction across an arbitrary sequence of edits. Rendering is the existing Regenerate button: with the entry already carrying the accumulated traits, a plain `--regen-manifest --regen-id --new-seed` renders exactly the staged NPC and clears `artStale`.

The alternative — a server-side `pendingEditsByItemId` map committed on Regenerate — is rejected: it forces `itemView` to merge pending over stored traits, forces `readTraitChoices`/`cacheKeyFor` to key on and pass the pending overrides (which additionally requires lifting `generate-npc.py:3206-3208` so `--trait-choices` accepts `--set-trait`), and loses everything on a server restart. The one thing manifest-as-accumulator gives up is the invariant "the stored image matches the stored traits", and `artStale` makes that explicit rather than silent.

**D3 (P1-E) is a hard prerequisite.** Without it a pin writes nothing, and `cacheKeyFor`'s `rawTraits` fingerprint (`lib/traitChoices.js:83-85`) never changes, so the picker keeps answering from the pre-pin cache. Land P1-E first.

### 3.1 REPO B — `--apply-only`

**New flag**, in the `regenerate one NPC from a manifest entry` group, after `--release` (`generate-npc.py:3126-3129`):

```python
    regen.add_argument("--apply-only", action="store_true",
                       help="with --reroll-trait or --set-trait: apply the edit to the "
                            "manifest entry and stop. Renders nothing, contacts no "
                            "ComfyUI server, and does not touch the entry's seed, files, "
                            "portrait, token or dossier - only its traits, rawTraits, the "
                            "derived flags and an artStale marker saying the stored art no "
                            "longer matches. Prints the updated traits as JSON on stdout. "
                            "Meant for staging several edits before one render.")
```

**Validation**, in `parse_args`, immediately after the `--reroll-trait` xor `--set-trait` check (`generate-npc.py:3210-3211`):

```python
    if args.apply_only:
        if not args.regen_manifest:
            p.error("--apply-only needs --regen-manifest and --regen-id")
        if not args.reroll_trait and not args.overrides:
            p.error("--apply-only needs --reroll-trait or --set-trait; it has nothing to apply")
        if args.trait_choices:
            p.error("--trait-choices only reports; drop --apply-only")
```

`--no-portrait`/`--no-token` are **not** required with `--apply-only` and the mutual refusal at `generate-npc.py:3153` is left untouched — apply-only exits before any render decision is read.

**Control flow.** `regenerate_one` (`generate-npc.py:4046`) splits at the boundary between "the roll half" and "the render half", which is line `:4157` (`seed = args.new_seed …`). Insert, immediately before `:4157`:

```python
    # The staged-edit exit. Everything above this line is the roll: the entry
    # loaded, one trait re-rolled or pinned, `npc` replaced wholesale. Everything
    # below it needs a ComfyUI server (art.find_server at :4184 contacts one even
    # when both stages are skipped), a workflow, and prompt/file locals the
    # writer at :4247 reads - so the cut is here and the writer is shared rather
    # than duplicated.
    if args.apply_only:
        persist_traits(entry, npc)
        entry["artStale"] = True
        entry["when"] = time.strftime("%Y-%m-%d %H:%M:%S")
        manifest[folder_path] = entry
        art.save_manifest(args.regen_manifest, manifest)
        json.dump({
            "id": args.regen_id,
            "traits": entry["traits"],
            "rawTraits": entry.get("rawTraits"),
            "artStale": True,
        }, sys.stdout)
        return 0
```

**One caution the implementer must respect:** `regenerate_one` prints diagnostics to **stdout** in the edit blocks — `print("re-rolled %s: …")` at `:4083-4084`, the cascade report at `:4092-4095`, `print("set %s: …")` at `:4148`, and the release report at `:4152-4155`. `--apply-only` parses stdout whole, exactly as `--trait-choices` and `--trait-odds` do. **Those prints must be redirected to stderr when `args.apply_only` is set.** Do it by binding a local at the top of `regenerate_one`:

```python
    # --apply-only's caller parses stdout whole, the same contract
    # print_trait_choices() keeps. The cascade and release reports are
    # diagnostics, so they go to stderr in that mode - and the GUI surfaces
    # them, since "with Hair colour: ... -> ..." is exactly what a user needs
    # to see after clicking Re-roll.
    say = (lambda *a: print(*a, file=sys.stderr)) if args.apply_only else print
```

and replace those four `print(` calls with `say(`. Leave `print("regenerating %s …")` at `:4166` and everything below alone — apply-only returns before them.

**New shared writer**, defined just above `regenerate_one`:

```python
def persist_traits(entry, npc):
    """Write the rolled NPC's traits and raw bullets back onto its entry.

    Shared by the render path and --apply-only so the two cannot drift. The
    derived flag registers (young, outfit_notac, gear_helmet, ...) are written
    by the caller alongside these, and writing one without the other is what
    left set-trait entries holding new flags over old bullets.
    """
    entry["traits"] = {k: v for k, v in npc.items() if not k.startswith("_")}
    # Only when _raw is actually known. A legacy entry has none, and inventing
    # some now would claim a provenance the entry never had.
    if npc.get("_raw") is not None:
        entry["rawTraits"] = dict(npc["_raw"])
```

Rewrite `generate-npc.py:4253-4280` to call `persist_traits(entry, npc)` behind the P1-E gate and to keep the seven `if npc.get("_x") is not None:` flag writes as they are. Note the ordering requirement: **apply-only must write the same derived flags**, so hoist `:4253-4271` into a second helper `persist_flags(entry, npc)` and call it from both paths. Both helpers together are the complete "what the roll produced" write.

**Clearing the marker.** In the render path, beside `entry["when"] = …` (`generate-npc.py:4281`):

```python
    # A real render brings the art back in line with the traits. Popped rather
    # than set False so an entry that never staged anything stays byte-identical
    # to what earlier versions wrote.
    #
    # Popped even for --no-portrait/--no-token: a partial render is the user
    # explicitly asking for one stage, and leaving the marker up would nag
    # about art they chose not to remake.
    entry.pop("artStale", None)
```

**Not changed, deliberately:** the `--reroll-trait` xor `--set-trait` refusal (`generate-npc.py:3211`) stays. Each staged click carries exactly one edit, so batch expression is never needed; dropping the refusal would require merging `:4064-4155` into one `reroll_from_raw` call, which **silently deletes the legacy fallback path** in `reroll_trait` (`generate-npc.py:3623-3787`) — the only re-roll path for entries written before `rawTraits` existed, which the server still offers buttons for via `rerollableFor` (`server.js:1068`). Do not do it.

**Not changed:** `--trait-choices` stays read-only and keeps refusing the edit flags. Because the entry itself is the accumulator, it needs no `--set-trait` awareness.

### 3.2 REPO A — `lib/applyTrait.js` (new, ~70 lines)

Mirrors `lib/traitChoices.js` exactly in structure and in the reason for existing: build the argv, validate what comes back, and let the route do the I/O.

```js
/** The argv for one staged edit. Separate so a test can assert on it without spawning. */
function applyArgs(scriptPath, manifestPath, npcId, { op, table, value, release, seed }) {
    if (!npcId || typeof npcId !== 'string') throw new Error(…);
    if (!table || typeof table !== 'string') throw new Error(…);
    const args = [scriptPath, '--regen-manifest', manifestPath,
        '--regen-id', npcId, '--apply-only',
        // A draw seed, not the entry's seed. --apply-only never writes it: the
        // entry's `seed` describes the noise of the STORED image, and a staged
        // edit does not make an image. Without a fresh one here, re-rolling the
        // same trait twice would draw the same value both times, because the
        // generator falls back to entry["seed"] (generate-npc.py:4082).
        '--new-seed', String(seed)];
    if (op === 'reroll') args.push('--reroll-trait', table);
    else if (op === 'set') {
        if (!value || typeof value !== 'string') throw new Error(…);
        args.push('--set-trait', `${table}=${value}`);
        if (release && release.length) args.push('--release', release.join(','));
    } else throw new Error(`op must be "reroll" or "set", got ${JSON.stringify(op)}`);
    return args;
}

const APPLY_KEYS = ['id', 'traits', 'artStale'];
function parseApplyOutput(stdout) { /* JSON.parse; assert the three keys, traits is an object */ }

module.exports = { applyArgs, parseApplyOutput };
```

### 3.3 REPO A — `server.js`

**`itemView` (`server.js:1552`)** — one new field, beside `portraitPrompt`/`tokenPrompt` (`server.js:1621-1623`):

```js
        // generate-npc.py --apply-only sets this when a trait edit lands
        // without a render, and clears it on the next real render. The traits
        // and prompts above therefore describe the NPC; the images may not.
        artStale: !!item.artStale,
```

Verified safe: no test enumerates `itemView`'s key set (`grep -rn "Object.keys(item\|deepStrictEqual" test/*.test.js` finds only `importerContract.test.js:39` and `traitChoices.test.js`, neither on this shape). The `/importer/*` contract carries no traits at all and is untouched.

**New per-item guard**, beside `regenJobsByItemId` (`server.js:693`):

```js
/**
 * Items with a --apply-only spawn in flight. A staged edit reads the entry,
 * rolls, and writes the whole entry back, so two overlapping ones lose the
 * first - and they are fast enough (no ComfyUI) that a user CAN double-click
 * inside the window. One at a time per item, refused rather than queued.
 */
const stagingItemIds = new Set();
const STAGE_TIMEOUT_MS = 60000;
```

**New route `POST /api/stage-trait`**, placed immediately after the `/api/set-trait` block (i.e. after `server.js:1986`).

Request: `{ id, op: 'reroll' | 'set', table, value?, release?: string[] }`
Responses:
- `200 { ok: true, item: <itemView>, log: <stderr tail> }`
- `400` — unknown/absent `table`, bad `op`, non-npc kind, no `rawTraits` (op `set`), table not in `rerollableFor(item)`, value not offered, stray `release`
- `404` — unknown id
- `409 { ok:false, reason }` — a regen job is running for this item, or a stage is already in flight
- `502` — the generator failed; `reason` carries its stderr tail
- `504` — the generator did not finish inside `STAGE_TIMEOUT_MS`

Validation, in order, **reusing the existing code verbatim** so a refusal here can never disagree with the one the older routes give:

1. `const item = body.id && findItem(body.id); if (!item) 404`.
2. `if (item.kind !== 'npc') 400` — same wording as `server.js:1925-1929`.
3. `const op = body.op === 'reroll' || body.op === 'set' ? body.op : null; if (!op) 400`.
4. `table` non-empty string, else 400.
5. `const allowed = rerollableFor(item); if (allowed.length && !allowed.includes(table)) 400` — the reroll wording from `server.js:1901-1907` for `op === 'reroll'`, the set wording from `:1946-1949` for `op === 'set'`.
6. For `op === 'set'` only: `if (!hasRawTraits(item)) 400` (wording from `server.js:1931-1936`); then `const query = await readTraitChoices(item, table)` → 502 on failure; then the exact `choices.find(c => c.value === value)` check (`server.js:1958-1966`) and the stray-release check (`server.js:1970-1977`). **Do not skip this.** `--set-trait` pastes its bullet verbatim into an image prompt, and the staged entry is what the eventual render reads.
7. `if (regenJobsByItemId.get(item.id)?.status === 'running') return sendJson(res, 409, { ok:false, reason: 'this NPC is being re-rendered; wait for it to finish' })`.
8. `if (stagingItemIds.has(item.id)) return sendJson(res, 409, { ok:false, reason: 'another edit is still being applied' })`.

Then `runApplyTrait(item, { op, table, value, release })` — structured exactly like `runTraitChoices` (`server.js:1427-1474`): `existsSync(GENERATE_NPC_SCRIPT)` guard, `applyArgs(...)` inside a try, `spawn(config.pythonExecutable, args, { cwd: path.dirname(GENERATE_NPC_SCRIPT) })` inside a try, stdout accumulated whole, stderr tail-capped at `ODDS_LOG_LIMIT`, `close` resolving `{ ok:true, data: applyTrait.parseApplyOutput(out), log: errText }` on code 0 and `{ ok:false, reason: errText.trim() || … }` otherwise. Two additions over `runTraitChoices`:

- `stagingItemIds.add(item.id)` before the spawn and `.delete(...)` in a `finally`-equivalent on every resolve path.
- A `setTimeout(() => { child.kill(); resolve({ ok:false, timedOut:true, … }); }, STAGE_TIMEOUT_MS)`, cleared on `close`.

Seed: `crypto.randomInt(0, 2 ** 32 - 1)`, generated in the route and passed into `applyArgs`.

On success the route re-reads the item so the response carries the *stored* truth rather than the generator's stdout:

```js
        const fresh = findItem(item.id);
        return sendJson(res, 200, {
            ok: true,
            item: fresh ? itemView(fresh) : null,
            // The generator's own "with Hair colour: 'x' -> 'y'" cascade report,
            // off stderr. It is the only place that says what travelled, and a
            // user who clicked one button and got four new traits needs it.
            log: result.log || '',
        });
```

**`/api/reroll-trait` and `/api/set-trait` are left exactly as they are.** They remain the "edit and render now" path, they are pinned by `test/api.rerollTrait.test.js` and `test/api.setTrait.test.js`, and keeping them means a stale browser tab still works. Add a comment above each saying the GUI's buttons now use `/api/stage-trait` and these are the one-shot equivalent.

**`startRegenJob` needs no change.** With the entry already carrying the accumulated traits, `/api/regenerate` with `which:'both'` and any `seedMode` renders the staged NPC.

### 3.4 REPO A — client state and control flow

**State.** Two additions to `state` (`public/app.js:11-27`), and nothing else — the accumulator lives on the server:

```js
  // The item whose staged edit is in flight, so both trait gutters can be shut
  // for the ~1s the generator takes. Not an edit list: the manifest entry is
  // the accumulator, and this page only ever re-renders what the server sends
  // back. See docs on /api/stage-trait.
  stagingItemId: null,
  regenRunningMessage: null,   // from P1-C
  pollWanted: 0,               // from P1-D
```

**New shared handler**, replacing the bodies of both delegated listeners (`public/app.js:2963-3001` and `:3003-3044`):

```js
/**
 * Apply one trait edit to the stored NPC, with no render.
 *
 * The whole point of the redesign: a re-roll used to queue two ComfyUI jobs and
 * take minutes, so trying three haircuts cost the better part of an hour and,
 * because the server refuses a second regen while one runs (server.js:699),
 * could not be done back to back at all. Now the edit lands in the manifest in
 * about a second and the Regenerate button - unchanged - is what makes the
 * picture. `artStale` is what tells the user the two have parted company.
 */
async function stageTraitEdit({ id, op, table, value, release, button }) {
  const label = op === 'reroll' ? `re-roll ${table}` : `set ${table}`;
  state.stagingItemId = id;
  button.disabled = true;
  setTraitGuttersDisabled(true);
  el.regenStatus.textContent = op === 'reroll' ? `Re-rolling ${table}…` : `Setting ${table}…`;
  try {
    const res = await fetch('/api/stage-trait', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, op, table, value, release }),
    });
    const result = await res.json();
    if (!res.ok) {
      el.regenStatus.textContent = `Couldn't ${label}: ${result.reason || result.error || res.status}`;
      return;
    }
    // Straight from the response - the server re-read the entry after the
    // generator wrote it, so this is the stored truth and not an echo.
    if (result.item) {
      const at = state.items.findIndex((i) => i.id === id);
      if (at !== -1) state.items[at] = result.item;
      renderDetailFor(result.item);
      render();
    }
    el.regenStatus.textContent = cascadeSummary(table, result.log)
      || `${table} updated. The art is now out of date — press Regenerate when you are done editing.`;
  } catch (err) {
    el.regenStatus.textContent = `Couldn't ${label}: ${err.message}`;
  } finally {
    state.stagingItemId = null;
    // renderDetailFor already rebuilt the buttons from the fresh item, so this
    // only matters on the failure paths, where the table was never replaced.
    setTraitGuttersDisabled(false);
  }
}
```

`setTraitGuttersDisabled(on)` is the loop from `public/app.js:1062-1065`, lifted so both it and `renderRegenPanel` use one selector. `renderRegenPanel` keeps its own call, and gains one more condition so a staging edit shuts the gutters too:

```js
  const running = item.regenStatus === 'running' || state.stagingItemId === item.id;
```

Careful: `el.regenBtn.disabled = running;` at `public/app.js:1044` then also disables Regenerate during a stage, which is correct — Regenerate mid-write would read a half-applied entry.

`cascadeSummary(table, log)` parses the generator's stderr lines (`  with <Trait>: 'old' -> 'new'`) into `Re-rolled Hair — Hair colour also changed. Art is out of date.` Return `null` when nothing matched so the generic sentence is used.

The two listeners keep their existing preambles verbatim — `rerollNeedsConfirm(trait) && !(await confirmReroll(trait))` at `public/app.js:2973` (pinned by `test/ui.rerollConfirm.test.js:394-397`) and `openSetTrait(item, trait)` at `:3016` — and then call `stageTraitEdit({...})`.

**The Regenerate button (`public/app.js:1211-1249`) is unchanged** beyond P1-A/P1-C. It is now the explicit render action the user asked for.

### 3.5 UI affordance

**1. Trait table — unchanged controls, instant result.** `Re-roll` and `Set…` sit where they are (`traitControlCells`, `public/app.js:904`, and its two-`<td>` contract pinned by `test/ui.traitColumns.test.js`). Clicking repaints the row — and every cascaded row — in about a second.

**2. A stale-art notice in the Regenerate panel.** New markup in `public/index.html`, inside `#regen-panel` immediately after `<h3>Regenerate art</h3>` (currently `public/index.html:247`):

```html
        <p class="regen-stale" id="regen-stale" hidden>
          Traits have changed since this art was made. Press Regenerate to render them.
        </p>
```

New `el` entry: `regenStale: document.getElementById('regen-stale'),` after `regenStatus` (`public/app.js:61`). In `renderRegenPanel`, after the seed line (`public/app.js:1041`):

```js
  el.regenStale.hidden = !item.artStale;
  el.regenBtn.classList.toggle('accent', !!item.artStale && !running);
```

`public/style.css`: `.regen-stale { color: #b7791f; font-weight: 600; margin: 0 0 .5rem; }` and an `.accent` button rule matching the existing button palette.

**3. A card badge.** In `render()`'s single-slot badge chain, insert a new arm between the `regenStatus === 'error'` arm (ending `public/app.js:713`) and the `model3dStatus === 'running'` arm (`:714`):

```js
    } else if (item.artStale) {
      const badge = document.createElement('span');
      badge.className = 'badge stale';
      badge.textContent = 'Art out of date';
      badge.title = 'Traits were edited after this art was made — open it and press Regenerate';
      card.appendChild(badge);
```

Placement is deliberate: a live or failed job outranks it, a 3D build does not (a stale portrait is the more actionable fact). `public/style.css`, beside `.card .badge.pending` (`public/style.css:302`): `.card .badge.stale { background: #7d5ba6; }`. The `New` pill at `public/app.js:730-737` stays an independent `if` — `test/ui.newBadge.test.js:58` pins that with the regex `/\n\s*if \(item\.isNew && !item\.imported\) \{/`, and the insertion above does not touch it.

**4. Nothing else.** No staging tray, no "commit" step, no undo. Each edit is already committed; Regenerate is the only remaining action, and it is the button that has always been there.

### 3.6 Existing tests that must change, and why

| Test | Change | Why |
|---|---|---|
| `test/ui.rerollConfirm.test.js:396` | `js.indexOf("fetch('/api/reroll-trait'")` → `js.indexOf("fetch('/api/stage-trait'")` | The re-roll button no longer starts a render, so the route name in the assertion is wrong. The assertion's *point* — the confirm gate is awaited before anything is posted — is unchanged and still worth pinning. |
| `test/api.rerollTrait.test.js`, `test/api.setTrait.test.js` | **No change.** | Both routes are preserved verbatim. |
| `test/ui.regenBanner.test.js` | **No change.** | It pins `regenSeen`, the `previous !== 'running'` gate (`:100-105`) and `detectRegenFinished(state.items)` before `render()` inside `refreshItems` (`:131-141`). P1-A seeds the gate rather than removing it; P1-B does not touch `refreshItems`. |
| `test/ui.traitColumns.test.js`, `test/ui.setTraitPicker.test.js`, `test/ui.newBadge.test.js` | **No change.** | `liftFunction` brace-matches `traitControlCells` by name (unchanged); the row template literal at `public/app.js:991-993` moves into `renderDetailTraits` byte-for-byte; `ui.newBadge.test.js:71-77` regexes `openDetail` for `markSeen([item.id])`, which stays at `public/app.js:1029`. |
| REPO B `test/test_reroll_trait.py::TestTheRegenWriterActuallyRuns` (`:995-1072`) | **No change.** | `if rerolled is not None or args.overrides:` is still true for a reroll, and it constructs `args` with `overrides={}`. It does *not* set `apply_only`, so add `apply_only=False` to its `SimpleNamespace` (`test_reroll_trait.py:1057-1062`) — otherwise `regenerate_one`'s new `if args.apply_only:` raises `AttributeError`. **This is a required mechanical edit to that test and to `test_reroll_trait.py:958`'s sibling namespace.** |
| REPO B `test/test_set_trait_value.py::SetTraitOnARegen` (`:330-355`) | **No change**; new cases added beside it. | It calls `npc_from_entry` + `reroll_from_raw` by hand and never reaches the writer — which is the coverage gap that let `:4273` rot. |
| `docs/foundry-importer-contract.md`, `test/importerContract.test.js` | **No change.** | The importer payload carries no traits and no `artStale`. |
| `docs/known-issues.md` | New entry. | Record the Role-reroll folder/category mismatch (§1, out of scope), and record that `--no-portrait`/`--no-token` clears `artStale`. |

---

## 4. Test plan

Conventions: `node --test`, zero dependencies, `node:test` + `node:assert/strict`, `startTestServer` from `test/helpers/testServer.js` with an **explicit unique port per file**. Ports 5193-5199 and 5201-5220 are taken; the four new files take **5221, 5222, 5223, 5224**. UI behaviour is asserted against the *served source text* of `/app.js` (the technique `test/ui.regenBanner.test.js:12-16` documents) or by lifting a function with `liftFunction` (`test/ui.traitColumns.test.js:39-53`).

### 4.1 `test/ui.regenPolling.test.js` (new, port 5221) — D1, D4, D7, D8, D5

Fails today at every case.

1. **`the re-roll handler starts the poller`** — fetch `/app.js`; slice the reroll handler out with `/el\.detailTraits\.addEventListener\('click', async \(event\) => \{[\s\S]*?closest\('\.reroll-btn'\)[\s\S]*?\n\}\);/`; assert `/startPolling\(\)/` matches inside it. *Fails now:* the handler ends at `await refreshItems();`.
2. **`the Set… handler starts the poller`** — same, keyed on `closest('.set-trait-btn')`.
3. **`the poller is started before the list reload, not after`** — inside each lifted handler, assert `indexOf('startPolling()') < indexOf('await refreshItems()')`. Pins D7: `refreshItems` throws through `api()` on a non-OK response, and a poller started after it would be skipped exactly when a job is running.
4. **`both handlers record the job as started`** — assert `/noteRegenStarted\(/` inside each handler, and that `function noteRegenStarted(` exists and contains `regenSeen.set(id, 'running')`. Pins D4.
5. **`the Regenerate and 3D handlers do the same`** — lift the `el.regenBtn.addEventListener` and `el.model3dBtn.addEventListener` bodies; same two ordering assertions.
6. **`renderRegenPanel does not overwrite a trait-specific message`** — lift `renderRegenPanel` source; assert `/state\.regenRunningMessage\s*\n?\s*\|\|/` appears in the `if (running)` branch. Pins D8.
7. **`the poll cap allows for the generator's own timeout`** — lift `startPolling` source; assert it does **not** contain `ticks > (building3d ? 1800 : 600)` and does contain a cap `>= 2700`; assert `/state\.items\.length === 0/` appears (D6's client half).

### 4.2 `test/api.stageTrait.test.js` (new, port 5222) — the route

Modelled on `test/api.setTrait.test.js` — same `TABLES_FIXTURE`/`ENTRY` shape, the same argv-recording stub pattern (`STUB` appends `process.argv.slice(2)` to `argv.log` beside itself and answers `--trait-choices` with a canned `PAYLOAD`), plus a new branch: when the argv contains `--apply-only`, the stub rewrites the manifest entry it was pointed at and prints `{"id":…, "traits":{…, "Outfit":"a kimono"}, "artStale":true}` on stdout. That makes the whole route testable with no Python.

| Case | Assertion |
|---|---|
| unknown id | 404 |
| non-npc kind | 400 |
| bad `op` | 400 |
| `op:'set'` on an entry with no `rawTraits` | 400, message names the cure |
| a table outside `rerollableFor(item)` | 400, message lists the applicable set |
| `op:'set'` with a value the choices query never offered | 400 — the verbatim re-check ran |
| `op:'set'` with a `release` not in that value's `conflicts` | 400 |
| **the argv is `--apply-only` plus one edit flag** | read `argv.log`; assert the apply line contains `--apply-only`, `--regen-id npc-test-1`, `--reroll-trait Outfit` (or `--set-trait Outfit=a kimono \|\| civ notac`), a `--new-seed` with a numeric argument, and **no** `--no-portrait`/`--no-token` |
| **a successful stage answers 200 with a refreshed item** | `res.status === 200`; `body.item.traits.Outfit` is the new value; `body.item.artStale === true` |
| **a second stage while the first is in flight is 409** | stub sleeps 300 ms; fire two POSTs without awaiting the first; one is 200, the other 409 |
| **a stage while a regen job runs is 409** | POST `/api/regenerate` first (stub sleeps), then stage |
| **a generator failure is 502 with its stderr** | stub writes to stderr and `process.exit(1)`; assert 502 and that the body's `reason` contains the stderr text |
| **`/api/reroll-trait` and `/api/set-trait` still answer 202** | one case each — the compatibility guarantee |

### 4.3 `test/applyTrait.test.js` (new, no server) — the pure module

Mirrors `test/traitChoices.test.js`.

- `applyArgs` builds the reroll argv exactly; builds the set argv exactly; appends `--release a,b` only when the array is non-empty; throws on a missing id, a missing table, an unknown `op`, and on `op:'set'` with no value.
- `parseApplyOutput` parses a well-formed payload; throws on non-JSON with a message naming `--apply-only`; throws when `traits` is missing; throws when `traits` is not an object.

### 4.4 `test/ui.detailRepaint.test.js` (new, port 5223) — D2 and §3.4

1. **`the trait table has its own renderer`** — `assert.match(js, /function renderDetailTraits\(/)`. *Fails now.*
2. **`the poll tick repaints the whole sheet`** — lift `startPolling`; assert `/renderDetailFor\(openItem\)/` and `assert.doesNotMatch(tick, /renderRegenPanel\(openItem\)/)`. *Fails now:* the tick calls only `renderRegenPanel`.
3. **`the traits are painted before the regen panel`** — lift `renderDetailFor`; assert `indexOf('renderDetailTraits(') < indexOf('renderRegenPanel(')`. This is the 409-reopening hazard: `renderDetailTraits` hands back freshly-enabled buttons and `renderRegenPanel` is what shuts them.
4. **`renderDetailTraits renders the current values and the right buttons`** — `liftFunction(js, 'renderDetailTraits', { el, traitControlCells, escapeHtml, rerollableForItem, TRAIT_KEY_EXCLUDE })` with a fake `el.detailTraits = { innerHTML: '' }`; call it with `{ traits: { Outfit: 'a kimono' }, rawTraits: {…} }` and assert the produced HTML contains `a kimono` and one `class="reroll-btn"`; call again with a legacy item (`rawTraits: {}`) and assert the explanation cell instead. Proves the extraction is a real function and not a source-text token.
5. **`the header, files and prompts are repainted too`** — assert `function renderDetailHeader(` and `function renderDetailPrompts(` exist and that `renderDetailFor` calls all four.
6. **`the stale-art notice ships hidden and is honoured`** — fetch `/`; `assert.match(html, /id="regen-stale"[^>]*hidden/)`; fetch `/style.css`; `assert.match(css, /\.regen-stale\s*\{/)`. Same two-halves discipline as `test/ui.regenBanner.test.js:39-51`.
7. **`the stale badge is its own arm of the badge chain, after the regen arms`** — lift `render`; assert `indexOf("'Regen failed'") < indexOf("'Art out of date'") < indexOf("'Building 3D…'")`.
8. **`the trait buttons post to /api/stage-trait`** — assert `/fetch\('\/api\/stage-trait'/` appears in `stageTraitEdit`, and that neither trait handler still contains `fetch('/api/reroll-trait'` or `fetch('/api/set-trait'`.

### 4.5 `test/api.artStale.test.js` (new, port 5224) — the wire field

- `/api/items?category=npc` on a manifest entry carrying `artStale: true` returns `items[0].artStale === true`.
- An entry with no such key returns `artStale === false`, not `undefined` — the client's `hidden = !item.artStale` and the badge arm both read it directly.
- The field is absent from `GET /importer/pending`'s payload (guard against it leaking into the Foundry contract).

### 4.6 REPO B — `test/test_apply_only.py` (new, pytest/unittest, `test/helpers.py::load_generator`)

Modelled on `test/test_reroll_trait.py::TestTheRegenWriterActuallyRuns` (`:995-1072`): build a real entry from a rolled NPC, write it to a temp manifest, drive `gen.regenerate_one(args)`, read the manifest back.

1. **`a pinned trait is persisted to the manifest`** — *the D3 regression test, and the one that fails today.* `args = SimpleNamespace(regen_manifest=…, regen_id=…, reroll_trait=None, overrides={"Demeanor": "<a bullet from FIXTURE_TABLES>"}, release=[], new_seed=None, tables=FIXTURE_TABLES, no_portrait=True, no_token=True, server=None, apply_only=False)` with `gen.art.find_server` mocked to a `SimpleNamespace(base="stub://nowhere")` and a real packaged workflow path on the entry. Assert `saved[folder_path]["traits"]["Demeanor"]` and `saved[folder_path]["rawTraits"]["Demeanor"]` both hold the pinned bullet. *Fails today:* `:4273` leaves both at the pre-edit value.
2. **`a pinned trait leaves the entry self-consistent`** — the sharper form. After the same run, rebuild with `gen.npc_from_entry(saved[folder_path], regen_id)` and assert `npc["_outfit_notac"] == saved[folder_path]["outfit_notac"]` and that `npc["Outfit"]` matches `saved[folder_path]["traits"]["Outfit"]`. Pins the flags-over-old-bullets corruption directly.
3. **`--apply-only writes traits and never contacts a server`** — same args with `apply_only=True`, `no_portrait=False`, `no_token=False`, and **`gen.art.find_server` patched to raise `AssertionError`**. Assert the call returns 0 (i.e. the patch was never reached), `saved[folder_path]["traits"]` carries the pin, and `saved[folder_path]["artStale"] is True`.
4. **`--apply-only does not touch the art keys`** — assert `saved[folder_path]["seed"]`, `["files"]`, `["portrait"]`, `["token"]`, `["portraitPrompt"]`, `["tokenPrompt"]` are all identical to the pre-run entry.
5. **`--apply-only prints only JSON on stdout`** — capture with `contextlib.redirect_stdout(io.StringIO())` and `redirect_stderr`; `json.loads(stdout)` must succeed and carry `id`/`traits`/`artStale`; the cascade report (`"with "`) must appear in **stderr**, not stdout. This is the assertion that catches the `print` → `say` redirect being missed, which would break the GUI's JSON parse for every re-roll with a cascade.
6. **`--apply-only accumulates`** — run it three times in a row on the same manifest (a set, then a re-roll of a different trait, then a second set) and assert the final entry carries all three edits. This is the user's stated intent, tested end to end at the generator level.
7. **`a real render clears artStale`** — run 3, then a render-path `regenerate_one` with `no_portrait=True, no_token=True` and `find_server` stubbed; assert `"artStale" not in saved[folder_path]`.
8. **`parse_args refuses --apply-only without an edit`** — `assertRaises(SystemExit)` for `--apply-only` alone, and for `--apply-only --trait-choices Outfit`.

### 4.7 REPO B — `test/test_manifest_atomicity.py` (new, small)

`gen.art.save_manifest(path, data)` on an existing file: assert the file's content is valid JSON at every point by monkeypatching `Path.write_text` to raise after writing, and asserting the original file survives intact. Simpler equivalent, and sufficient: assert `save_manifest` writes through a temp sibling and that no `*.tmp` file survives a successful call. Pins P1-F.

---

## Landing order

1. **P1-E + P1-F** (REPO B) with `test_apply_only.py` cases 1, 2 and `test_manifest_atomicity.py`. These are the data-integrity fixes; every subsequent step depends on the manifest being trustworthy.
2. **P1-A, P1-C, P1-D** (REPO A) with `test/ui.regenPolling.test.js`. The GUI now reports a re-roll honestly under the existing render-immediately behaviour.
3. **P1-B** (REPO A) with the first five cases of `test/ui.detailRepaint.test.js`. The sheet now updates itself.
4. **§3.1 `--apply-only`** (REPO B) with the rest of `test_apply_only.py`.
5. **§3.2-3.3 `lib/applyTrait.js` + `/api/stage-trait` + `itemView.artStale`** with `test/applyTrait.test.js`, `test/api.stageTrait.test.js`, `test/api.artStale.test.js`.
6. **§3.4-3.5 client re-point + affordances**, with the remaining `ui.detailRepaint` cases and the one-line change to `test/ui.rerollConfirm.test.js:396`.