# Tables Page, Create Form and Keyboard Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Tables page stop moving under the cursor and stop offering the generator's own documentation as editable roll entries, give the NPC browser keyboard navigation, and repair a trait list that has silently drifted out of sync with the generator.

**Architecture:** Server-side changes go in `server.js` and `lib/`; client-side in `public/app.js`, `public/index.html` and `public/style.css`. Two pieces of logic that would otherwise be untestable DOM code are extracted as pure functions into `lib/` so the existing `node:test` suite can cover them.

**Tech Stack:** Node 20+, standard library only — no `package.json`, no dependencies. Tests are `node:test` + `node:assert/strict`, run with `node --test "test/*.test.js"` from the repo root. Server tests spin up a real `server.js` child process via `test/helpers/testServer.js`.

**Spec:** `docs/superpowers/specs/2026-09-03-tables-page-and-create-form-design.md`

## Global Constraints

- **This plan runs after** `lancer-art-generator`'s `docs/superpowers/plans/2026-09-03-token-fidelity-weapon-policy-and-trait-naming.md`. Two tasks below fail without it: Task 1 needs `REQUIRED_TABLES` to name `Glow colour`, and Task 7 needs `--unarmed` to exist.
- **Run tests with the glob:** `node --test "test/*.test.js"`. A bare `node --test test/` does not pick this suite up and reports a single spurious failure.
- **Test baseline:** 61 tests, all passing.
- **No dependencies.** This repo is Node stdlib only and has no `package.json`. Do not add one.
- **Every server test needs a unique port.** `node --test` runs files concurrently and `startTestServer` binds a fixed port. In use: 5196 (`importerContract`), 5197 (`helpers.testServer`), 5198 (`api.presets`), 5199 (`api.tableBullets`). New files below use 5195, 5194 and 5193.
- **Indentation is 4 spaces in `server.js` and `lib/`, 2 spaces in `public/`.** Match the file you are editing.
- **Never write to the real tables file from a test.** `startTestServer` builds a synthetic fixture directory; use it.

---

### Task 1: Derive the trait-override list from the generator

Runs first because it is the change the art-generator plan forces, and because the derived list is what Task 5's grouping is checked against.

**Files:**
- Create: `lib/overrideTables.js`
- Create: `test/overrideTables.test.js`
- Modify: `server.js:471` (`OVERRIDE_TABLES`), the `/api/npc-tables` route at `:831`

**Interfaces:**
- Consumes: `generate-npc.py`'s `REQUIRED_TABLES`, read from the configured generator script path.
- Produces: `lib/overrideTables.js` exporting `parseRequiredTables(pythonSource: string) -> string[]` and `overrideTablesFrom(pythonSource: string) -> string[]`. Task 5 imports neither; it only needs the names.

- [ ] **Step 1: Write the failing test**

Create `test/overrideTables.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRequiredTables, overrideTablesFrom } = require('../lib/overrideTables');

// A verbatim excerpt of generate-npc.py's REQUIRED_TABLES, wrapped in enough
// surrounding source that the parser has to actually find it rather than
// matching the whole file.
const SOURCE = [
    'TOKEN_LIMIT = 512',
    '',
    'REQUIRED_TABLES = [',
    '    "Given names", "Family names", "Callsigns", "Pronouns", "Theme", "Age",',
    '    "Build", "Height", "Skin", "Hair", "Hair colour", "Eyes", "Feature",',
    '    "Demeanor", "Role",',
    '    "Faction", "Outfit", "Headgear", "Weapon", "Gear", "Glow colour", "Backdrop",',
    '    "Weather", "Stance",',
    ']',
    '',
    'THEMED_TABLES = ["Outfit"]',
    '',
].join('\n');

test('parseRequiredTables reads every name out of the list', () => {
    const tables = parseRequiredTables(SOURCE);
    assert.equal(tables.length, 24);
    assert.equal(tables[0], 'Given names');
    assert.equal(tables.at(-1), 'Stance');
});

test('parseRequiredTables stops at the closing bracket, not a later list', () => {
    // THEMED_TABLES follows in the source and also contains "Outfit". A greedy
    // match would pick it up a second time.
    const tables = parseRequiredTables(SOURCE);
    assert.equal(tables.filter((name) => name === 'Outfit').length, 1);
    assert.ok(!tables.includes('THEMED_TABLES'));
});

test('overrideTablesFrom drops Pronouns, which has its own field in the GUI', () => {
    const tables = overrideTablesFrom(SOURCE);
    assert.ok(!tables.includes('Pronouns'));
    assert.equal(tables.length, 23);
});

test('overrideTablesFrom offers the tables that had drifted out of the list', () => {
    // Weapon was split out of Gear, Theme was added, and Height and Hair
    // colour were never there - all four were unreachable from the trait
    // override dropdown.
    const tables = overrideTablesFrom(SOURCE);
    for (const name of ['Weapon', 'Theme', 'Height', 'Hair colour']) {
        assert.ok(tables.includes(name), `${name} missing from the override list`);
    }
});

test('overrideTablesFrom offers Glow colour and not the old Accent name', () => {
    const tables = overrideTablesFrom(SOURCE);
    assert.ok(tables.includes('Glow colour'));
    assert.ok(!tables.includes('Accent'));
});

test('parseRequiredTables returns an empty list when the constant is absent', () => {
    // A generator too old or too new to have it must not crash the server.
    assert.deepEqual(parseRequiredTables('x = 1\n'), []);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test "test/overrideTables.test.js"`
Expected: FAIL — `Cannot find module '../lib/overrideTables'`

- [ ] **Step 3: Write the module**

Create `lib/overrideTables.js`:

```javascript
/**
 * The trait tables the GUI's override dropdown offers, derived from
 * generate-npc.py's own REQUIRED_TABLES rather than restated here.
 *
 * It used to be a hand-maintained constant in server.js, and it drifted: it
 * was missing Weapon (split out of Gear after the list was written), Theme
 * (added later, and the most useful override of the lot), Height and Hair
 * colour - and it still named Accent after that table became Glow colour.
 * Every one of those was silently unreachable from the GUI.
 *
 * Parsed with a regex rather than executed, because this is a Node process
 * reading a Python file. That is fragile in exactly one way - reformatting
 * REQUIRED_TABLES onto a different shape could break it - so the parse
 * returns an empty list rather than throwing, and the caller falls back.
 */

const REQUIRED_TABLES_RE = /^REQUIRED_TABLES\s*=\s*\[([\s\S]*?)\]/m;
const NAME_RE = /"([^"]+)"/g;

/** Every table name in generate-npc.py's REQUIRED_TABLES, in file order. */
function parseRequiredTables(pythonSource) {
    const block = pythonSource.match(REQUIRED_TABLES_RE);
    if (!block) return [];
    return [...block[1].matchAll(NAME_RE)].map((m) => m[1]);
}

/**
 * Those tables minus Pronouns, which the GUI exposes as its own form field -
 * the same split --pronouns and --set-trait have on the command line.
 */
function overrideTablesFrom(pythonSource) {
    return parseRequiredTables(pythonSource).filter((name) => name !== 'Pronouns');
}

module.exports = { parseRequiredTables, overrideTablesFrom };
```

- [ ] **Step 4: Run the test**

Run: `node --test "test/overrideTables.test.js"`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire it into the server**

In `server.js`, replace the `OVERRIDE_TABLES` constant and its comment with:

```javascript
const overrideTables = require('./lib/overrideTables');

// Derived from generate-npc.py's REQUIRED_TABLES rather than restated, because
// a restated copy drifted: Weapon, Theme, Height and Hair colour were all
// unreachable from the override dropdown, and Accent outlived its rename.
// Read once at startup - the generator does not change under a running server,
// and a per-request read would stat the script on every page load.
//
// The fallback is the list as it stood when this was derived, so a generator
// whose REQUIRED_TABLES cannot be parsed still yields a working dropdown
// rather than an empty one.
const OVERRIDE_TABLES_FALLBACK = [
    'Given names', 'Family names', 'Callsigns', 'Theme', 'Age', 'Build',
    'Height', 'Skin', 'Hair', 'Hair colour', 'Eyes', 'Feature', 'Demeanor',
    'Role', 'Faction', 'Outfit', 'Headgear', 'Weapon', 'Gear', 'Glow colour',
    'Backdrop', 'Weather', 'Stance',
];

const OVERRIDE_TABLES = (() => {
    try {
        const source = fs.readFileSync(GENERATE_NPC_SCRIPT, 'utf8');
        const derived = overrideTables.overrideTablesFrom(source);
        return derived.length ? derived : OVERRIDE_TABLES_FALLBACK;
    } catch {
        return OVERRIDE_TABLES_FALLBACK;
    }
})();
```

Leave the `/api/npc-tables` route unchanged — it already returns `OVERRIDE_TABLES`.

- [ ] **Step 6: Run the full suite**

Run: `node --test "test/*.test.js" 2>&1 | tail -8`
Expected: `pass 67`, `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add lib/overrideTables.js test/overrideTables.test.js server.js
git commit -m "fix: derive the trait-override list from the generator

The hand-maintained copy had drifted. Weapon was split out of Gear after
the list was written, Theme was added later, Height and Hair colour were
never in it, and Accent has just become Glow colour -- all five silently
unreachable from the override dropdown. Parsed from REQUIRED_TABLES with a
fallback, so an unparseable generator yields a working dropdown rather than
an empty one."
```

---

### Task 2: Populate the pronouns dropdown from the tables file

**Files:**
- Create: `lib/pronouns.js`
- Create: `test/pronouns.test.js`
- Create: `test/api.pronouns.test.js`
- Modify: `server.js` — new `/api/pronouns` route, and the `pronouns` validation in `/api/create-npc` at `:999`
- Modify: `public/index.html:72-78`, `public/app.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `lib/pronouns.js` exporting `subjectsFrom(tablesText: string) -> string[]`. New route `GET /api/pronouns` returning `{ subjects: string[] }`.

- [ ] **Step 1: Write the failing unit test**

Create `test/pronouns.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { subjectsFrom } = require('../lib/pronouns');

const TABLES = [
    '## Pronouns',
    '',
    '<!-- Subject/object/possessive/noun; the script splits on the slashes. -->',
    '',
    '- she/her/her/woman',
    '- he/him/his/man',
    '',
    '## Gear',
    '- a battered data-slate',
    '',
].join('\n');

test('subjectsFrom reads the subject field of every Pronouns bullet', () => {
    assert.deepEqual(subjectsFrom(TABLES), ['she', 'he']);
});

test('subjectsFrom does not offer they, which the generator removed', () => {
    // The generator dropped they/them/their/person deliberately - the noun
    // "person" was not a strong enough signal and renders came back
    // androgynous. The GUI kept offering it long after it stopped working.
    assert.ok(!subjectsFrom(TABLES).includes('they'));
});

test('subjectsFrom picks up a pronoun set added to the table later', () => {
    const extended = TABLES.replace('- he/him/his/man', '- he/him/his/man\n- xe/xem/xyr/person');
    assert.deepEqual(subjectsFrom(extended), ['she', 'he', 'xe']);
});

test('subjectsFrom tolerates a three-field bullet', () => {
    // Dropping the fourth field is supported: the noun is inferred.
    assert.deepEqual(subjectsFrom('## Pronouns\n- she/her/her\n'), ['she']);
});

test('subjectsFrom returns an empty list when there is no Pronouns table', () => {
    assert.deepEqual(subjectsFrom('## Gear\n- a thermos\n'), []);
});

test('subjectsFrom ignores a disabled bullet', () => {
    // The Tables tab comments bullets out to disable them; a disabled pronoun
    // set is one the generator will not roll, so the GUI must not offer it.
    const withDisabled = TABLES.replace('- he/him/his/man', '<!-- - he/him/his/man -->');
    assert.deepEqual(subjectsFrom(withDisabled), ['she']);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test "test/pronouns.test.js"`
Expected: FAIL — `Cannot find module '../lib/pronouns'`

- [ ] **Step 3: Write the module**

Create `lib/pronouns.js`:

```javascript
/**
 * The subject pronouns the generator can actually roll, read off
 * npc-generator-tables.md.
 *
 * The GUI used to hardcode she/he/they. The generator removed they/them
 * deliberately - see that table's own comment - and the dropdown went on
 * offering a value that matched nothing, sending --pronouns they to a script
 * that would reject it. Deriving the list means the two cannot drift again,
 * and a pronoun set added to the table later appears with no GUI change.
 *
 * Deliberately its own tiny parser rather than a call into tableBullets: this
 * needs one table's first slash-separated field, not the enable/weight
 * machinery, and the two have no reason to move together.
 */

const HEADING_RE = /^##\s+(?!#)\s*(.*?)\s*$/;
const BULLET_RE = /^-\s+(.*?)\s*$/;

/** The subject pronoun of every enabled bullet under '## Pronouns', in order. */
function subjectsFrom(tablesText) {
    const subjects = [];
    let inPronouns = false;
    for (const line of tablesText.split('\n')) {
        const heading = line.match(HEADING_RE);
        if (heading) {
            inPronouns = heading[1] === 'Pronouns';
            continue;
        }
        if (!inPronouns) continue;
        const bullet = line.match(BULLET_RE);
        if (!bullet) continue;   // prose, blank lines and disabled bullets alike
        const subject = bullet[1].split('/')[0].trim();
        if (subject) subjects.push(subject);
    }
    return subjects;
}

module.exports = { subjectsFrom };
```

- [ ] **Step 4: Run the unit test**

Run: `node --test "test/pronouns.test.js"`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing API test**

Create `test/api.pronouns.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '- he/him/his/man',
    '',
    '## Gear',
    '- a battered data-slate',
    '',
].join('\n');

test('GET /api/pronouns returns the subjects from the tables file', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5195 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/pronouns`);
    assert.equal(res.status, 200);
    const { subjects } = await res.json();
    assert.deepEqual(subjects, ['she', 'he']);
});

test('POST /api/create-npc rejects a pronoun the tables file does not offer', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5195 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/create-npc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1, pronouns: 'they', dryRun: true }),
    });
    assert.equal(res.status, 400);
    const { error } = await res.json();
    assert.match(error, /pronoun/i);
});

test('POST /api/create-npc accepts a pronoun the tables file does offer', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5195 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/create-npc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1, pronouns: 'she', dryRun: true }),
    });
    // 202 when the generator script is present, 409 when it is not - either
    // way the pronoun passed validation, which is what this asserts.
    assert.notEqual(res.status, 400);
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `node --test "test/api.pronouns.test.js"`
Expected: FAIL — `/api/pronouns` 404s, and the `they` request is not rejected.

- [ ] **Step 7: Add the route and the validation**

In `server.js`, require the module at the top alongside the others:

```javascript
const pronouns = require('./lib/pronouns');
```

Add a route beside `/api/npc-tables`:

```javascript
    if (url.pathname === '/api/pronouns' && req.method === 'GET') {
        // Read per request rather than cached at startup: the Tables tab can
        // disable a Pronouns bullet while the server is running, and a stale
        // dropdown would offer a set the generator will no longer roll.
        let subjects = [];
        try {
            subjects = pronouns.subjectsFrom(fs.readFileSync(NPC_TABLES_PATH, 'utf8'));
        } catch { /* no tables file - the client falls back to a free-form field */ }
        return sendJson(res, 200, { subjects });
    }
```

In the `/api/create-npc` handler, after the existing `overrides` validation and before `startCreateJob`:

```javascript
        const requestedPronouns = typeof body.pronouns === 'string' && body.pronouns
            ? body.pronouns : null;
        if (requestedPronouns) {
            let known = [];
            try {
                known = pronouns.subjectsFrom(fs.readFileSync(NPC_TABLES_PATH, 'utf8'));
            } catch { /* fall through - an unreadable tables file is its own error later */ }
            if (known.length && !known.includes(requestedPronouns)) {
                return sendJson(res, 400, {
                    error: `unknown pronoun "${requestedPronouns}". Available: ${known.join(', ')}`,
                });
            }
        }
```

and change the `startCreateJob` call's `pronouns:` line to `pronouns: requestedPronouns,`.

- [ ] **Step 8: Run the API test**

Run: `node --test "test/api.pronouns.test.js"`
Expected: PASS, 3 tests.

- [ ] **Step 9: Make the client build the dropdown**

In `public/index.html`, replace the hardcoded options:

```html
      <label class="form-field">
        Pronouns
        <select id="create-pronouns">
          <option value="">Any</option>
        </select>
      </label>
```

In `public/app.js`, in the function that loads the create tab's data (the one calling `/api/npc-tables` around line 697), add:

```javascript
  // Built from the tables file rather than hardcoded in the markup. The
  // generator removed they/them and the hardcoded option outlived it by
  // months, silently sending a value that matched nothing.
  const { subjects } = await api('/api/pronouns');
  const select = document.getElementById('create-pronouns');
  select.innerHTML = '<option value="">Any</option>';
  for (const subject of subjects) {
    const option = document.createElement('option');
    option.value = subject;
    option.textContent = subject;
    select.appendChild(option);
  }
```

- [ ] **Step 10: Run the full suite**

Run: `node --test "test/*.test.js" 2>&1 | tail -8`
Expected: `pass 76`, `fail 0`.

- [ ] **Step 11: Commit**

```bash
git add lib/pronouns.js test/pronouns.test.js test/api.pronouns.test.js server.js public/index.html public/app.js
git commit -m "fix: build the pronouns dropdown from the tables file

The generator removed they/them deliberately -- the noun 'person' was not a
strong enough signal and renders came back androgynous -- and the hardcoded
option outlived it, sending a value that matched nothing. Deriving the list
means the two cannot drift again, and the server now rejects a pronoun the
tables file does not offer."
```

---

### Task 3: Stop serving documentation as editable roll tables

**Files:**
- Modify: `lib/tableBullets.js` — add `NON_TABLE_SECTIONS` and `isRollTable`, filter in `readTables`, guard both write paths
- Modify: `test/tableBullets.test.js`
- Create: `test/api.nonTableSections.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `NON_TABLE_SECTIONS: string[]` and `isRollTable(name: string, bullets: array) -> boolean`, both exported from `lib/tableBullets.js`. `readTables` returns only roll tables. Task 5's grouping consumes that filtered list.

- [ ] **Step 1: Write the failing unit test**

Append to `test/tableBullets.test.js`:

```javascript
const DOC_SECTION_FIXTURE = [
    '## How the script reads this file',
    '',
    'Every `## Heading` starts a table; every `-` bullet under it is one option.',
    '',
    '- **Age** and **Build** bullets carry a paired flag.',
    '- **Gear**, **Weapon** and **Stance** bullets may end `|| hands`.',
    '',
    '## Gear',
    '- a battered data-slate',
    '',
    '## Prompt templates',
    '',
    'These are the sentences the script assembles the rolled traits into.',
    '',
].join('\n');

test('readTables omits the generator\'s own documentation sections', () => {
    // Those bullets are prose explaining the || conventions. Served as roll
    // entries they got checkboxes and weight inputs, so a stray click wrapped
    // a paragraph of documentation in <!-- --> or prefixed it with "x2 ".
    const tables = parseTableFile(DOC_SECTION_FIXTURE).filter(
        (t) => isRollTable(t.name, t.bullets));
    assert.deepEqual(tables.map((t) => t.name), ['Gear']);
});

test('isRollTable rejects a section with no bullets at all', () => {
    // Prompt templates is prose and blockquotes. A section added later with
    // no bullets should never appear either.
    assert.equal(isRollTable('Prompt templates', []), false);
});

test('isRollTable accepts an ordinary roll table', () => {
    assert.equal(isRollTable('Gear', [{ text: 'a thermos', weight: 1, enabled: true }]), true);
});

test('NON_TABLE_SECTIONS names the generator\'s prose headings', () => {
    assert.ok(NON_TABLE_SECTIONS.includes('How the script reads this file'));
    assert.ok(NON_TABLE_SECTIONS.includes('Prompt templates'));
});

test('toggleBulletInText refuses to write to a documentation section', () => {
    const result = toggleBulletInText(
        DOC_SECTION_FIXTURE, 'How the script reads this file',
        '**Age** and **Build** bullets carry a paired flag.', false);
    assert.equal(result.ok, false);
    assert.match(result.error, /not a roll table/i);
});

test('setBulletWeightInText refuses to write to a documentation section', () => {
    const result = setBulletWeightInText(
        DOC_SECTION_FIXTURE, 'How the script reads this file',
        '**Age** and **Build** bullets carry a paired flag.', 2);
    assert.equal(result.ok, false);
    assert.match(result.error, /not a roll table/i);
});
```

Add the new names to that file's `require` at the top:

```javascript
const {
    parseTableFile, toggleBulletInText, setBulletWeightInText,
    isRollTable, NON_TABLE_SECTIONS,
} = require('../lib/tableBullets');
```

(Keep whatever else that line already imports.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test "test/tableBullets.test.js"`
Expected: FAIL — `isRollTable is not a function`.

- [ ] **Step 3: Add the classifier and the guards**

In `lib/tableBullets.js`, after the existing regex constants:

```javascript
/**
 * Headings in npc-generator-tables.md that are documentation, not roll tables.
 *
 * The parser cannot tell them apart structurally: the '|| conventions' section
 * explains the format using '- ' bullets, which look exactly like roll
 * options. Served as options they got checkboxes and weight inputs, so
 * unchecking one wrapped a paragraph of the file's own documentation in
 * <!-- --> and setting a weight prefixed prose with 'x2 '.
 *
 * A named constant rather than a parsed rule, for the same reason the override
 * list is derived from REQUIRED_TABLES: the generator fixes these headings, so
 * they are not free to grow. A prose section added later with no bullets is
 * caught by the second half of isRollTable() without needing an entry here.
 */
const NON_TABLE_SECTIONS = [
    'How the script reads this file',
    'Prompt templates',
];

/** Whether a parsed '## Heading' section is something the GUI may edit. */
function isRollTable(name, bullets) {
    return !NON_TABLE_SECTIONS.includes(name) && bullets.length > 0;
}
```

In `readTables`, filter before returning:

```javascript
function readTables(filePath) {
    return parseTableFile(fs.readFileSync(filePath, 'utf8'))
        .filter((table) => isRollTable(table.name, table.bullets));
}
```

At the top of both `toggleBulletInText` and `setBulletWeightInText`, before scanning lines:

```javascript
    if (NON_TABLE_SECTIONS.includes(tableName)) {
        return { ok: false, error: `"${tableName}" is not a roll table - it is the generator's own documentation` };
    }
```

Add all three names to `module.exports`.

- [ ] **Step 4: Run the unit test**

Run: `node --test "test/tableBullets.test.js"`
Expected: PASS.

- [ ] **Step 5: Write the failing API test**

Create `test/api.nonTableSections.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

const TABLES_FIXTURE = [
    '## How the script reads this file',
    '',
    'Every `## Heading` starts a table.',
    '',
    '- **Age** and **Build** bullets carry a paired flag.',
    '',
    '## Gear',
    '- a battered data-slate',
    '- a canvas tool roll at the hip',
    '',
].join('\n');

test('GET /api/table-bullets does not serve the documentation section', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5194 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/table-bullets`);
    const { tables } = await res.json();
    assert.deepEqual(tables.map((x) => x.name), ['Gear']);
});

test('POST /api/table-bullets/toggle rejects a write to the documentation section', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5194 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/table-bullets/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            table: 'How the script reads this file',
            text: '**Age** and **Build** bullets carry a paired flag.',
            enabled: false,
        }),
    });
    assert.equal(res.status, 400);
});

test('POST /api/table-bullets/set-weight rejects a write to the documentation section', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5194 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/table-bullets/set-weight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            table: 'How the script reads this file',
            text: '**Age** and **Build** bullets carry a paired flag.',
            weight: 2,
        }),
    });
    assert.equal(res.status, 400);
});

test('an ordinary roll table is still editable', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5194 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/table-bullets/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: 'Gear', text: 'a battered data-slate', enabled: false }),
    });
    assert.equal(res.status, 200);
});
```

- [ ] **Step 6: Run it, then the full suite**

Run: `node --test "test/api.nonTableSections.test.js"`
Expected: PASS, 4 tests.

Run: `node --test "test/*.test.js" 2>&1 | tail -8`
Expected: `pass 86`, `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add lib/tableBullets.js test/tableBullets.test.js test/api.nonTableSections.test.js
git commit -m "fix: stop serving the generator's documentation as editable tables

'How the script reads this file' explains the || conventions using '- '
bullets, which the parser cannot distinguish from roll options -- so eleven
paragraphs of documentation got checkboxes and weight inputs, and a stray
click would comment one out or prefix it with 'x2 '. The server no longer
serves those sections and rejects writes to them."
```

---

### Task 4: Group and order the table headings

**Files:**
- Create: `lib/tableGroups.js`
- Create: `test/tableGroups.test.js`
- Modify: `public/app.js` — `renderTableHeadingList`
- Modify: `public/style.css` — group header and nested variant styling

**Interfaces:**
- Consumes: `readTables`'s filtered output from Task 3.
- Produces: `lib/tableGroups.js` exporting `TABLE_GROUPS` and `groupTables(tables) -> [{ group: string, rows: [{ table, isVariant }] }]`. Task 5 modifies the same `renderTableHeadingList` this task rewrites, so Task 5 runs after.

- [ ] **Step 1: Write the failing test**

Create `test/tableGroups.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { groupTables, TABLE_GROUPS } = require('../lib/tableGroups');

const t = (name) => ({ name, bullets: [] });

test('groups appear in the declared order, not file order', () => {
    const grouped = groupTables([t('Stance'), t('Age'), t('Given names'), t('Outfit')]);
    assert.deepEqual(grouped.map((g) => g.group), ['Identity', 'Body', 'Kit', 'Scene']);
});

test('a group with no tables present is omitted entirely', () => {
    const grouped = groupTables([t('Age')]);
    assert.deepEqual(grouped.map((g) => g.group), ['Body']);
});

test('variants nest under the base table they extend', () => {
    // Given in file order (he before she is NOT file order in the live file);
    // the base comes first and the variants sort by name, so the list order
    // is stable across reloads rather than following whatever the file says.
    const grouped = groupTables([t('Hair'), t('Hair (she) +'), t('Hair (he) +'), t('Eyes')]);
    const appearance = grouped.find((g) => g.group === 'Appearance');
    assert.deepEqual(
        appearance.rows.map((r) => [r.table.name, r.isVariant]),
        [['Hair', false], ['Hair (he) +', true], ['Hair (she) +', true], ['Eyes', false]],
    );
});

test('a variant whose base table is absent still appears, not nested', () => {
    // Defensive: a tables file could disable every bullet of a base table,
    // and readTables drops a table with no bullets. The variant must not
    // vanish with it.
    const grouped = groupTables([t('Hair (she) +')]);
    const appearance = grouped.find((g) => g.group === 'Appearance');
    assert.deepEqual(appearance.rows.map((r) => r.table.name), ['Hair (she) +']);
});

test('a table named in no group lands in Other rather than disappearing', () => {
    // A table added to the generator later must stay reachable here.
    const grouped = groupTables([t('Age'), t('Something New')]);
    const other = grouped.find((g) => g.group === 'Other');
    assert.deepEqual(other.rows.map((r) => r.table.name), ['Something New']);
});

test('Other sorts last', () => {
    const grouped = groupTables([t('Something New'), t('Age')]);
    assert.equal(grouped.at(-1).group, 'Other');
});

test('every table given to it comes back exactly once', () => {
    const names = ['Given names', 'Hair', 'Hair (she) +', 'Weapon', 'Stance', 'Zzz'];
    const grouped = groupTables(names.map(t));
    const returned = grouped.flatMap((g) => g.rows.map((r) => r.table.name));
    assert.equal(returned.length, names.length);
    assert.deepEqual([...returned].sort(), [...names].sort());
});

test('Glow colour is grouped under Scene, not left in Other', () => {
    const grouped = groupTables([t('Glow colour')]);
    assert.equal(grouped[0].group, 'Scene');
});

test('TABLE_GROUPS names no table twice', () => {
    const all = TABLE_GROUPS.flatMap((g) => g.tables);
    assert.equal(new Set(all).size, all.length);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test "test/tableGroups.test.js"`
Expected: FAIL — `Cannot find module '../lib/tableGroups'`

- [ ] **Step 3: Write the module**

Create `lib/tableGroups.js`:

```javascript
/**
 * The order and grouping the Tables tab lists headings in.
 *
 * File order put Hair, 'Hair (she) +' and 'Hair (he) +' as three unrelated
 * top-level rows and interleaved identity tables with appearance ones. These
 * groups follow what a bullet actually describes, which is how someone
 * curating the tables thinks about them.
 *
 * A pure function so it can be tested without a DOM - the rest of the Tables
 * tab is DOM code this repo has no harness for.
 */

const TABLE_GROUPS = [
    { group: 'Identity', tables: ['Given names', 'Family names', 'Callsigns', 'Pronouns', 'Theme', 'Role', 'Faction'] },
    { group: 'Body', tables: ['Age', 'Build', 'Height', 'Skin'] },
    { group: 'Appearance', tables: ['Hair', 'Hair colour', 'Eyes', 'Feature', 'Demeanor'] },
    { group: 'Kit', tables: ['Outfit', 'Headgear', 'Weapon', 'Gear'] },
    { group: 'Scene', tables: ['Backdrop', 'Weather', 'Stance', 'Glow colour'] },
];

const OTHER = 'Other';

/** A heading's base table name: 'Hair (she) +' -> 'Hair', 'Hair' -> 'Hair'. */
function baseNameOf(name) {
    const paren = name.indexOf(' (');
    return paren === -1 ? name : name.slice(0, paren);
}

/**
 * Tables arranged into ordered groups, with per-pronoun variants nested under
 * the base table they extend.
 *
 * Every table given is returned exactly once. One named in no group lands in a
 * trailing 'Other' rather than disappearing, so a table added to the generator
 * later stays reachable without an edit here.
 */
function groupTables(tables) {
    const byBase = new Map();
    for (const table of tables) {
        const base = baseNameOf(table.name);
        if (!byBase.has(base)) byBase.set(base, []);
        byBase.get(base).push(table);
    }

    // Base first, then its variants in a stable order rather than file order,
    // so 'Hair (she) +' and 'Hair (he) +' do not swap places between reloads.
    for (const group of byBase.values()) {
        group.sort((a, b) => {
            const aVariant = a.name.includes(' (');
            const bVariant = b.name.includes(' (');
            if (aVariant !== bVariant) return aVariant ? 1 : -1;
            return a.name.localeCompare(b.name);
        });
    }

    const claimed = new Set();
    const out = [];
    for (const { group, tables: names } of TABLE_GROUPS) {
        const rows = [];
        for (const name of names) {
            for (const table of byBase.get(name) || []) {
                rows.push({ table, isVariant: table.name !== name });
                claimed.add(table.name);
            }
        }
        if (rows.length) out.push({ group, rows });
    }

    const leftovers = tables.filter((table) => !claimed.has(table.name));
    if (leftovers.length) {
        out.push({ group: OTHER, rows: leftovers.map((table) => ({ table, isVariant: false })) });
    }
    return out;
}

module.exports = { TABLE_GROUPS, groupTables, baseNameOf };
```

- [ ] **Step 4: Run the test**

Run: `node --test "test/tableGroups.test.js"`
Expected: PASS, 9 tests.

- [ ] **Step 5: Serve the module to the browser**

`public/app.js` runs in a browser and cannot `require`. Add a route in `server.js` beside the other static handling so the client can load it, or — simpler and consistent with this repo having no build step — duplicate nothing and instead expose the grouping through the existing `/api/table-bullets` response.

Take the second path. In `server.js`:

```javascript
const tableGroups = require('./lib/tableGroups');
```

```javascript
    if (url.pathname === '/api/table-bullets' && req.method === 'GET') {
        const tables = tableBullets.readTables(NPC_TABLES_PATH);
        // Grouped server-side so the ordering logic stays a testable pure
        // function in lib/ rather than becoming untestable DOM code. The flat
        // list is kept in the response because the presets tab reads it.
        return sendJson(res, 200, { tables, groups: tableGroups.groupTables(tables) });
    }
```

- [ ] **Step 6: Render the groups**

In `public/app.js`, store the groups in `tablesState` and rewrite `renderTableHeadingList`:

```javascript
async function loadTables() {
  const { tables, groups } = await api('/api/table-bullets');
  tablesState.tables = tables;
  tablesState.groups = groups;
  // ... rest unchanged
}
```

```javascript
function renderTableHeadingList() {
  elTables.headingList.innerHTML = '';
  for (const { group, rows } of tablesState.groups) {
    const header = document.createElement('div');
    header.className = 'table-group-header';
    header.textContent = group;
    elTables.headingList.appendChild(header);

    for (const { table, isVariant } of rows) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'table-heading-row'
        + (isVariant ? ' variant' : '')
        + (table.name === tablesState.selectedTable ? ' active' : '');
      row.dataset.table = table.name;
      row.textContent = headingLabel(table);
      row.addEventListener('click', () => {
        tablesState.selectedTable = table.name;
        renderTableHeadingList();
        renderTableBullets();
      });
      elTables.headingList.appendChild(row);
    }
  }
}

/** The row's label, including its disabled-count badge. */
function headingLabel(table) {
  const disabledCount = table.bullets.filter((b) => !b.enabled).length;
  return disabledCount
    ? `${table.name} (${table.bullets.length}, ${disabledCount} disabled)`
    : `${table.name} (${table.bullets.length})`;
}
```

Add `groups: []` to the `tablesState` object literal.

- [ ] **Step 7: Style the groups**

In `public/style.css`, after `.table-heading-row.active`:

```css
.table-group-header {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #7c8ba1;
  margin: 0.6rem 0 0.1rem;
}
.table-group-header:first-child { margin-top: 0; }
.table-heading-row.variant { margin-left: 0.9rem; }
```

- [ ] **Step 8: Run the full suite**

Run: `node --test "test/*.test.js" 2>&1 | tail -8`
Expected: `pass 95`, `fail 0`.

- [ ] **Step 9: Commit**

```bash
git add lib/tableGroups.js test/tableGroups.test.js server.js public/app.js public/style.css
git commit -m "feat: group the Tables headings and nest per-pronoun variants

File order listed Hair, 'Hair (she) +' and 'Hair (he) +' as three unrelated
rows and interleaved identity tables with appearance ones. Five groups by
what a bullet describes, variants indented under their base. Grouping is a
pure function in lib/ so it is testable; a table named in no group lands in
a trailing Other rather than disappearing."
```

---

### Task 5: Stop the heading column moving when a checkbox is clicked

**Files:**
- Modify: `public/style.css:464` — `.table-heading-list`
- Modify: `public/app.js` — `toggleBullet`

**Interfaces:**
- Consumes: `headingLabel` and the `data-table` attribute added in Task 4.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Fix the column width**

In `public/style.css`, replace:

```css
.table-heading-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 220px;
}
```

with:

```css
/* A fixed basis, not min-width. As a flex item with content-driven width, this
   column widened the instant a heading's badge grew from "Stance (37)" to
   "Stance (37, 1 disabled)" -- which shoved the bullet panel sideways every
   time a checkbox was clicked. */
.table-heading-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 0 0 260px;
  min-width: 0;
}
.table-heading-row {
  overflow-wrap: anywhere;
}
```

- [ ] **Step 2: Narrow the re-render**

In `public/app.js`, in `toggleBullet`, replace:

```javascript
    bullet.enabled = nextEnabled;
    renderTableHeadingList(); // the disabled-count badge changed
```

with:

```javascript
    bullet.enabled = nextEnabled;
    // Only this row's badge changed. Rebuilding the whole list -- thirty-odd
    // buttons and their group headers -- also threw away the list's scroll
    // position on every click.
    const table = tablesState.tables.find((t) => t.name === tableName);
    const row = elTables.headingList.querySelector(`[data-table="${CSS.escape(tableName)}"]`);
    if (table && row) row.textContent = headingLabel(table);
```

- [ ] **Step 3: Run the full suite**

Run: `node --test "test/*.test.js" 2>&1 | tail -8`
Expected: `pass 95`, `fail 0`. No test covers this — it is DOM behaviour, verified manually in Step 4.

- [ ] **Step 4: Verify by hand**

Start the server (`node server.js`) and open the Tables tab.

1. Select a table with a long heading — `Union Administrative Department` is not one, but `How the script reads this file` is now absent, so use `Given names (she) +`. Confirm the group headers render and variants are indented.
2. Toggle a checkbox on any bullet. **Confirm the bullet panel does not move horizontally.**
3. Scroll the heading list down, then toggle a checkbox. **Confirm the list does not jump back to the top.**
4. Toggle the same bullet back. Confirm the badge disappears and the panel still does not move.

- [ ] **Step 5: Commit**

```bash
git add public/style.css public/app.js
git commit -m "fix: stop the Tables heading column resizing on every toggle

The column had min-width but no flex basis, so its width followed its
content -- and a heading's badge grows from 'Stance (37)' to 'Stance (37, 1
disabled)' the moment a bullet is disabled, shoving the bullet panel
sideways. Fixed basis, and the toggle now updates one row's label instead of
rebuilding the list and losing its scroll position."
```

---

### Task 6: Keyboard navigation between NPCs

**Files:**
- Modify: `public/app.js` — a new key handler, and `openDetail`
- Modify: `public/index.html` — the hint line in the detail overlay header
- Modify: `public/style.css` — the hint's styling

**Interfaces:**
- Consumes: `state.visibleItems`, `openDetail(item)`, `state.detailItemId`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the hint markup**

In `public/index.html`, in the detail overlay near `<h2 id="detail-name">`, add after the name element:

```html
        <p class="detail-shortcuts">&larr; &rarr; navigate &middot; Esc close</p>
```

- [ ] **Step 2: Style it**

In `public/style.css`:

```css
/* Present for someone looking for it, not competing with the NPC's name. */
.detail-shortcuts {
  margin: 0.15rem 0 0;
  font-size: 0.72rem;
  color: #6b7280;
  letter-spacing: 0.02em;
}
```

- [ ] **Step 3: Add the key handler**

In `public/app.js`, near the other top-level `addEventListener` calls:

```javascript
/** Whether focus is somewhere typing should win over navigation. */
function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** The overlays stacked above the NPC detail sheet, innermost first. */
function topmostOverlay() {
  if (!el.imageZoom.hidden) return { close: () => { el.imageZoom.hidden = true; } };
  if (!elDeleteConfirm.overlay.hidden) return { close: () => { elDeleteConfirm.overlay.hidden = true; } };
  if (!elTraits.overlay.hidden) return { close: () => { elTraits.overlay.hidden = true; } };
  if (!elTables.preview.hidden) return { close: () => cancelPresetPreview() };
  return null;
}

/** Move `offset` places through the grid's current order and open that NPC. */
function stepDetail(offset) {
  const index = state.visibleItems.findIndex((i) => i.id === state.detailItemId);
  if (index === -1) return;
  // Clamped, not wrapping: arrowing off the end of a filtered list and
  // landing back at the start reads as a bug rather than a convenience.
  const next = state.visibleItems[index + offset];
  if (next) openDetail(next);
}

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingTarget(document.activeElement)) return;

  if (e.key === 'Escape') {
    const nested = topmostOverlay();
    if (nested) {
      nested.close();
      e.preventDefault();
      return;
    }
    if (!el.overlay.hidden) {
      el.overlay.hidden = true;
      el.imageZoom.hidden = true;
      e.preventDefault();
    }
    return;
  }

  // Arrow navigation belongs to the NPC sheet alone, and only when nothing
  // is stacked on top of it - arrowing the list out from under an open
  // delete confirmation would be actively dangerous.
  if (el.overlay.hidden || topmostOverlay()) return;
  if (e.key === 'ArrowLeft') {
    stepDetail(-1);
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    stepDetail(1);
    e.preventDefault();
  }
});
```

If `cancelPresetPreview` is not already a named function, extract the body of the existing preset-cancel click handler into one and call it from both places.

- [ ] **Step 4: Run the full suite**

Run: `node --test "test/*.test.js" 2>&1 | tail -8`
Expected: `pass 95`, `fail 0`. No test covers this — DOM behaviour, verified manually below.

- [ ] **Step 5: Verify by hand**

Start the server and open the Import tab with several NPCs listed.

1. Click an NPC. Confirm the hint line reads `← → navigate · Esc close` under the name, dim and unobtrusive.
2. Press `→` several times. Confirm it walks forward through the grid in the order shown.
3. Press `←` back to the first NPC, then `←` again. **Confirm it stops rather than wrapping to the end.**
4. Apply a filter or change the sort, open an NPC, and arrow through. **Confirm the order matches the filtered grid, not the unfiltered list.**
5. Press `Esc`. Confirm the sheet closes.
6. Open an NPC, click Delete to raise the confirm dialog, press `Esc`. **Confirm the confirm closes and the NPC sheet stays open.** Press `Esc` again — now the sheet closes.
7. Open an NPC, click into the regenerate-seed number input, press `←` and `→`. **Confirm the NPC does not change** and the caret moves in the field.
8. Hover an image to raise the zoom, press `Esc`. Confirm the zoom closes and the sheet stays open.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/index.html public/style.css
git commit -m "feat: arrow-key navigation and Esc on the NPC detail sheet

Left and right step through the grid's current filtered and sorted order;
Esc closes the innermost overlay first, so a delete confirmation or an image
zoom closes before the sheet under it. Arrows are ignored while anything is
stacked above the sheet and while focus is in a field, so typing a seed
still works. A dim hint line in the header says so."
```

---

### Task 7: Unarmed checkbox

Runs last: it is the one task that depends on the art-generator plan having shipped `--unarmed`.

**Files:**
- Modify: `public/index.html` — the create form's options row
- Modify: `public/app.js` — the create payload
- Modify: `server.js` — `startCreateJob` and the `/api/create-npc` handler
- Create: `test/api.createArgs.test.js`

**Interfaces:**
- Consumes: `--unarmed` on `generate-npc.py`.
- Produces: nothing.

- [ ] **Step 1: Confirm the generator supports the flag**

Run: `python <path to generate-npc.py> --help 2>&1 | grep -A2 unarmed`
Expected: the `--unarmed` entry. **If absent, stop — the art-generator plan has not shipped.**

- [ ] **Step 2: Write the failing test**

Create `test/api.createArgs.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '',
    '## Gear',
    '- a battered data-slate',
    '',
].join('\n');

// A stub standing in for generate-npc.py: it echoes its own argv so the test
// can assert on the command line the server built, without needing Python or
// a ComfyUI server present.
const STUB = [
    'import sys',
    'print(" ".join(sys.argv[1:]))',
    '',
].join('\n');

async function runCreate(server, body) {
    const res = await fetch(`${server.baseUrl}/api/create-npc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const { jobId } = await res.json();
    // Poll until the stub exits and its output is captured.
    for (let i = 0; i < 50; i++) {
        const status = await fetch(`${server.baseUrl}/api/create-status?jobId=${jobId}`);
        const job = await status.json();
        if (job.status !== 'running') return job.log;
        await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error('create job never finished');
}

test('the unarmed checkbox adds --unarmed', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: 5193, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const log = await runCreate(server, { count: 1, unarmed: true, dryRun: true });
    assert.match(log, /--unarmed/);
});

test('an unchecked box adds nothing', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: 5193, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const log = await runCreate(server, { count: 1, dryRun: true });
    assert.doesNotMatch(log, /--unarmed/);
});
```

- [ ] **Step 3: Teach the test server to write a stub generator**

`startTestServer` does not currently write a `generate-npc.py`. In `test/helpers/testServer.js`, accept an optional `generatorSource` and, when given, write it next to the manifest and point `generateNpcScript` at it:

```javascript
async function startTestServer({ tablesText, port, generatorSource }) {
    // ... existing body, then before writing config.json:
    let generateNpcScript;
    if (generatorSource) {
        generateNpcScript = path.join(dir, 'generate-npc.py');
        fs.writeFileSync(generateNpcScript, generatorSource);
    }
```

and include `...(generateNpcScript ? { generateNpcScript } : {})` in the config object.

- [ ] **Step 4: Run it to confirm it fails**

Run: `node --test "test/api.createArgs.test.js"`
Expected: FAIL — `--unarmed` absent from the echoed argv.

- [ ] **Step 5: Add the flag server-side**

In `server.js`, in `startCreateJob`, after the `keepRawToken` line:

```javascript
    if (opts.unarmed) args.push('--unarmed');
```

In the `/api/create-npc` handler's `startCreateJob` call, after `keepRawToken`:

```javascript
            unarmed: !!body.unarmed,
```

- [ ] **Step 6: Add the checkbox**

In `public/index.html`, in the create form's options row after the keep-raw checkbox:

```html
      <label><input type="checkbox" id="create-unarmed" /> Unarmed run <span class="hint">(military and criminal roles keep their weapons)</span></label>
```

In `public/app.js`, add `unarmed: document.getElementById('create-unarmed').checked,` to the create request payload, next to `keepRawToken`.

- [ ] **Step 7: Run the test and the full suite**

Run: `node --test "test/api.createArgs.test.js"`
Expected: PASS, 2 tests.

Run: `node --test "test/*.test.js" 2>&1 | tail -8`
Expected: `pass 97`, `fail 0`.

- [ ] **Step 8: Verify by hand**

Start the server, open Create NPC, tick **Unarmed run**, click **Preview (dry run)**. Confirm the job log shows `--unarmed` in the invocation and the previewed NPCs' `Armed with` reads `unarmed` for civilian roles while a soldier still carries a sidearm.

- [ ] **Step 9: Commit**

```bash
git add public/index.html public/app.js server.js test/api.createArgs.test.js test/helpers/testServer.js
git commit -m "feat: add an unarmed-run checkbox to the create form

Wired to the generator's --unarmed. The label states the tiering rather
than promising more than the flag delivers: military and criminal roles keep
their weapons, civilians are emptied. The test server can now write a stub
generator, so the command line the server builds is assertable without
Python or ComfyUI."
```

---

### Task 8: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/known-issues.md`

- [ ] **Step 1: Update the README**

- Document the Tables tab's grouped headings and that the generator's prose sections are not editable.
- Document the keyboard shortcuts on the NPC detail sheet.
- Document the **Unarmed run** checkbox, with its tiering.
- If the README states a test count, update it — the suite goes from 61 to 97.
- Check for any reference to `Accent`; it is `Glow colour` now.

- [ ] **Step 2: Note what was not fixed**

In `docs/known-issues.md`, the five parked items are untouched by this work. Add a line to the preamble recording that the `OVERRIDE_TABLES` drift — which was not previously listed — has been fixed by deriving the list from `REQUIRED_TABLES`, so a future reader does not go looking for it.

- [ ] **Step 3: Confirm the suite is green**

Run: `node --test "test/*.test.js" 2>&1 | tail -8`
Expected: `pass 97`, `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/known-issues.md
git commit -m "docs: record the grouped Tables page, keyboard shortcuts and unarmed run"
```

---

## Manual verification not covered by tests

Items 1 and 3 of the spec — the column reflow and the keyboard shortcuts — are DOM behaviour, and this repo has no browser test harness. Adding one for two changes is not proportionate, so their verification is the by-hand steps in Task 5 Step 4 and Task 6 Step 5. **The suite does not cover them; do not report them as tested.**
