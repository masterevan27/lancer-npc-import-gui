# Choosing a trait's value from the detail sheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a **Set…** button beside every trait's **Re-roll**, opening a picker that lists the values that trait could take on this NPC, and regenerates from the chosen one.

**Architecture:** No legality logic on this side. `generate-npc.py --trait-choices` answers which values are legal and what each would cost; this end builds the command line, caches the answer, renders it, and posts the choice back through the regen job that `--reroll-trait` already uses.

**Tech Stack:** Node (no dependencies, no build step), vanilla DOM in `public/app.js`. Tests are `node --test "test/*.test.js"`.

**Spec:** `docs/superpowers/specs/2026-09-06-set-trait-value-picker-design.md`

**Depends on:** the `lancer-art-generator` plan `docs/superpowers/plans/2026-09-06-set-trait-value.md` being complete and merged. Tasks 2 onward spawn `generate-npc.py --trait-choices` and will fail against a generator without it.

## Global Constraints

- **Never compute legality here.** No flag parsing, no theme matching, no filter logic in JavaScript. If this plan tempts you to read `||` flags to decide anything, stop — that is the drift `lib/traitOdds.js` was written to prevent.
- **The offer and the refusal must agree.** Every place that decides whether to draw a Set… button uses the same `rerollableFor(item)` + `hasRawTraits(item)` test the route uses to accept or refuse. A button that answers 400 is worse than no button.
- **Values are raw bullets, verbatim.** Post back exactly the `value` string the generator emitted, flags and all. Pretty-printing is display only, via `traitOptions.readableLabel`.
- **Each new test file that binds a port needs a unique one.** Ports 5193–5199 and 5201–5212 are taken. Before claiming a number, run: `grep -rhoE "(port: |PORT = )5[0-9]+" test/*.test.js | sort -u`. A collision does not fail — it hangs the whole run until timeout.
- **Test counts in `README.md` move with every added test**, and there are two numbers (`node --test "test/*.test.js"` and CI's bare `node --test`, which is one higher). Update both, from a measured run.
- Source files here carry long comments explaining *why*. Match that register.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/traitChoices.js` | pure: argv, output validation, cache key | create |
| `server.js` | the two routes, the cache, `startRegenJob`'s new options | modify |
| `public/app.js` | the Set… button and the picker dialog | modify |
| `public/index.html` | the dialog's markup | modify |
| `public/style.css` | the dialog's groups | modify |
| `test/traitChoices.test.js` | the pure module | create |
| `test/api.traitChoices.test.js` | GET route (port 5213) | create |
| `test/api.setTrait.test.js` | POST route (port 5214) | create |
| `test/ui.setTraitPicker.test.js` | grouping, checkbox label, button placement (port 5215) | create |
| `README.md` | test counts | modify |

`lib/traitChoices.js` exists for the reason `lib/traitOdds.js` does: the half that can be tested without spawning a process belongs outside `server.js`, which has no harness of its own.

---

## Task 1: `lib/traitChoices.js`

**Files:**
- Create: `lib/traitChoices.js`
- Test: `test/traitChoices.test.js` (no port — pure module)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `choicesArgs(scriptPath, manifestPath, npcId, trait) -> string[]`
  - `parseChoicesOutput(stdout) -> { trait, current, dependents, choices }` (throws on anything malformed)
  - `cacheKeyFor(stat, item, trait) -> string`

- [ ] **Step 1: Write the failing test**

Create `test/traitChoices.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const traitChoices = require('../lib/traitChoices');

const GOOD = JSON.stringify({
  trait: 'Outfit',
  current: 'a work jacket || civ',
  dependents: ['Headgear', 'Weapon', 'Gear'],
  choices: [
    { value: 'a work jacket || civ', heading: 'Outfit', allowed: true,
      current: true, conflicts: [], releases: [] },
    { value: 'a kimono || civ notac', heading: 'Outfit', allowed: true,
      current: false, conflicts: ['Headgear'], releases: ['Headgear'] },
  ],
});

test('choicesArgs builds the documented command line', () => {
  assert.deepStrictEqual(
    traitChoices.choicesArgs('/g/gen.py', '/g/m.json', 'npc-x-1', 'Outfit'),
    ['/g/gen.py', '--regen-manifest', '/g/m.json', '--regen-id', 'npc-x-1',
     '--trait-choices', 'Outfit'],
  );
});

test('choicesArgs refuses an empty trait', () => {
  assert.throws(() => traitChoices.choicesArgs('/g/gen.py', '/g/m.json', 'x', ''));
});

test('parseChoicesOutput accepts the documented shape', () => {
  const got = traitChoices.parseChoicesOutput(GOOD);
  assert.strictEqual(got.trait, 'Outfit');
  assert.strictEqual(got.choices.length, 2);
  assert.deepStrictEqual(got.choices[1].conflicts, ['Headgear']);
});

test('parseChoicesOutput rejects a truncated body', () => {
  assert.throws(() => traitChoices.parseChoicesOutput(GOOD.slice(0, 40)));
});

test('parseChoicesOutput rejects a body that is not the right shape', () => {
  assert.throws(() => traitChoices.parseChoicesOutput('{"trait":"Outfit"}'));
});

test('parseChoicesOutput rejects a choice missing a key', () => {
  const bad = JSON.stringify({
    trait: 'Outfit', current: 'x', dependents: [],
    choices: [{ value: 'x', heading: 'Outfit', allowed: true }],
  });
  assert.throws(() => traitChoices.parseChoicesOutput(bad));
});

test('cacheKeyFor changes with the tables file', () => {
  const item = { id: 'npc-x-1', rawTraits: { Outfit: 'a || civ' } };
  const a = traitChoices.cacheKeyFor({ mtimeMs: 1, size: 2 }, item, 'Outfit');
  const b = traitChoices.cacheKeyFor({ mtimeMs: 9, size: 2 }, item, 'Outfit');
  assert.notStrictEqual(a, b);
});

test('cacheKeyFor changes when the NPC re-rolls', () => {
  // A regen rewrites the entry's bullets without touching the tables file, so
  // a key over the file alone would serve the previous NPC's legal values.
  const stat = { mtimeMs: 1, size: 2 };
  const before = { id: 'npc-x-1', rawTraits: { Outfit: 'a || civ' } };
  const after = { id: 'npc-x-1', rawTraits: { Outfit: 'b || mil' } };
  assert.notStrictEqual(
    traitChoices.cacheKeyFor(stat, before, 'Outfit'),
    traitChoices.cacheKeyFor(stat, after, 'Outfit'),
  );
});

test('cacheKeyFor changes with the trait', () => {
  const stat = { mtimeMs: 1, size: 2 };
  const item = { id: 'npc-x-1', rawTraits: { Outfit: 'a || civ' } };
  assert.notStrictEqual(
    traitChoices.cacheKeyFor(stat, item, 'Outfit'),
    traitChoices.cacheKeyFor(stat, item, 'Hair'),
  );
});

test('cacheKeyFor is stable for the same inputs', () => {
  const stat = { mtimeMs: 1, size: 2 };
  const item = { id: 'npc-x-1', rawTraits: { Outfit: 'a || civ', Hair: 'b' } };
  assert.strictEqual(
    traitChoices.cacheKeyFor(stat, item, 'Outfit'),
    traitChoices.cacheKeyFor(stat, { ...item, rawTraits: { Hair: 'b', Outfit: 'a || civ' } }, 'Outfit'),
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/traitChoices.test.js`
Expected: FAIL — `Cannot find module '../lib/traitChoices'`.

- [ ] **Step 3: Write the module**

Create `lib/traitChoices.js`:

```js
/**
 * The pure half of "which values could this trait take on this NPC".
 *
 * The legality is not computed here, and deliberately so - the same argument
 * lib/traitOdds.js makes for the odds, one question over. Working it out in
 * JavaScript would mean reimplementing generate-npc.py's filter chain, and the
 * two would drift silently: nothing would break, the list would simply stop
 * being true, which is the worst failure available for a control whose entire
 * job is to tell the user what is possible.
 *
 * `generate-npc.py --trait-choices` runs the roller's own filters and prints
 * the answer as JSON. This module builds the command line, validates what
 * comes back, and keys the cache. The route hands the result to the client;
 * the client only renders it.
 *
 * See docs/superpowers/specs/2026-09-06-set-trait-value-picker-design.md.
 */

const crypto = require('crypto');

/** The argv for one query. Separate so a test can assert on it without spawning. */
function choicesArgs(scriptPath, manifestPath, npcId, trait) {
    if (!trait || typeof trait !== 'string') {
        throw new Error(`trait must be a non-empty string, got ${JSON.stringify(trait)}`);
    }
    if (!npcId || typeof npcId !== 'string') {
        throw new Error(`npcId must be a non-empty string, got ${JSON.stringify(npcId)}`);
    }
    return [scriptPath, '--regen-manifest', manifestPath,
            '--regen-id', npcId, '--trait-choices', trait];
}

const CHOICE_KEYS = ['value', 'heading', 'allowed', 'current', 'conflicts', 'releases'];

/**
 * The generator's stdout, checked into the shape the client is written against.
 *
 * Validated rather than trusted because a half-written stdout parses as
 * nothing and a *changed* generator parses as something subtly wrong - a
 * choice list missing `releases` would render a checkbox that promises to
 * re-roll an empty set. Better a visible error than a dialog that lies.
 */
function parseChoicesOutput(stdout) {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    } catch (err) {
        throw new Error(`--trait-choices did not print JSON: ${err.message}`);
    }
    if (!parsed || typeof parsed.trait !== 'string' || !Array.isArray(parsed.choices)
        || !Array.isArray(parsed.dependents)) {
        throw new Error('--trait-choices printed JSON of an unexpected shape');
    }
    for (const choice of parsed.choices) {
        for (const key of CHOICE_KEYS) {
            if (!(key in choice)) {
                throw new Error(`--trait-choices choice is missing "${key}"`);
            }
        }
    }
    return parsed;
}

/**
 * A cache key for one state of the tables file AND one state of the NPC.
 *
 * lib/traitOdds.js keys on the tables file alone, which is right for it: every
 * input to the odds lives in that file. This answer has a second input. A
 * regen rewrites the entry's raw bullets without touching the tables, so a key
 * over the file alone would hand back the legal values of the NPC as it was
 * before the last re-roll - stale in exactly the situation the picker is most
 * likely to be opened in.
 *
 * The bullets are hashed rather than concatenated because rawTraits is two
 * dozen sentences, and sorted first so that a re-serialised entry with the
 * same content keys the same.
 */
function cacheKeyFor(stat, item, trait) {
    const raw = item.rawTraits || {};
    const canonical = Object.keys(raw).sort().map((k) => `${k}=${raw[k]}`).join('\n');
    const fingerprint = crypto.createHash('sha1').update(canonical).digest('hex').slice(0, 16);
    return `${stat.mtimeMs}:${stat.size}:${item.id}:${trait}:${fingerprint}`;
}

module.exports = { choicesArgs, parseChoicesOutput, cacheKeyFor };
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/traitChoices.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/traitChoices.js test/traitChoices.test.js
git commit -m "feat: the pure half of asking what a trait could be"
```

---

## Task 2: `GET /api/trait-choices`

**Files:**
- Modify: `server.js` — a `readTraitChoices()` beside `readTraitOdds()` (~line 1300), and the route beside `/api/trait-options` (~line 1776)
- Test: `test/api.traitChoices.test.js` (create, **port 5213** — re-run the port grep first)

**Interfaces:**
- Consumes: `lib/traitChoices.js` (Task 1); existing `rerollableFor()`, `hasRawTraits()`, `findItem()`, `sendJson()`.
- Produces: `GET /api/trait-choices?id=&trait=` → `200 {trait, current, dependents, choices}` or `4xx {error}`. Task 3 reuses `readTraitChoices()` for validation; Task 4 renders the payload.

- [ ] **Step 1: Write the failing test**

Create `test/api.traitChoices.test.js`. The generator is stubbed as a Node
script via `generatorSource`, so this needs no Python:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5213;

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '',
    '## Outfit',
    '- a padded work jacket || civ',
    '- a kimono || civ notac',
    '',
].join('\n');

const PAYLOAD = {
    trait: 'Outfit',
    current: 'a padded work jacket || civ',
    dependents: ['Headgear', 'Weapon', 'Gear'],
    choices: [
        { value: 'a padded work jacket || civ', heading: 'Outfit',
          allowed: true, current: true, conflicts: [], releases: [] },
        { value: 'a kimono || civ notac', heading: 'Outfit',
          allowed: true, current: false,
          conflicts: ['Headgear'], releases: ['Headgear'] },
    ],
};

// Prints the payload, and appends a line to a counter file so the test can
// tell a cache hit from a second spawn. The path comes from an env var the
// server passes straight through.
const STUB = `
const fs = require('fs');
fs.appendFileSync(process.env.CHOICES_SPAWN_LOG, 'x');
process.stdout.write(${JSON.stringify(JSON.stringify(PAYLOAD))});
`;

const ENTRY = {
    id: 'npc-test-1', kind: 'npc', name: 'Test Subject', seed: 1,
    traits: { Pronouns: 'she/her/her/woman', Outfit: 'a padded work jacket' },
    rawTraits: { Outfit: 'a padded work jacket || civ' },
};

async function server(t, { entry = ENTRY, spawnLog } = {}) {
    const s = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
        manifest: { 'npcs/Test Subject': entry },
        extraConfig: {},
    });
    t.after(() => s.stop());
    return s;
}

// NOTE: the stub needs CHOICES_SPAWN_LOG in its environment. If
// startTestServer does not forward extra env, add the counter path to
// extraConfig and have the stub read it from its own argv instead - assert on
// spawn count however the harness makes easiest, but DO assert on it.

test('an unknown id is refused', async (t) => {
    const s = await server(t);
    const res = await fetch(`${s.baseUrl}/api/trait-choices?id=nope&trait=Outfit`);
    assert.equal(res.status, 404);
});

test('a missing trait is refused', async (t) => {
    const s = await server(t);
    const res = await fetch(`${s.baseUrl}/api/trait-choices?id=npc-test-1`);
    assert.equal(res.status, 400);
});

test('an entry with no raw bullets is refused, and says why', async (t) => {
    const s = await server(t, { entry: { ...ENTRY, rawTraits: {} } });
    const res = await fetch(`${s.baseUrl}/api/trait-choices?id=npc-test-1&trait=Outfit`);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /re-roll/i);
});

test('a non-npc kind is refused', async (t) => {
    const s = await server(t, { entry: { ...ENTRY, kind: 'mech' } });
    const res = await fetch(`${s.baseUrl}/api/trait-choices?id=npc-test-1&trait=Outfit`);
    assert.equal(res.status, 400);
});

test('a good request returns the choices with every documented key', async (t) => {
    const s = await server(t);
    const res = await fetch(`${s.baseUrl}/api/trait-choices?id=npc-test-1&trait=Outfit`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.trait, 'Outfit');
    assert.equal(body.choices.length, 2);
    for (const c of body.choices) {
        assert.deepEqual(
            Object.keys(c).sort(),
            ['allowed', 'conflicts', 'current', 'heading', 'releases', 'value']);
    }
});

test('the flags stay on the value', async (t) => {
    // The value is what gets posted back and pasted into a prompt verbatim,
    // so stripping '|| civ notac' anywhere on this path is a real bug.
    const s = await server(t);
    const res = await fetch(`${s.baseUrl}/api/trait-choices?id=npc-test-1&trait=Outfit`);
    const body = await res.json();
    assert.ok(body.choices.some((c) => c.value.includes('|| civ notac')));
});

test('a repeated request is served from cache', async (t) => {
    const s = await server(t);
    const url = `${s.baseUrl}/api/trait-choices?id=npc-test-1&trait=Outfit`;
    await (await fetch(url)).json();
    const spawnsAfterFirst = fs.readFileSync(process.env.CHOICES_SPAWN_LOG, 'utf8').length;
    await (await fetch(url)).json();
    assert.equal(
        fs.readFileSync(process.env.CHOICES_SPAWN_LOG, 'utf8').length,
        spawnsAfterFirst,
        'the second request should not spawn the generator again');
});
```

If `startTestServer` does not forward arbitrary env to the generator child,
adjust the spawn counter to whatever it does support — but keep the cache
assertion. It is the only test that can catch a cache key that never matches,
which is a bug with no symptom other than slowness.

- [ ] **Step 2: Run and watch it fail**

Run: `node --test test/api.traitChoices.test.js`
Expected: FAIL — the route 404s.

- [ ] **Step 3: Add the cache and runner**

In `server.js`, after `runTraitOdds()`:

```js
const traitChoices = require('./lib/traitChoices');   // beside the other lib requires at the top

// Keyed by the same string cacheKeyFor() builds, so one map serves every NPC
// and every trait. Bounded because a user clicking through a detail sheet can
// fill it with a few dozen entries in a minute and none of them is large.
const CHOICES_CACHE_LIMIT = 64;
const choicesCache = new Map();

function readTraitChoices(item, trait) {
    let key;
    try {
        key = traitChoices.cacheKeyFor(fs.statSync(NPC_TABLES_PATH), item, trait);
    } catch (err) {
        return Promise.resolve({ ok: false, reason: `cannot read ${NPC_TABLES_PATH}: ${err.message}` });
    }
    if (choicesCache.has(key)) return choicesCache.get(key);

    const promise = runTraitChoices(item, trait).then((result) => {
        // Same reasoning as the odds cache: a failure is usually something the
        // user can fix without touching the tables file, and caching it would
        // survive the fix.
        if (!result.ok) choicesCache.delete(key);
        return result;
    });
    choicesCache.set(key, promise);
    while (choicesCache.size > CHOICES_CACHE_LIMIT) {
        choicesCache.delete(choicesCache.keys().next().value);
    }
    return promise;
}
```

`runTraitChoices(item, trait)` is `runTraitOdds()` with
`traitChoices.choicesArgs(GENERATE_NPC_SCRIPT, config.npcManifestPath, item.id, trait)`
for its argv and `traitChoices.parseChoicesOutput` for its output. Copy the
structure — the spawn guard, the stderr slice, the `close` handler — rather than
abstracting the two into one function; they differ in argv, parser and error
wording, and the shared remainder is short.

**It resolves `{ ok: true, data: <the parsed object> }` on success and
`{ ok: false, reason: <string> }` on failure.** `runTraitOdds()` spreads its
result (`{ ok, samples, tables }`); this one nests under `data` instead,
because the payload's keys come from the generator and a spread would let a
future key called `ok` or `reason` collide with the envelope. Task 3 reads
`query.data.choices`, so this shape is load-bearing across tasks.

- [ ] **Step 4: Add the route**

Beside `/api/trait-options` in the request handler:

```js
    if (url.pathname === '/api/trait-choices' && req.method === 'GET') {
        const item = url.searchParams.get('id') && findItem(url.searchParams.get('id'));
        if (!item) return sendJson(res, 404, { error: 'unknown item' });
        if (item.kind !== 'npc') {
            return sendJson(res, 400, { error: `choosing a trait value isn't supported for kind "${item.kind}"` });
        }
        const trait = url.searchParams.get('trait') || '';
        if (!trait) return sendJson(res, 400, { error: 'trait is required' });
        // The same two gates the Set... button is drawn behind, so a button
        // that exists is a button that works. See the matching comment on
        // /api/reroll-trait: the offer and the refusal have to agree.
        if (!hasRawTraits(item)) {
            return sendJson(res, 400, {
                error: 'this NPC recorded no raw bullets, so there is nothing to '
                    + 'pin the rest of it to. Re-roll the NPC to record them.',
            });
        }
        const allowed = rerollableFor(item);
        if (allowed.length && !allowed.includes(trait)) {
            return sendJson(res, 400, {
                error: `"${trait}" cannot be chosen on its own. Choosable: ${allowed.join(', ')}`,
            });
        }
        const result = await readTraitChoices(item, trait);
        return sendJson(res, result.ok ? 200 : 502, result.ok ? result.data : { error: result.reason });
    }
```

- [ ] **Step 5: Run the tests, then the suite**

Run: `node --test test/api.traitChoices.test.js`
Then: `node --test "test/*.test.js"`
Expected: PASS, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add server.js lib/traitChoices.js test/api.traitChoices.test.js
git commit -m "feat: serve the values one trait could take on one NPC"
```

---

## Task 3: `POST /api/set-trait`

**Files:**
- Modify: `server.js` — `startRegenJob()` (~line 689) and a route beside `/api/reroll-trait` (~line 1734)
- Test: `test/api.setTrait.test.js` (create, **port 5214**)

**Interfaces:**
- Consumes: `readTraitChoices()` (Task 2), `startRegenJob()` (existing).
- Produces: `POST /api/set-trait {id, table, value, release}` → `202 {ok, seed}` / `4xx {error}`. `startRegenJob(item, {..., setTrait: {table, value}, release: []})`. Task 4 calls it.

- [ ] **Step 1: Write the failing test**

Create `test/api.setTrait.test.js`. The stub has to serve two jobs — answer
`--trait-choices` for the route's validation, and echo its argv for the regen —
so it branches on which flag it was given:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5214;

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '',
    '## Outfit',
    '- a padded work jacket || civ',
    '- a kimono || civ notac',
    '',
].join('\n');

const PAYLOAD = {
    trait: 'Outfit',
    current: 'a padded work jacket || civ',
    dependents: ['Headgear', 'Weapon', 'Gear'],
    choices: [
        { value: 'a padded work jacket || civ', heading: 'Outfit',
          allowed: true, current: true, conflicts: [], releases: [] },
        { value: 'a kimono || civ notac', heading: 'Outfit',
          allowed: true, current: false,
          conflicts: ['Headgear'], releases: ['Headgear'] },
    ],
};

// Two jobs in one stub: answer the validation query, and echo argv for the
// regen so the test can assert on the command line the server built.
const STUB = `
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'argv.log'), argv.join(' ') + '\\n');
if (argv.includes('--trait-choices')) {
  process.stdout.write(${JSON.stringify(JSON.stringify(PAYLOAD))});
}
`;

const ENTRY = {
    id: 'npc-test-1', kind: 'npc', name: 'Test Subject', seed: 1,
    traits: { Pronouns: 'she/her/her/woman', Outfit: 'a padded work jacket' },
    rawTraits: { Outfit: 'a padded work jacket || civ' },
    folderPath: 'npcs/Test Subject',
};

async function server(t, entry = ENTRY) {
    const s = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
        manifest: { 'npcs/Test Subject': entry },
    });
    t.after(() => s.stop());
    return s;
}

function post(s, body) {
    return fetch(`${s.baseUrl}/api/set-trait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

/**
 * The argv the server handed the generator.
 *
 * There is no /api/regen-status: a regen job's status rides on the item view
 * as `regenStatus`, and its LOG is never exposed at all (unlike a create job,
 * which api.createArgs.test.js reads through /api/create-status). So the stub
 * writes its own argv beside itself in the fixture directory, which
 * startTestServer hands back as `dir`, and the test reads that.
 */
async function regenArgv(s) {
    const logPath = require('node:path').join(s.dir, 'argv.log');
    for (let i = 0; i < 50; i++) {
        if (fs.existsSync(logPath)) {
            const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
            const regen = lines.filter((l) => !l.includes('--trait-choices'));
            if (regen.length) return regen[regen.length - 1];
        }
        await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error('the generator was never spawned for a regen');
}

test('an unknown id is refused', async (t) => {
    const s = await server(t);
    assert.equal((await post(s, { id: 'nope', table: 'Outfit', value: 'x' })).status, 404);
});

test('an entry with no raw bullets is refused', async (t) => {
    const s = await server(t, { ...ENTRY, rawTraits: {} });
    const res = await post(s, { id: 'npc-test-1', table: 'Outfit', value: 'a kimono || civ notac' });
    assert.equal(res.status, 400);
});

test('a value the generator did not offer is refused', async (t) => {
    // --set-trait pastes its bullet into a prompt verbatim, so an arbitrary
    // string arriving here would be rendered.
    const s = await server(t);
    const res = await post(s, {
        id: 'npc-test-1', table: 'Outfit', value: 'a jetpack made of bees',
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /not a value/i);
});

test('releasing a trait the value does not conflict with is refused', async (t) => {
    const s = await server(t);
    const res = await post(s, {
        id: 'npc-test-1', table: 'Outfit', value: 'a kimono || civ notac',
        release: ['Backdrop'],
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Backdrop/);
});

test('a good request passes the bullet through with its flags intact', async (t) => {
    const s = await server(t);
    const res = await post(s, {
        id: 'npc-test-1', table: 'Outfit', value: 'a kimono || civ notac',
    });
    assert.equal(res.status, 202);
    const argv = await regenArgv(s);
    assert.match(argv, /--set-trait Outfit=a kimono \|\| civ notac/);
    assert.doesNotMatch(argv, /--reroll-trait/);
});

test('ticking the box sends --release', async (t) => {
    const s = await server(t);
    await post(s, {
        id: 'npc-test-1', table: 'Outfit', value: 'a kimono || civ notac',
        release: ['Headgear'],
    });
    assert.match(await regenArgv(s), /--release Headgear/);
});

test('leaving the box unticked sends no --release', async (t) => {
    const s = await server(t);
    await post(s, {
        id: 'npc-test-1', table: 'Outfit', value: 'a kimono || civ notac',
    });
    assert.doesNotMatch(await regenArgv(s), /--release/);
});
```

**Verified while planning:** there is no `/api/regen-status`. A regen job's
status rides on the item view as `regenStatus`, and its log is never exposed
(unlike a create job's), so the stub records its own argv to a file in the
fixture directory and the test reads that.

- [ ] **Step 2: Run and watch it fail**

Run: `node --test test/api.setTrait.test.js`
Expected: FAIL — the route 404s.

- [ ] **Step 3: Teach `startRegenJob` the two new options**

In `startRegenJob(item, { which, seedMode, seed, rerollTrait })`, extend the destructure to `{ which, seedMode, seed, rerollTrait, setTrait, release }` and add after the `rerollTrait` line (~716):

```js
    // The pinned counterpart of --reroll-trait: that flag draws a new value,
    // this one names it. Mutually exclusive at the generator too, so the
    // routes must never send both.
    if (setTrait) args.push('--set-trait', `${setTrait.table}=${setTrait.value}`);
    // Only the traits the user ticked. The generator expands each to its whole
    // cascade, so this list is shorter than what actually moves - which is why
    // the finished-regen report names every trait rather than counting them.
    if (release && release.length) args.push('--release', release.join(','));
```

Record them on the job alongside `rerollTrait`, so a poll can report what was asked for:

```js
        setTrait: setTrait || null, release: release || [],
```

- [ ] **Step 4: Add the route**

```js
    if (url.pathname === '/api/set-trait' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const item = body.id && findItem(body.id);
        if (!item) return sendJson(res, 404, { error: 'unknown item' });
        if (item.kind !== 'npc') {
            return sendJson(res, 400, { error: `setting a trait isn't supported for kind "${item.kind}"` });
        }
        if (!hasRawTraits(item)) {
            return sendJson(res, 400, {
                error: 'this NPC recorded no raw bullets, so there is nothing to '
                    + 'pin the rest of it to. Re-roll the NPC to record them.',
            });
        }
        const table = typeof body.table === 'string' ? body.table : '';
        const value = typeof body.value === 'string' ? body.value : '';
        if (!table || !value) return sendJson(res, 400, { error: 'table and value are required' });

        const allowed = rerollableFor(item);
        if (allowed.length && !allowed.includes(table)) {
            return sendJson(res, 400, {
                error: `"${table}" cannot be set on its own. Settable: ${allowed.join(', ')}`,
            });
        }

        // Re-checked against the generator rather than trusted, because
        // --set-trait takes its bullet VERBATIM and pastes it into a prompt:
        // an arbitrary string arriving here would be rendered. The client's
        // list can also simply be stale, which a long-open detail sheet makes
        // easy. Goes through the same cache the GET route filled, so the
        // ordinary open-choose-submit path spawns the generator once.
        const query = await readTraitChoices(item, table);
        if (!query.ok) return sendJson(res, 502, { error: query.reason });
        const choice = query.data.choices.find((c) => c.value === value);
        if (!choice) {
            return sendJson(res, 400, {
                error: `"${value}" is not a value the ${table} table offers; the `
                    + 'tables file may have changed since this list was loaded.',
            });
        }

        // The checkbox offers exactly this value's conflicts, so anything else
        // is a client that has drifted - and releasing an unrelated trait is a
        // re-roll wearing a disguise, which the generator refuses too.
        const release = Array.isArray(body.release) ? body.release : [];
        const stray = release.filter((r) => !choice.conflicts.includes(r));
        if (stray.length) {
            return sendJson(res, 400, {
                error: `cannot release ${stray.join(', ')}: not in conflict with this value`,
            });
        }

        // Fresh seed, same as the re-roll route: pinning a value and getting a
        // byte-identical image back is not what the button promises.
        const result = startRegenJob(item, {
            which: 'both', seedMode: 'random', setTrait: { table, value }, release,
        });
        return sendJson(res, result.ok ? 202 : 409, result);
    }
```

- [ ] **Step 5: Run the tests, then the suite**

Run: `node --test test/api.setTrait.test.js`
Then: `node --test "test/*.test.js"`
Expected: PASS, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add server.js test/api.setTrait.test.js
git commit -m "feat: regenerate an NPC from a trait value the user picked"
```

---

## Task 4: The picker

**Files:**
- Modify: `public/index.html` (dialog markup), `public/style.css` (groups), `public/app.js` (`rerollControlHtml` ~673, the detail-sheet wiring ~791, and the new dialog)
- Test: `test/ui.setTraitPicker.test.js` (create; check whether the other `ui.*` tests bind a port before allocating one)

**Interfaces:**
- Consumes: `GET /api/trait-choices`, `POST /api/set-trait`, existing `traitOptions.readableLabel` (expose it to the client the way the Create form already does).
- Produces: two **pure, top-level** functions in `public/app.js`, plus DOM wiring:
  - `groupChoices(choices) -> [{ key, heading, rows }]` — `key` is `'clean' | 'conflicting' | 'ruledOut'`; empty groups are omitted.
  - `releaseLabel(choice) -> string | null` — the checkbox text, or `null` when no checkbox should appear.

**This repo has no DOM harness and no dependencies** — `test/ui.rerollConfirm.test.js` tests UI decisions by lifting top-level functions out of the served `app.js` source and calling them. So the picker's two real decisions must be pure functions at the top level of `app.js`, not logic buried in a render callback. Read `test/ui.rerollConfirm.test.js` first and reuse its lifting helper verbatim.

- [ ] **Step 1: Write the failing test**

Create `test/ui.setTraitPicker.test.js` (port: whichever the lifting helper needs — `ui.rerollConfirm` uses 5211, so take **5215** and re-run the port grep):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// Two decisions sit behind the picker and this file pins both.
//
// How a value is grouped, because the generator reports two independent kinds
// of "not legal" and only one of them has a remedy in the dialog: a value the
// roller would not have offered can only be overridden, while a value that
// would leave a kept trait contradicting can offer to re-roll it. Collapsing
// them into one grey list would put a checkbox on rows it cannot help.
//
// What the checkbox promises, because releasing a trait re-rolls its whole
// cascade - freeing Outfit while Headgear, Weapon and Gear stay pinned to
// bullets chosen for the old outfit recreates the contradiction one level
// down. The generator reports `releases` for exactly this, and a label that
// named only the conflicts would undercount what moves.
//
// Same lifting approach as ui.rerollConfirm.test.js: there is no DOM harness
// here, so the decisions are pure functions in app.js and are called directly.
const PORT = 5215;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

const CLEAN = { value: 'a work jacket || civ', heading: 'Outfit',
                allowed: true, current: true, conflicts: [], releases: [] };
const CONFLICTING = { value: 'a kimono || civ notac', heading: 'Outfit',
                      allowed: true, current: false,
                      conflicts: ['Headgear'], releases: ['Headgear'] };
const CASCADING = { value: 'a robe || civ dressy', heading: 'Outfit',
                    allowed: true, current: false, conflicts: ['Outfit'],
                    releases: ['Outfit', 'Headgear', 'Weapon', 'Gear'] };
const RULED_OUT = { value: 'a flight suit || mil', heading: 'Outfit',
                    allowed: false, current: false,
                    conflicts: [], releases: [] };

// Reuse ui.rerollConfirm.test.js's helper for this; see the note above.
async function lift(server, fnName) { /* copy from ui.rerollConfirm.test.js */ }

test('the three groups are separated and empty ones are dropped', async (t) => {
    const s = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => s.stop());
    const groupChoices = await lift(s, 'groupChoices');

    const groups = groupChoices([CLEAN, CONFLICTING, RULED_OUT]);
    assert.deepEqual(groups.map((g) => g.key),
                     ['clean', 'conflicting', 'ruledOut']);
    assert.deepEqual(groups[0].rows, [CLEAN]);
    assert.deepEqual(groups[1].rows, [CONFLICTING]);
    assert.deepEqual(groups[2].rows, [RULED_OUT]);

    assert.deepEqual(groupChoices([CLEAN]).map((g) => g.key), ['clean']);
});

test('a ruled-out value is never also counted as conflicting', async (t) => {
    const s = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => s.stop());
    const groupChoices = await lift(s, 'groupChoices');

    const both = { ...RULED_OUT, conflicts: ['Headgear'], releases: ['Headgear'] };
    const groups = groupChoices([both]);
    assert.deepEqual(groups.map((g) => g.key), ['ruledOut']);
});

test('the checkbox appears only where it can help', async (t) => {
    const s = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => s.stop());
    const releaseLabel = await lift(s, 'releaseLabel');

    assert.equal(releaseLabel(CLEAN), null, 'nothing to release');
    assert.equal(releaseLabel(RULED_OUT), null, 'overriding a gate releases nothing');
    assert.match(releaseLabel(CONFLICTING), /Headgear/);
});

test('the label says when more moves than the conflict named', async (t) => {
    const s = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => s.stop());
    const releaseLabel = await lift(s, 'releaseLabel');

    // releases is 4 long, conflicts is 1 - the label must not imply that
    // ticking the box moves one trait.
    const label = releaseLabel(CASCADING);
    assert.match(label, /Outfit/);
    assert.match(label, /3/, 'the three cascaded traits are accounted for');
});
```

Add, in the same file, a source-level assertion for the button placement —
`ui.rerollConfirm.test.js` fetches `app.js` as text, so this can be a regex over
it:

```js
test('Set... rides with Re-roll and never appears disabled', async (t) => {
    const s = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => s.stop());
    const src = await (await fetch(`${s.baseUrl}/app.js`)).text();
    // Where Re-roll is the explained-but-disabled variant, the explanation
    // already covers both, so a second disabled button would say it twice.
    assert.doesNotMatch(src, /set-trait-btn[^>]*disabled/);
    assert.match(src, /set-trait-btn/);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test test/ui.setTraitPicker.test.js`
Expected: FAIL.

- [ ] **Step 3: Add the dialog markup**

In `public/index.html`, beside `reroll-confirm-overlay`, add a `set-trait-overlay` with: a title (`Set <trait>`), a filter `<input type="search">`, a scrolling `<div id="set-trait-list">`, a `<label>` holding `#set-trait-release` (a checkbox) and its text, and Cancel / **Set and regen** buttons. Reuse the existing overlay's classes so focus trapping and Escape handling come along.

- [ ] **Step 4: Draw the button**

In `public/app.js`, `rerollControlHtml(trait, rerollable)` (~673) currently returns one of three things. Add the Set… button to the *offered* branch only:

```js
    if (rerollable.includes(trait)) {
        return `<button type="button" class="reroll-btn" data-trait="${name}"
                >Re-roll</button>`
            // Only where Re-roll is offered. Where Re-roll is the
            // explained-but-disabled variant, the explanation already covers
            // both, and a second disabled button would say the same thing
            // twice.
            + `<button type="button" class="set-trait-btn" data-trait="${name}"
                >Set&hellip;</button>`;
    }
```

Wire it next to the existing re-roll wiring (~791), guarding on `hasRawTraits(item)` exactly as the route does.

- [ ] **Step 5: Render the groups**

The dialog opens immediately with a spinner, fetches `/api/trait-choices?id=&trait=`, then renders what `groupChoices()` returns. That function is the one written against the tests in Step 1 — the render callback calls it and must contain no grouping logic of its own, or the tests are pinning a copy of the rules rather than the rules:

| `key` | Predicate | Heading |
|---|---|---|
| `clean` | `allowed && !conflicts.length` | none (first, unheaded) |
| `conflicting` | `allowed && conflicts.length` | `Would leave other traits contradicting` |
| `ruledOut` | `!allowed` | `Ruled out by this NPC's other traits` |

`!allowed` wins over conflicts, so a value that is both lands in `ruledOut` only — its checkbox could not help it anyway.

A failed query replaces the list with the generator's own error text, the way the odds display already surfaces one, and leaves **Set and regen** disabled. Do not fall back to an unfiltered list of every bullet: a picker that silently stops filtering is the exact failure this whole design is built to avoid, and it would look identical to a working one.

Each row is a `<label>` wrapping a radio, the `readableLabel(value)` text, and — for the two grey groups — a note. The conflicting note names each trait and its current value, read from the item's own traits: `Headgear would clash — currently "a hard-tech visor"`. The ruled-out note says only that the roller would not have offered it; **do not** invent a cause, because the generator reports pool membership, not which filter emptied it.

The checkbox label: with `conflicts` of three or fewer, name them (`also re-roll Headgear`); above three, count them. When `releases.length > conflicts.length`, append ` (and N traits that depend on it)`.

The filter box narrows rows by case-insensitive substring on the rendered label, keeping group headings that still have visible rows.

- [ ] **Step 6: Submit**

**Set and regen** POSTs `{id, table, value, release}` — `release` is `choice.conflicts` when the box is ticked, `[]` otherwise — then closes the dialog and lets the existing regen banner and poll take over. It stays enabled for a grey selection: the user was told the cost, and refusing the click after saying the row was selectable would be a dialog arguing with itself.

- [ ] **Step 7: Run the tests, then the suite**

Run: `node --test test/ui.setTraitPicker.test.js`
Then: `node --test "test/*.test.js"`
Expected: PASS, `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add public/app.js public/index.html public/style.css test/ui.setTraitPicker.test.js
git commit -m "feat: a Set... button beside every trait's Re-roll"
```

---

## Task 5: Documentation and counts

**Files:**
- Modify: `README.md`, `docs/foundry-importer-contract.md` (only if it enumerates routes)

- [ ] **Step 1: Measure both counts**

Run: `node --test "test/*.test.js" 2>&1 | grep -E "^# (pass|fail)"`
Then: `node --test 2>&1 | grep -E "^# (pass|fail)"`
The second is one higher (it picks up `test/helpers/testServer.js`).

- [ ] **Step 2: Update `README.md`**

Replace both counts with the measured numbers. Add the two new ports to the "Ports … are taken" line. Add `/api/trait-choices` and `/api/set-trait` wherever routes are listed, and mention that the picker needs a generator with `--trait-choices`.

- [ ] **Step 3: Verify**

Run: `grep -rhoE "(port: |PORT = )5[0-9]+" test/*.test.js | sort -u`
Confirm no duplicates and that the README's taken-ports line matches.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/foundry-importer-contract.md
git commit -m "docs: re-derive the test counts and note the trait picker's routes"
```

---

## Done when

- `node --test "test/*.test.js"` passes with `fail 0`.
- Opening an NPC's detail sheet shows **Set…** beside every **Re-roll**.
- Picking a value regenerates the NPC with that value and nothing else changed.
- Picking a conflicting value without ticking the box leaves the conflicting traits alone; ticking it re-rolls them and the finished-regen report names every trait that moved.
