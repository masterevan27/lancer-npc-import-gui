# Table Groups (import GUI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Tables tab, presets, the Create form's override dropdown and the Chances panel understand a `- => Name` group reference and a `## Name` group table the way the generator does, instead of treating them as prose and an orphan table.

**Architecture:** `lib/tableBullets.js` learns to recognise a reference and to map each group table to the table that references it; everything else consumes that map. `lib/tableFlags.js` lets a group inherit its parent's flag vocabulary. `lib/tableGroups.js` nests a group under its parent. `lib/presets.js` leaves a reference alone when the preset predates its group. `lib/traitOptions.js` expands a reference into members. `public/app.js` renders the reference row, the group's chances and its note.

**Tech Stack:** Zero-dependency Node, `node:test`. Run one file with `node --test test/<file>.test.js`, everything with `node --test --test-concurrency=4 --test-timeout=120000 "test/*.test.js"`. UI tests fetch `/index.html`, `/app.js` and `/style.css` from a real server and assert on the source; every test file binds its own port (5241 and 5242 are the next free ones).

**Spec:** `G:\GIT-REPOS\lancer-art-generator\docs\superpowers\specs\2026-09-12-table-groups-design.md`, section 5 (and section 3 for the file contract). The generator half is `docs/superpowers/plans/2026-09-12-table-groups.md` in that repo.

## Global Constraints

- Work in the worktree `G:\GIT-REPOS\lancer-npc-import-gui\.claude\worktrees\bg-import` on a new branch `feature/table-groups-gui` cut from `main` (not from the backgrounds branch), or in a fresh worktree of your own. Commit after every task, lowercase prose subjects.
- A reference is `=> Name` in the prose segment, optionally after `xN `, with only `@theme` tokens in its flag segment. Mirror the generator's reading exactly: prose is everything before the first `||`.
- Every writer in `lib/tableBullets.js` stays an in-place single-line rewrite; a reference round-trips byte-identical through all four.
- The drift test `every flag the live tables use has a checkbox` in `test/tableFlags.test.js` must pass against the sibling generator checkout once its Outfit is regrouped, which is why Tasks 1 and 2 come first and the generator plan's Task 11 waits for them.
- Code is MIT. House style: long comments that say why and name the rejected alternative.

---

### Task 1: Recognise a reference and map groups to parents

**Files:**
- Modify: `lib/tableBullets.js` (after `splitWeight()`, and `parseTableFile()`, and `module.exports`)
- Test: `test/tableBullets.test.js`

**Interfaces:**
- Produces: `referenceTargetOf(tableName, text) -> string | null` (the group heading a reference names, else null; uses the table's prose arity so a three-segment table is read correctly); `parseTableFile()` adds `references: string[]` (distinct targets, file order) to every table; `groupParents(tables) -> { [groupHeading]: parentBaseName }` covering each referenced heading and its `(x)` / `(x) +` variants.

- [ ] **Step 1: Write the failing tests**

Append to `test/tableBullets.test.js`:

```js
const { referenceTargetOf, groupParents } = require('../lib/tableBullets');

test('referenceTargetOf reads "=> Name" off the prose segment and nothing else', () => {
    assert.equal(referenceTargetOf('Outfit', '=> Flight suits'), 'Flight suits');
    assert.equal(referenceTargetOf('Outfit', '=> Flight suits (gundam) || @gundam'), 'Flight suits (gundam)');
    assert.equal(referenceTargetOf('Outfit', 'a jacket || civ'), null);
    assert.equal(referenceTargetOf('Outfit', '=>'), null);
    assert.equal(referenceTargetOf('Outfit', 'a => b'), null);
    // A three-segment table's prose is two segments; the arrow still leads.
    assert.equal(referenceTargetOf('Backdrop', '=> Skies || a wide shot || weather'), 'Skies');
});

test('parseTableFile lists the distinct groups each table references, in file order', () => {
    const tables = parseTableFile([
        '## Outfit', '- a jacket', '- x2 => Flight suits', '- => Robes || @neosamurai', '- => Flight suits',
        '## Outfit (she) +', '- => Crop tops',
        '## Flight suits', '- a flight suit',
    ].join('\n'));
    assert.deepEqual(tables.map((t) => t.references), [['Flight suits', 'Robes'], ['Crop tops'], []]);
    // The reference is still an ordinary bullet with its weight read off.
    assert.deepEqual(tables[0].bullets[1], { text: '=> Flight suits', weight: 2, enabled: true });
});

test('groupParents maps every referenced heading and its variants to the referencing base table', () => {
    const tables = parseTableFile([
        '## Outfit', '- => Flight suits', '- => Flight suits (gundam) || @gundam',
        '## Outfit (she) +', '- => Crop tops',
        '## Flight suits', '- a', '## Flight suits (she) +', '- b', '## Flight suits (gundam)', '- c',
        '## Crop tops', '- d', '## Headgear', '- e',
    ].join('\n'));
    assert.deepEqual(groupParents(tables), {
        'Flight suits': 'Outfit',
        'Flight suits (she) +': 'Outfit',
        'Flight suits (gundam)': 'Outfit',
        'Crop tops': 'Outfit',
    });
});

test('a reference round-trips unchanged through every writer', () => {
    const file = ['## Outfit', '- x2 => Flight suits', '- a jacket', ''].join('\n');
    const off = toggleBulletInText(file, 'Outfit', '=> Flight suits', false);
    assert.equal(off.text, ['## Outfit', '<!-- - x2 => Flight suits -->', '- a jacket', ''].join('\n'));
    const on = toggleBulletInText(off.text, 'Outfit', '=> Flight suits', true);
    assert.equal(on.text, file);
    const heavier = setBulletWeightInText(file, 'Outfit', '=> Flight suits', 3);
    assert.equal(heavier.text, ['## Outfit', '- x3 => Flight suits', '- a jacket', ''].join('\n'));
});
```

Check the file's existing `require` line already pulls in `parseTableFile`, `toggleBulletInText` and `setBulletWeightInText`; add whichever is missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/tableBullets.test.js 2>&1 | grep -E "✖|pass|fail"`
Expected: the three new tests fail (`referenceTargetOf is not a function`, `references` undefined).

- [ ] **Step 3: Implement**

In `lib/tableBullets.js`, after `splitWeight()`:

```js
/**
 * A group reference: a bullet whose prose is '=> Name' hands its slot to the
 * '## Name' table, whose bullets are the variants of one look. Mirrors
 * generate-npc.py's reference_target(): the prose is everything before the
 * table's flag segment, so a three-segment table is read with its own arity,
 * and a bare '=>' is not a reference - it rolls as text and gets noticed.
 */
const REFERENCE_PREFIX = '=> ';

function referenceTargetOf(tableName, text) {
    const prose = tableFlags.splitBulletFlags(tableName, text).body;
    const first = prose.split('||')[0].trim();
    if (!first.startsWith(REFERENCE_PREFIX)) return null;
    const target = first.slice(REFERENCE_PREFIX.length).trim();
    return target || null;
}

/** A heading's base table name: 'Hair (she) +' -> 'Hair'. (Same rule as lib/tableGroups.js.) */
function baseNameOf(name) {
    const paren = String(name).indexOf(' (');
    return paren === -1 ? String(name) : String(name).slice(0, paren);
}

/**
 * { groupHeading: parentBaseName } for every heading some table references,
 * and for that heading's own '(x)' and '(x) +' variants, which variant_table()
 * in the generator folds into the group. The parent is the referencing
 * table's BASE name: a reference in 'Outfit (she) +' still makes the group an
 * Outfit group, with Outfit's flags and Outfit's row in the Tables tab.
 */
function groupParents(tables) {
    const parents = {};
    const names = tables.map((t) => t.name);
    for (const table of tables) {
        for (const target of table.references || []) {
            for (const name of names) {
                if (name === target || name.startsWith(`${target} (`)) {
                    parents[name] = baseNameOf(table.name);
                }
            }
        }
    }
    return parents;
}
```

In `parseTableFile()`, change the heading branch to `current = { name: heading[1], bullets: [], references: [] };` and after `current.bullets.push(...)` add:

```js
        const target = referenceTargetOf(current.name, text);
        if (target && !current.references.includes(target)) current.references.push(target);
```

Add `referenceTargetOf, groupParents, REFERENCE_PREFIX` to `module.exports`.

- [ ] **Step 4: Run the tests**

Run: `node --test test/tableBullets.test.js test/tableBullets.applyEdits.test.js test/tableBullets.flags.test.js 2>&1 | grep -E "✖|pass|fail"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/tableBullets.js test/tableBullets.test.js
git commit -m "tableBullets reads a '=> Name' group reference and maps each group to its parent"
```

---

### Task 2: A group inherits its parent's flag vocabulary

**Files:**
- Modify: `lib/tableFlags.js` (`flagsFor`, `knownFlags`, `hasFlags`, `setBulletFlag`)
- Modify: `lib/tableBullets.js` (`setBulletFlagInText`)
- Modify: `server.js` (`/api/table-bullets` GET route)
- Test: `test/tableFlags.test.js`, `test/tableBullets.flags.test.js`

**Interfaces:**
- Consumes: Task 1 `groupParents`, `parseTableFile`.
- Produces: `flagsFor(tableName, parents = {})`, `knownFlags(tableName, parents = {})`, `hasFlags(tableName, parents = {})`, `setBulletFlag(tableName, text, flag, on, parents = {})` — a trailing optional parameter on each, so every existing caller is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `test/tableFlags.test.js`:

```js
test('a group table inherits the vocabulary of the table that references it', () => {
    const parents = { 'Flight suits': 'Outfit', 'Flight suits (she) +': 'Outfit' };
    assert.deepEqual(knownFlags('Flight suits', parents), knownFlags('Outfit'));
    assert.deepEqual(knownFlags('Flight suits (she) +', parents), knownFlags('Outfit'));
    assert.equal(hasFlags('Flight suits'), false, 'without the map it is still an unknown table');
    const edited = setBulletFlag('Flight suits', 'a flight suit', 'mil', true, parents);
    assert.deepEqual(edited, { ok: true, text: 'a flight suit || mil' });
    assert.equal(setBulletFlag('Flight suits', 'a flight suit', 'mil', true).ok, false);
});
```

Append to `test/tableBullets.flags.test.js`:

```js
test('a flag edit inside a group table resolves the vocabulary through the reference', () => {
    const file = ['## Outfit', '- => Flight suits', '## Flight suits', '- a flight suit', ''].join('\n');
    const out = setBulletFlagInText(file, 'Flight suits', 'a flight suit', 'mil', true);
    assert.equal(out.ok, true, out.error);
    assert.equal(out.text, ['## Outfit', '- => Flight suits', '## Flight suits', '- a flight suit || mil', ''].join('\n'));
});
```

And change the drift test in `test/tableFlags.test.js` (`every flag the live tables use has a checkbox`) to resolve through the map: replace its line-by-line walk with

```js
    const { parseTableFile, groupParents } = require('../lib/tableBullets');
    const tables = parseTableFile(text);
    const parents = groupParents(tables);
    const missing = [];
    for (const table of tables) {
        if (NON_TABLE_SECTIONS.includes(table.name)) continue;
        for (const bullet of table.bullets) {
            const { flags } = splitBulletFlags(table.name, bullet.text);
            for (const flag of flags) {
                if (!knownFlags(table.name, parents).includes(flag)) missing.push(`${table.name}: ${flag}`);
            }
        }
    }
```

keeping the final `assert.deepEqual([...new Set(missing)], [], ...)`. (`parseTableFile` reads disabled bullets too, which the old regex also matched.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/tableFlags.test.js test/tableBullets.flags.test.js 2>&1 | grep -E "✖|pass|fail"`
Expected: the two new tests fail.

- [ ] **Step 3: Implement**

In `lib/tableFlags.js`:

```js
function flagsFor(tableName, parents = {}) {
    // Own name, then base name, then the table that references it as a
    // group: a '## Flight suits' Outfit enters through '- => Flight suits'
    // holds Outfit-shaped bullets and reads Outfit's flags. The map comes
    // from the caller because this module is deliberately file-blind.
    const own = TABLE_FLAGS[tableName] || TABLE_FLAGS[baseNameOf(tableName)];
    if (own) return own;
    const parent = parents[tableName] || parents[baseNameOf(tableName)];
    return parent ? flagsFor(parent, {}) : null;
}

function knownFlags(tableName, parents = {}) {
    return Object.keys(flagsFor(tableName, parents) || {});
}

function hasFlags(tableName, parents = {}) {
    return knownFlags(tableName, parents).length > 0;
}
```

In `setBulletFlag(tableName, text, flag, on, parents = {})` replace both `knownFlags(tableName)` calls with `knownFlags(tableName, parents)`.

In `lib/tableBullets.js` `setBulletFlagInText()`, before the `for` loop add `const parents = groupParents(parseTableFile(fileText));` and pass it: `tableFlags.setBulletFlag(tableName, text, flag, on, parents)`.

In `server.js` `/api/table-bullets` GET, after `const tables = tableBullets.readTables(kind.tables);` add `const parents = tableBullets.groupParents(tables);` and use `tableFlags.flagsFor(table.name, parents)` in the loop.

- [ ] **Step 4: Run the tests**

Run: `node --test test/tableFlags.test.js test/tableBullets.flags.test.js test/api.setFlag.test.js test/ui.tableFlags.test.js 2>&1 | grep -E "✖|pass|fail"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/tableFlags.js lib/tableBullets.js server.js test/tableFlags.test.js test/tableBullets.flags.test.js
git commit -m "a group table reads its parent's flag vocabulary, on the wire and in the writer"
```

---

### Task 3: Nest a group under its parent in the Tables tab list

**Files:**
- Modify: `lib/tableGroups.js` (`groupTables`)
- Modify: `public/app.js` (`renderTableHeadingList`, `loadTables`)
- Modify: `public/style.css` (after `.table-heading-row.variant`)
- Test: `test/tableGroups.test.js`, `test/ui.tableGroups.test.js` (new, port 5242)

**Interfaces:**
- Consumes: Task 1 `groupParents`.
- Produces: rows gain `isGroup: boolean` and `parent: string | null`; the client keeps `tablesState.parents = { [heading]: parent }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/tableGroups.test.js`:

```js
test('a group table nests under the table that references it, after its variants', () => {
    const outfit = { name: 'Outfit', bullets: [], references: ['Flight suits'] };
    const she = { name: 'Outfit (she) +', bullets: [], references: ['Crop tops'] };
    const suits = { name: 'Flight suits', bullets: [], references: [] };
    const suitsShe = { name: 'Flight suits (she) +', bullets: [], references: [] };
    const crop = { name: 'Crop tops', bullets: [], references: [] };
    const grouped = groupTables([crop, suitsShe, t('Headgear'), suits, she, outfit]);
    const kit = grouped.find((g) => g.group === 'Kit');
    assert.deepEqual(kit.rows.map((r) => [r.table.name, r.isVariant, r.isGroup, r.parent]), [
        ['Outfit', false, false, null],
        ['Outfit (she) +', true, false, null],
        ['Crop tops', false, true, 'Outfit'],
        ['Flight suits', false, true, 'Outfit'],
        ['Flight suits (she) +', true, true, 'Outfit'],
        ['Headgear', false, false, null],
    ]);
    assert.ok(!grouped.some((g) => g.group === 'Other'), 'a group is never an orphan');
});
```

Note `t(name)` in that file builds `{ name, bullets: [] }` with no `references`; `groupTables` must treat a missing `references` as empty.

Create `test/ui.tableGroups.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// Group tables on the Tables tab: nested rows, a reference row that links to
// its group, the group's chances scaled by its reference, and the note that
// says when it rolls. Source assertions, as the other ui.* files.
const PORT = 5242;
const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

test('the heading list indents a group row and a group variant twice', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const list = /function renderTableHeadingList\(\)[\s\S]*?\n\}/.exec(js);
    assert.ok(list, 'renderTableHeadingList is no longer top-level');
    assert.match(list[0], /for \(const \{ table, isVariant, isGroup \} of rows\)/);
    assert.match(list[0], /\+ \(isGroup \? ' group' : ''\)/);
    const css = await fetchText(server, '/style.css');
    assert.match(css, /\.table-heading-row\.group \{[^}]*margin-left: 0\.9rem/);
    assert.match(css, /\.table-heading-row\.group\.variant \{[^}]*margin-left: 1\.8rem/);
    const load = /async function loadTables\(\)[\s\S]*?\n\}/.exec(js);
    assert.match(load[0], /tablesState\.parents\[r\.table\.name\] = r\.parent/,
        'loadTables must keep each group\'s parent for the chances panel');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/tableGroups.test.js test/ui.tableGroups.test.js 2>&1 | grep -E "✖|pass|fail"`
Expected: both new tests fail.

- [ ] **Step 3: Implement `groupTables`**

In `lib/tableGroups.js`, `require('./tableBullets')` cannot be added (tableBullets requires tableFlags, and tableGroups must stay dependency-light for the client mirror), so compute parents locally with the same rule:

```js
/** { groupHeading: parentBaseName }, the same rule lib/tableBullets.js's groupParents() applies. */
function parentsOf(tables) {
    const parents = {};
    for (const table of tables) {
        for (const target of table.references || []) {
            for (const other of tables) {
                if (other.name === target || other.name.startsWith(`${target} (`)) {
                    parents[other.name] = baseNameOf(table.name);
                }
            }
        }
    }
    return parents;
}
```

Then in `groupTables()`, before `const claimed = new Set();`, add `const parents = parentsOf(tables);` and change the row-building loop to:

```js
    for (const { group, tables: names } of groups) {
        const rows = [];
        for (const name of names) {
            for (const table of byBase.get(name) || []) {
                rows.push({ table, isVariant: table.name !== name, isGroup: false, parent: null });
                claimed.add(table.name);
            }
            // The groups this table enters, each with its own variants, after
            // the table's own rows: a curator reading Outfit sees what Outfit
            // can deal, groups included, before the next table starts.
            const groupBases = [...new Set(
                Object.entries(parents).filter(([, p]) => p === name).map(([g]) => baseNameOf(g)))].sort();
            for (const base of groupBases) {
                for (const table of byBase.get(base) || []) {
                    if (parents[table.name] !== name) continue;
                    rows.push({ table, isVariant: table.name !== base, isGroup: true, parent: name });
                    claimed.add(table.name);
                }
            }
        }
        if (rows.length) out.push({ group, rows });
    }
```

Change the leftovers line to `leftovers.map((table) => ({ table, isVariant: false, isGroup: false, parent: null }))`. Update the existing test `variants nest under the base table they extend` expectations if they compare whole row objects (they compare `[name, isVariant]` pairs, so no change).

- [ ] **Step 4: Implement the client**

In `public/app.js` `renderTableHeadingList()`, change the loop header to `for (const { table, isVariant, isGroup } of rows)` and the class to:

```js
      row.className = 'table-heading-row'
        + (isVariant ? ' variant' : '')
        + (isGroup ? ' group' : '')
        + (table.name === tablesState.selectedTable ? ' active' : '');
```

In `loadTables()`, after `tablesState.groups = groups;` add:

```js
  // Which table each group is entered from, for the chances estimate and the
  // note; a plain table has no entry.
  tablesState.parents = {};
  for (const g of groups) for (const r of g.rows) if (r.parent) tablesState.parents[r.table.name] = r.parent;
```

and add `parents: {},` to `tablesState`.

In `public/style.css` after `.table-heading-row.variant { margin-left: 0.9rem; }`:

```css
.table-heading-row.group { margin-left: 0.9rem; }
.table-heading-row.group.variant { margin-left: 1.8rem; }
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/tableGroups.test.js test/ui.tableGroups.test.js test/api.tableBullets.test.js 2>&1 | grep -E "✖|pass|fail"`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/tableGroups.js public/app.js public/style.css test/tableGroups.test.js test/ui.tableGroups.test.js
git commit -m "a group table nests under the table that references it in the Tables tab"
```

---

### Task 4: The reference row, the group's chances, and its note

**Files:**
- Modify: `public/app.js` (`renderTableBullets`, `renderBulletFlags`, `renderChances`, `renderChanceNote`; new `referenceTargetOfText`, `groupEntryShare`)
- Modify: `public/style.css`
- Test: `test/ui.tableGroups.test.js`

**Interfaces:**
- Consumes: Task 3 `tablesState.parents`.
- Produces: `referenceTargetOfText(tableName, text) -> string | null` (client mirror of Task 1); `groupEntryShare(table) -> number` (the reference's weight share of the parent, 1 for a plain table).

- [ ] **Step 1: Write the failing tests**

Append to `test/ui.tableGroups.test.js`:

```js
test('a reference row shows a group marker with a jump, and no flag checkboxes', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    assert.match(js, /function referenceTargetOfText\(tableName, text\)/);
    const rows = /function renderTableBullets\(\)[\s\S]*?\n\}/.exec(js);
    assert.match(rows[0], /const target = referenceTargetOfText\(table\.name, bullet\.text\)/);
    assert.match(rows[0], /jump\.className = 'group-jump'/);
    assert.match(rows[0], /tablesState\.selectedTable = target/);
    const flags = /function renderBulletFlags\(table, bullet\)[\s\S]*?\n\}/.exec(js);
    assert.match(flags[0], /if \(referenceTargetOfText\(table\.name, bullet\.text\)\)/,
        'a reference gets no checkbox strip: it carries no flags by the file\'s rules');
});

test('a group\'s estimate is scaled by its reference, and its note says when it rolls', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    assert.match(js, /function groupEntryShare\(table\)/);
    const chances = /function renderChances\(\)[\s\S]*?\n\}/.exec(js);
    assert.match(chances[0], /weightShare\(table, bullet\) \* entry/);
    const note = /function renderChanceNote\(table\)[\s\S]*?\n\}/.exec(js);
    assert.match(note[0], /Rolled only when \$\{parent\} draws this group/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/ui.tableGroups.test.js 2>&1 | grep -E "✖|pass|fail"`
Expected: the two new tests fail.

- [ ] **Step 3: Implement**

In `public/app.js`, next to `bulletBody()`:

```js
/**
 * The group a '=> Name' bullet points at, or null. The client mirror of
 * lib/tableBullets.js's referenceTargetOf(): read off the prose, arrow first.
 */
function referenceTargetOfText(tableName, text) {
  const first = bulletBody(tableName, text).split('||')[0].trim();
  if (!first.startsWith('=> ')) return null;
  return first.slice(3).trim() || null;
}

/**
 * The share of the parent pool that enters this group: the reference row's
 * weight over the parent's enabled weight. 1 for a table that is not a group,
 * so a plain table's estimate is unchanged. The parent is looked up by the
 * group's base name, since 'Flight suits (she) +' is entered through the same
 * '=> Flight suits' its base is.
 */
function groupEntryShare(table) {
  const parentName = tablesState.parents[table.name];
  if (!parentName) return 1;
  const base = table.name.includes(' (') ? table.name.slice(0, table.name.indexOf(' (')) : table.name;
  const parents = tablesState.tables.filter((t) => t.name === parentName || t.name.startsWith(`${parentName} (`));
  for (const parent of parents) {
    const reference = parent.bullets.find((b) => {
      const target = referenceTargetOfText(parent.name, b.text);
      return target === table.name || target === base;
    });
    if (reference) return weightShare(parent, reference);
  }
  return 1;
}
```

In `renderTableBullets()`, after `text.textContent = bulletBody(table.name, bullet.text);` add:

```js
    // A reference row: the arrow stays in the text so the file and the tab
    // agree, and a jump beside it opens the group, since that is where the
    // bullets this slot actually rolls are edited.
    const target = referenceTargetOfText(table.name, bullet.text);
    if (target) {
      row.classList.add('reference');
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'group-jump';
      jump.textContent = 'group ›';
      jump.title = `One slot that rolls from the ${target} table`;
      jump.addEventListener('click', (e) => {
        e.preventDefault();
        if (!tablesState.tables.some((t) => t.name === target)) return;
        tablesState.selectedTable = target;
        renderTableHeadingList();
        renderTableBullets();
      });
      row.appendChild(jump);
    }
```

In `renderBulletFlags()`, first lines:

```js
  const vocabulary = tablesState.flags[table.name];
  if (!vocabulary) return null;
  // A reference carries no flags by the file's rules (check_tables refuses
  // them); its theme tags still show, as text, the way they do on any row.
  if (referenceTargetOfText(table.name, bullet.text)) {
    const strip = document.createElement('div');
    strip.className = 'table-bullet-flags';
    for (const theme of bulletFlagsOf(table.name, bullet.text)) {
      if (!theme.startsWith('@')) continue;
      const tag = document.createElement('span');
      tag.className = 'flag-theme';
      tag.textContent = theme;
      tag.title = 'This whole group is themed. Edit the tag in the tables file.';
      strip.appendChild(tag);
    }
    return strip.childNodes.length ? strip : null;
  }
```

In `renderChances()`, before `table.bullets.forEach(...)` add `const entry = groupEntryShare(table);` and change the estimate line to:

```js
      cell.textContent = `~${formatChance(weightShare(table, bullet) * entry)}`;
```

In `renderChanceNote()`, before `note.textContent = lines.join(' ');`:

```js
  const parent = tablesState.parents[table.name];
  if (parent) {
    lines.push(`Rolled only when ${parent} draws this group, so these rows total the group's own row there.`);
  }
```

In `public/style.css`, after `.table-bullet-text { flex: 1; }`:

```css
.table-bullet-row.reference .table-bullet-text { font-style: italic; }
.group-jump {
  padding: 0.1rem 0.5rem;
  font-size: var(--fs-xs);
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  color: var(--text-2);
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/ui.tableGroups.test.js 2>&1 | grep -E "✖|pass|fail"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/style.css test/ui.tableGroups.test.js
git commit -m "the Tables tab shows a reference as a slot with a jump, and scales a group's odds by it"
```

---

### Task 5: Presets leave a reference alone when they predate its group

**Files:**
- Modify: `lib/presets.js` (`diffPresetAgainstTables`)
- Test: `test/presets.test.js`

**Interfaces:**
- Consumes: Task 1 `referenceTargetOf` (from `./tableBullets`; no cycle, `tableBullets` does not require `presets`).

- [ ] **Step 1: Write the failing test**

Append to `test/presets.test.js`:

```js
test('a reference whose group the preset never saw is left alone rather than disabled', () => {
    const parsed = [
        { name: 'Outfit', bullets: [
            { text: 'a jacket', weight: 1, enabled: true },
            { text: '=> Flight suits', weight: 1, enabled: true },
        ] },
        { name: 'Flight suits', bullets: [{ text: 'a flight suit', weight: 1, enabled: true }] },
    ];
    // Saved before the group existed: the flight suit was an Outfit bullet then.
    const old = { Outfit: [{ text: 'a jacket', weight: 1 }, { text: 'a flight suit', weight: 1 }] };
    const diff = diffPresetAgainstTables(old, parsed);
    assert.deepEqual(diff.willDisable, []);
    assert.deepEqual(diff.notFound, [{ table: 'Outfit', text: 'a flight suit' }]);
    assert.deepEqual(diff.alreadyMatching,
        [{ table: 'Outfit', text: 'a jacket' }, { table: 'Outfit', text: '=> Flight suits' }]);

    // A preset that DOES know the group and omits the reference means it.
    const knowing = { Outfit: [{ text: 'a jacket', weight: 1 }], 'Flight suits': [{ text: 'a flight suit', weight: 1 }] };
    assert.deepEqual(diffPresetAgainstTables(knowing, parsed).willDisable,
        [{ table: 'Outfit', text: '=> Flight suits' }]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/presets.test.js 2>&1 | grep -E "✖|pass|fail"`
Expected: the new test fails on `willDisable`.

- [ ] **Step 3: Implement**

In `lib/presets.js` add `const { referenceTargetOf } = require('./tableBullets');` and inside `diffPresetAgainstTables`'s bullet loop, replace

```js
            if (!selected.has(key)) {
                if (bullet.enabled) willDisable.push({ table, text: bullet.text });
                else alreadyMatching.push({ table, text: bullet.text });
                continue;
            }
```

with

```js
            if (!selected.has(key)) {
                // A '=> Name' reference is one slot standing for a whole table.
                // A preset saved before that table existed lists neither the
                // reference nor the group, and says nothing about entering it
                // - so it is left as it is, the way a table the preset never
                // saw is left as it is. Only a preset that covers the group
                // and still omits the reference is asking to switch it off.
                const target = referenceTargetOf(table, bullet.text);
                const knowsGroup = target && Object.keys(presetSelected || {})
                    .some((k) => k === target || k.startsWith(`${target} (`));
                if (target && !knowsGroup) {
                    alreadyMatching.push({ table, text: bullet.text });
                    continue;
                }
                if (bullet.enabled) willDisable.push({ table, text: bullet.text });
                else alreadyMatching.push({ table, text: bullet.text });
                continue;
            }
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/presets.test.js test/api.presets.test.js test/presets.fs.test.js 2>&1 | grep -E "✖|pass|fail"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/presets.js test/presets.test.js
git commit -m "applying a preset that predates a group leaves the group's reference alone"
```

---

### Task 6: The override dropdown expands a reference into members

**Files:**
- Modify: `lib/traitOptions.js` (`traitOptionsFrom`)
- Test: `test/traitOptions.test.js`

**Interfaces:**
- Consumes: Task 1 `referenceTargetOf`, `groupParents` (require `./tableBullets`).
- Produces: options gain `group: string | null` (the group heading a member came from); group tables are not keys of their own.

- [ ] **Step 1: Write the failing test**

Append to `test/traitOptions.test.js`:

```js
test('a reference is expanded into its group\'s members, and the group is not a key of its own', () => {
    const tables = [
        { name: 'Outfit', references: ['Flight suits'], bullets: [
            { text: 'a jacket || civ', weight: 1, enabled: true },
            { text: '=> Flight suits', weight: 2, enabled: true },
        ] },
        { name: 'Outfit (she) +', references: [], bullets: [{ text: 'a fitted top', weight: 1, enabled: true }] },
        { name: 'Flight suits', references: [], bullets: [{ text: 'a flight suit || mil', weight: 1, enabled: true }] },
        { name: 'Flight suits (she) +', references: [], bullets: [{ text: 'a tailored flight suit', weight: 1, enabled: false }] },
    ];
    const options = traitOptionsFrom(tables);
    assert.deepEqual(Object.keys(options), ['Outfit']);
    assert.deepEqual(options.Outfit.map((o) => [o.value, o.heading, o.group, o.variantSubject, o.enabled]), [
        ['a jacket || civ', 'Outfit', null, null, true],
        ['a flight suit || mil', 'Flight suits', 'Flight suits', null, true],
        ['a fitted top', 'Outfit (she) +', null, 'she', true],
        ['a tailored flight suit', 'Flight suits (she) +', 'Flight suits', 'she', false],
    ]);
    assert.ok(!options.Outfit.some((o) => o.value.startsWith('=>')), 'the reference itself is never a value');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/traitOptions.test.js 2>&1 | grep -E "✖|pass|fail"`
Expected: fails (`Flight suits` is a key; `=> Flight suits` is a value).

- [ ] **Step 3: Implement**

In `lib/traitOptions.js`, add `const { referenceTargetOf, groupParents } = require('./tableBullets');`. In `traitOptionsFrom()`, before the second `for (const table of tables)` loop add `const parents = groupParents(tables);` and `const byName = new Map(tables.map((t) => [t.name, t]));`. In that loop, right after `if (!table.bullets.length) continue;` add `if (parents[table.name]) continue;` (a group is reached through its parent). Replace the inner `for (const bullet of table.bullets) { out[base].push({...}) }` with:

```js
        const push = (bullet, heading, group) => {
            const subject = variantSubjectOf(heading);
            out[base].push({
                value: bullet.text,
                label: readableLabel(bullet.text),
                heading,
                isVariant: heading !== base,
                variantSubject: subject,
                replacedFor: heading === base ? (replacedFor[base] || []).slice() : [],
                enabled: bullet.enabled,
                weight: bullet.weight,
                // The group a member came from, null for a table's own bullet.
                // The Create form and Set... show members under this heading
                // in place of the reference, which is a slot, not a value.
                group,
            });
        };
        for (const bullet of table.bullets) {
            const target = referenceTargetOf(table.name, bullet.text);
            if (!target) {
                push(bullet, table.name, null);
                continue;
            }
            for (const name of [target, ...tables.map((t) => t.name).filter((n) => n.startsWith(`${target} (`))]) {
                const group = byName.get(name);
                if (!group) continue;
                for (const member of group.bullets) push(member, name, target);
            }
        }
```

Keep the existing sort. If the existing sort compares `isVariant` then `heading`, a group's base members (`isVariant: true` because heading ≠ base) sort after the parent's own bullets and before the `(she) +` ones by name; that matches the test's expected order.

- [ ] **Step 4: Run the tests**

Run: `node --test test/traitOptions.test.js test/api.traitOptions.test.js 2>&1 | grep -E "✖|pass|fail"`
Expected: all pass. If `api.traitOptions.test.js`'s "every table the override dropdown offers can be looked up by its own name" fixture has no groups, it is unaffected; if it walks every parsed heading, exclude headings in `groupParents`.

- [ ] **Step 5: Commit**

```bash
git add lib/traitOptions.js test/traitOptions.test.js
git commit -m "the override dropdown offers a group's members under the group, never the reference"
```

---

### Task 7: Route test with a grouped file, README and known-issues

**Files:**
- Create: `test/api.tableGroups.test.js` (port 5241)
- Modify: `README.md` (Tables tab bullet, near line 466)
- Modify: `docs/known-issues.md` (under "Tables & Presets (Import GUI)")

- [ ] **Step 1: Write the route test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// /api/table-bullets against a file with a group: the group nests under its
// parent, carries the parent's flag vocabulary, and a flag edit inside it is
// accepted. The generator's own tests cover what the group ROLLS.
const PORT = 5241;

const TABLES_FIXTURE = [
    '## Pronouns', '- she/her/her/woman', '',
    '## Outfit', '- a jacket || civ', '- x2 => Flight suits', '- => Flight suits (gundam) || @gundam', '',
    '## Outfit (she) +', '- => Crop tops', '',
    '## Flight suits', '- a flight suit', '- a tan flight suit || mil', '',
    '## Flight suits (she) +', '- a tailored flight suit', '',
    '## Flight suits (gundam)', '- a crimson flight suit', '',
    '## Crop tops', '- a crop top || civ', '',
].join('\n');

test('a group nests under its parent and reads its flags', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const { groups, flags } = await (await fetch(`${server.baseUrl}/api/table-bullets?kind=npc`)).json();
    const kit = groups.find((g) => g.group === 'Kit');
    assert.deepEqual(kit.rows.map((r) => [r.table.name, r.isGroup, r.parent]), [
        ['Outfit', false, null], ['Outfit (she) +', false, null],
        ['Crop tops', true, 'Outfit'],
        ['Flight suits', true, 'Outfit'], ['Flight suits (gundam)', true, 'Outfit'], ['Flight suits (she) +', true, 'Outfit'],
    ]);
    assert.ok(!groups.some((g) => g.group === 'Other'));
    assert.deepEqual(Object.keys(flags['Flight suits']), Object.keys(flags.Outfit));
    assert.deepEqual(Object.keys(flags['Crop tops']), Object.keys(flags.Outfit));
});

test('a flag edit inside a group is accepted and written', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const res = await fetch(`${server.baseUrl}/api/table-bullets/set-flag`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'npc', table: 'Flight suits', text: 'a flight suit', flag: 'mil', on: true }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, text: 'a flight suit || mil' });
});
```

Check `test/helpers/testServer.js` for the option name that supplies the NPC tables text (`tablesText`, as the other files use) and for the kind registry needing `generate-npc.py` present; copy whatever `api.setFlag.test.js` does to satisfy it.

- [ ] **Step 2: Run it**

Run: `node --test test/api.tableGroups.test.js 2>&1 | grep -E "✖|pass|fail"`
Expected: pass (Tasks 2 and 3 did the work; this pins the wire shape).

- [ ] **Step 3: Document**

In `README.md`'s Tables tab bullet, after the sentence about per-pronoun variants nesting under their heading, add:

"A **group** table — one that a table enters through a `- => Name` bullet, so that ten near-identical outfits weigh one slot — nests under the table that references it and carries that table's flag checkboxes. The reference row shows as `=> Name` with a **group ›** jump to the group; it has no flags of its own. The Chances column of a group is scaled by the reference's own share, and its note says which table rolls it. Applying a preset saved before a group existed leaves the reference alone, since that preset says nothing about the group."

In `docs/known-issues.md` under "Tables & Presets (Import GUI)", add:

"- A preset saved before a group table existed cannot express "this group off": apply leaves the group's `=> Name` reference as it is. Re-save the preset once the group exists and it records the group like any table."

- [ ] **Step 4: Run the whole suite**

Run: `node --test --test-concurrency=4 --test-timeout=120000 "test/*.test.js" 2>&1 | grep -E "✖|tests |pass |fail "`
Expected: all pass. The drift test passes against the sibling generator whether or not its Outfit has been regrouped yet.

- [ ] **Step 5: Commit**

```bash
git add test/api.tableGroups.test.js README.md docs/known-issues.md
git commit -m "pin the grouped Tables tab on the wire, and document groups"
```

---

## Self-review

**Spec coverage.** §5 layout: Tasks 3 and 4. §5 flags: Task 2. §5 chances: Task 4. §5 presets: Task 5. §5 overrides: Task 6 (Set… needs nothing, as the spec says). §5 trait imports: no change, as the spec says. §5 docs: Task 7.

**Placeholder scan.** None; every step has its code.

**Type consistency.** `referenceTargetOf(tableName, text)` (lib) and `referenceTargetOfText(tableName, text)` (client mirror) both return `string | null`. `groupParents(tables)` returns `{ [heading]: parentBaseName }` and `tableGroups.parentsOf` computes the same shape. Rows carry `{ table, isVariant, isGroup, parent }` in Task 3, read by Task 3's client and Task 7's route test. `flagsFor/knownFlags/hasFlags/setBulletFlag` take `parents` as a trailing optional parameter throughout.
