const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

/*
 * The Add value form under the Tables tab's bullet list. There is no DOM
 * harness in this repo - see ui.rerollConfirm.test.js for why - so this pins
 * the shipped markup and app.js against the regressions that would matter:
 * the form posting somewhere other than the kind-aware route, pushing the
 * typed string instead of the server's stored bullet, or surviving a kind
 * switch with the previous kind's half-typed value.
 */

const PORT = 5262;

async function shipped(t) {
    const server = await startTestServer({ tablesText: '## Eyes\n- pale grey eyes\n', port: PORT });
    t.after(() => server.stop());
    const get = async (p) => {
        const res = await fetch(`${server.baseUrl}${p}`);
        assert.equal(res.status, 200, `${p} should be served`);
        return res.text();
    };
    return { html: await get('/index.html'), js: await get('/app.js'), css: await get('/style.css') };
}

test('the Tables tab ships an Add value form inside the bullet panel', async (t) => {
    const { html } = await shipped(t);
    const panel = html.slice(html.indexOf('class="table-bullet-panel"'), html.indexOf('id="chance-note"'));
    assert.match(panel, /<form class="table-add-form" id="table-add-form" hidden>/);
    assert.match(panel, /id="table-add-text"/);
    assert.match(panel, /id="table-add-weight"[^>]*min="1"/);
    assert.match(panel, /<button type="submit" id="table-add-btn" disabled>Add value<\/button>/);
});

test('an add posts the current kind to the add route and keeps the server\'s bullet', async (t) => {
    const { js } = await shipped(t);
    assert.match(js, /api\('\/api\/table-bullets\/add', \{/);
    assert.match(js, /body: JSON\.stringify\(\{ kind, table: tableName, text, weight \}\)/);
    // The server trims; the stored text is the id later toggles address.
    assert.match(js, /const \{ bullet \} = await api\('\/api\/table-bullets\/add'/);
    assert.match(js, /table\.bullets\.push\(bullet\);/);
});

test('the form hides with no table selected and resets on a kind switch', async (t) => {
    const { js } = await shipped(t);
    assert.match(js, /elTables\.addForm\.hidden = !table;/);
    const load = js.slice(js.indexOf('function beginTablesKindLoad('), js.indexOf("elTables.kindSelect.addEventListener('change'"));
    assert.match(load, /resetAddForm\(\);/);
    assert.match(load, /elTables\.addForm\.hidden = true;/);
});

test('the Add value form ships its styles', async (t) => {
    const { css } = await shipped(t);
    assert.match(css, /\.table-add-form\s*\{/);
    assert.match(css, /\.table-add-error\s*\{/);
});
