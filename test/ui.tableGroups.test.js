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
