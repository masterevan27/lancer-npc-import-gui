const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { startTestServer } = require('./helpers/testServer');

// The Tables tab's search box: which tables and bullets it keeps, and that
// the render functions hide rather than drop rows. Source assertions, as the
// other ui.* files, plus one run of the lifted matchers.
const PORT = 5264;
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

test('the Tables tab has a search box wired to both lists', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/index.html');
    assert.match(html, /<input type="search" id="tables-search"/);
    const js = await fetchText(server, '/app.js');
    assert.match(js, /elTables\.search\.addEventListener\('input', \(\) => \{\s*tablesState\.search = elTables\.search\.value;\s*renderTableHeadingList\(\);\s*renderTableBullets\(\);/);
    const list = extractSource(js, 'renderTableHeadingList');
    assert.match(list, /if \(!tableMatchesSearch\(table, query\)\) continue;/);
    const rows = extractSource(js, 'renderTableBullets');
    assert.match(rows, /row\.hidden = !matches;/,
        'rows are hidden, not skipped, so renderChances still pairs cells with bullets by index');
    assert.match(rows, /flags\.hidden = !matches;/);
    const css = await fetchText(server, '/style.css');
    assert.match(css, /\.table-bullet-row\[hidden\],\s*\.table-bullet-flags\[hidden\] \{ display: none; \}/);
});

test('the search matches a table by name or any bullet, and a bullet by its text or its table', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const source = ['tableSearchQuery', 'tableBulletMatchesSearch', 'tableMatchesSearch']
        .map((name) => extractSource(js, name)).join('\n');
    const context = { tablesState: { search: '' } };
    vm.createContext(context);
    vm.runInContext(source, context);

    const hair = { name: 'Hair (she) +', bullets: [{ text: 'a tight bun || updo' }, { text: 'loose curls' }] };
    const eyes = { name: 'Eyes', bullets: [{ text: 'grey' }] };

    assert.equal(context.tableMatchesSearch(eyes), true, 'an empty search keeps everything');

    context.tablesState.search = '  CURLS ';
    assert.equal(context.tableMatchesSearch(hair), true);
    assert.equal(context.tableMatchesSearch(eyes), false);
    assert.equal(context.tableBulletMatchesSearch(hair, hair.bullets[0]), false);
    assert.equal(context.tableBulletMatchesSearch(hair, hair.bullets[1]), true);

    context.tablesState.search = 'updo';
    assert.equal(context.tableBulletMatchesSearch(hair, hair.bullets[0]), true, 'flags are searchable');

    context.tablesState.search = 'hair';
    assert.equal(context.tableMatchesSearch(hair), true);
    assert.ok(hair.bullets.every((b) => context.tableBulletMatchesSearch(hair, b)),
        'a table-name match keeps all of that table\'s bullets');
});
