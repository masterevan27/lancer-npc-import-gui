const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
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

/** Pull one top-level function's source (brace-balanced) out of app.js, unevaluated. */
function extractSource(js, name) {
    const start = js.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `app.js no longer defines ${name}`);
    let depth = 0;
    let end = -1;
    for (let i = js.indexOf('{', start); i < js.length; i += 1) {
        if (js[i] === '{') depth += 1;
        if (js[i] === '}') {
            depth -= 1;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    assert.notEqual(end, -1, `could not find the end of ${name}`);
    return js.slice(start, end);
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

// groupEntryShare does a real division - the reference bullet's weight over
// its parent's enabled total - and a source regex can prove the shape of that
// line but not that the arithmetic is right (see the disabled-reference bug
// this caught: weightShare excludes a disabled bullet from its denominator
// but not from a numerator handed to it directly, so a disabled reference
// read back as its old, inflated share instead of zero). So this one test
// actually RUNS the lifted functions, in a throwaway node:vm context with a
// stubbed tablesState, rather than matching their text. It is kept to this
// one case on purpose - the rest of this file, and the rest of ui.*, stays on
// source assertions, and this does not grow into a second DOM/UI harness.
test('groupEntryShare: an enabled reference gives its real share, a disabled one gives 0, a plain table gives 1', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    const source = [
        "const THREE_SEGMENT_TABLES = new Set(['Backdrop', 'Hair colour', 'Faction']);",
        extractSource(js, 'proseSegmentsOf'),
        extractSource(js, 'bulletBody'),
        extractSource(js, 'referenceTargetOfText'),
        extractSource(js, 'effectiveWeight'),
        extractSource(js, 'weightShare'),
        extractSource(js, 'groupEntryShare'),
    ].join('\n');

    const outfit = {
        name: 'Outfit',
        bullets: [
            { text: 'a jacket', weight: 1, enabled: true },
            { text: '=> Flight suits', weight: 2, enabled: true },
        ],
    };
    const flightSuits = { name: 'Flight suits', bullets: [] };
    const context = {
        tablesState: {
            parents: { 'Flight suits': 'Outfit' },
            tables: [outfit, flightSuits],
        },
    };
    vm.createContext(context);
    vm.runInContext(source, context);

    assert.equal(context.groupEntryShare(flightSuits), 2 / 3);

    outfit.bullets[1].enabled = false;
    assert.equal(context.groupEntryShare(flightSuits), 0);

    assert.equal(context.groupEntryShare(outfit), 1);

    // A themed sibling reports its OWN share, not the neutral group's: before
    // the fix, groupEntryShare matched the family's FIRST reference whose
    // target was table.name OR the base, in file order - so 'Flight suits
    // (gundam)' read Outfit's plain '=> Flight suits' bullet (found first) as
    // if it answered for it too, reporting 0.5 instead of its real 0.25.
    const siblingOutfit = {
        name: 'Outfit',
        bullets: [
            { text: 'a jacket', weight: 1, enabled: true },
            { text: '=> Flight suits', weight: 2, enabled: true },
            { text: '=> Flight suits (gundam)', weight: 1, enabled: true },
        ],
    };
    const siblingFlightSuits = { name: 'Flight suits', bullets: [] };
    const siblingGundam = { name: 'Flight suits (gundam)', bullets: [] };
    context.tablesState.parents = { 'Flight suits': 'Outfit', 'Flight suits (gundam)': 'Outfit' };
    context.tablesState.tables = [siblingOutfit, siblingFlightSuits, siblingGundam];
    assert.equal(context.groupEntryShare(siblingFlightSuits), 2 / 4);
    assert.equal(context.groupEntryShare(siblingGundam), 1 / 4);
});
