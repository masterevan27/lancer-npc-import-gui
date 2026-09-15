const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// The gate editor on the Tables tab: a panel above the bullets of a gated
// table (Gear, Headgear, Backdrop, Weapon) that says who each gate flag
// admits, and per-Role category controls on the Role table. Source
// assertions over app.js, index.html and style.css, as the other ui.* files.
const PORT = 5266;
const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

/** Pull one top-level function's source (brace-balanced) out of app.js, unevaluated. */
function extractSource(js, name) {
    const start = js.search(new RegExp(`(?:async )?function ${name}\\(`));
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

test('the tables panel carries a gate panel with a list, an add form and a reset', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const html = await fetchText(server, '/');
    for (const id of ['gate-panel', 'gate-list', 'gate-add-form', 'gate-add-name', 'gate-reset-btn', 'gate-error', 'gate-note']) {
        assert.match(html, new RegExp(`id="${id}"`), `index.html has no #${id}`);
    }
    // Hidden until a gated table is selected, so a kind without gates never shows it.
    assert.match(html, /id="gate-panel" hidden/);
    const css = await fetchText(server, '/style.css');
    assert.match(css, /\.gate-panel \{/);
    assert.match(css, /\.gate-row summary \{/);
    assert.match(css, /\.gate-role-controls \{/);
});

test('loadTables keeps the gates the server sends, and null for a kind without them', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const load = extractSource(js, 'loadTables');
    assert.match(load, /const \{ groups, flags, gates, capabilities \} = await api/);
    assert.match(load, /tablesState\.gates = gates \|\| null/);
});

test('the panel follows a variant to its base and a group to its parent', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const key = extractSource(js, 'gateMapKeyOf');
    assert.match(key, /gates\.tables\[base\]/);
    assert.match(key, /tablesState\.parents\[tableName\] \|\| tablesState\.parents\[base\]/);
    const render = extractSource(js, 'renderTableBullets');
    assert.match(render, /renderGatePanel\(table\)/, 'the panel is drawn with the bullets, for the selected table');
});

test('a gate row offers every category and every Role, with a Role implied by its category dimmed', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const row = extractSource(js, 'renderGateRow');
    assert.match(row, /for \(const \[bucket, roles\] of rolesByBucket\(\)\)/);
    assert.match(row, /const implied = bucketOn && categories\[role\] === bucket/);
    assert.match(row, /setGateMember\(key, flag, bucket, on\)/);
    assert.match(row, /setGateMember\(key, flag, role, on\)/);
    assert.match(row, /removeGate\(key, flag\)/);
});

test('a gate row lists an admitted name the Role table lacks, ticked, so it can be dropped', async (t) => {
    // The checkbox grid is built from the live Roles and categories, so a
    // stale name (a reworded Role) would otherwise be admitted invisibly:
    // in the summary text but in no box the user could untick.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const row = extractSource(js, 'renderGateRow');
    assert.match(row, /const stale = admitted\.filter\(/);
    assert.match(row, /Not in the Role table/);
});

test('a gate row that was open stays open across the reload a write causes', async (t) => {
    // Every write reloads the tab and rebuilds the panel; without this the
    // row the user is ticking boxes in would snap shut after each tick.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const row = extractSource(js, 'renderGateRow');
    assert.match(row, /row\.open = tablesState\.openGates\.has\(`\$\{key\}:\$\{flag\}`\)/);
    assert.match(row, /row\.addEventListener\(["']toggle["']/);
});

test('every gate edit is written whole to /api/gates and the tab reloads', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const write = extractSource(js, 'writeGates');
    assert.match(write, /api\(["']\/api\/gates["'],\s*\{/);
    assert.match(write, /body: JSON\.stringify\(\{ kind: tablesState\.kind, gates: nextMaps \}\)/);
    assert.match(write, /await loadTables\(\)/, 'flags, glosses and odds all change with a gate, so the tab reloads');
    assert.match(write, /Couldn't save that gate/);
    for (const fn of ['setGateMember', 'removeGate', 'addGate', 'setRoleCategory', 'setRoleUnaffiliated']) {
        assert.match(extractSource(js, fn), /writeGates\(maps\)/, `${fn} must go through writeGates`);
    }
    assert.match(js, /api\(["']\/api\/gates\/reset["'],\s*\{/);
});

test('a new gate name is checked before it is sent', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    assert.match(js, /const GATE_FLAG_RE = \/\^\[a-z\]\[a-z0-9_-\]\*\$\//);
    const add = extractSource(js, 'addGate');
    assert.match(add, /GATE_FLAG_RE\.test\(flag\)/);
    assert.match(add, /is already a gate on this table/);
    assert.match(add, /is already a flag this table reads/);
});

test('a Role row carries its category select and a works-for-nobody box', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const flags = extractSource(js, 'renderBulletFlags');
    assert.match(flags, /isRoleTable\(table\.name\) && tablesState\.gates/);
    assert.match(flags, /renderRoleGateControls\(bulletBody\(table\.name, bullet\.text\)\)/);
    const controls = extractSource(js, 'renderRoleGateControls');
    assert.match(controls, /fresh\.value = ["']__new__["']/);
    assert.match(controls, /setRoleCategory\(role, bucket\)/);
    assert.match(controls, /setRoleUnaffiliated\(role, on\)/);
});
