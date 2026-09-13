const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

// The Settings dialog reads and writes the server's own config.json. The test
// server's config lives in its tmp dir (IMPORT_GUI_CONFIG), so these writes
// never reach the real file.
const PORT = 5260;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

function post(server, body) {
    return fetch(`${server.baseUrl}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

test('GET /api/settings describes the file without leaking the secret', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, extraConfig: { secret: 'hunter2' },
    });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/settings`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('hunter2'), 'the secret was sent to the browser');
    const view = JSON.parse(text);
    assert.equal(view.secretSet, true);
    assert.equal(view.values.port, String(PORT));
    assert.equal(view.restartRequired, false);
    assert.equal(view.canSave, true, 'a loopback request should be allowed to save');
    assert.ok(view.groups.some((g) => g.fields.some((f) => f.key === 'foundryDataRoot')));
});

test('POST /api/settings writes config.json, keeps other keys, and flags a restart', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const configPath = path.join(server.dir, 'config.json');
    const before = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const res = await post(server, { values: { traitOddsSamples: '8000', pythonExecutable: 'py' } });
    assert.equal(res.status, 200);
    const view = await res.json();
    assert.equal(view.restartRequired, true);

    const after = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(after.traitOddsSamples, 8000);
    assert.equal(after.pythonExecutable, 'py');
    assert.equal(after.npcTablesPath, before.npcTablesPath, 'a key the form did not send was lost');
    assert.ok(fs.existsSync(`${configPath}.bak`));

    // Still the running config until restart: GET agrees a restart is pending.
    const again = await (await fetch(`${server.baseUrl}/api/settings`)).json();
    assert.equal(again.restartRequired, true);
    assert.equal(again.values.traitOddsSamples, '8000');
});

test('POST /api/settings refuses invalid values and leaves the file alone', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const configPath = path.join(server.dir, 'config.json');
    const before = fs.readFileSync(configPath, 'utf8');

    const res = await post(server, { values: { foundryDataRoot: '', port: 'abc' } });
    assert.equal(res.status, 400);
    const { fieldErrors } = await res.json();
    assert.deepEqual(Object.keys(fieldErrors).sort(), ['foundryDataRoot', 'port']);
    assert.equal(fs.readFileSync(configPath, 'utf8'), before);
});

test('POST /api/settings will not overwrite a config.json it cannot parse', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const configPath = path.join(server.dir, 'config.json');
    fs.writeFileSync(configPath, '{ not json');

    const res = await post(server, { values: { host: '0.0.0.0' } });
    assert.equal(res.status, 409);
    assert.equal(fs.readFileSync(configPath, 'utf8'), '{ not json');
});

test('the page ships a Settings button and dialog wired to /api/settings', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await (await fetch(`${server.baseUrl}/`)).text();
    assert.ok(html.includes('id="settings-open"'), 'no Settings button in the top bar');
    assert.ok(html.includes('id="settings-overlay"'), 'no Settings dialog');
    const tabs = html.slice(html.indexOf('id="tabs"'), html.indexOf('</nav>'));
    assert.ok(!tabs.includes('settings-open'), 'the Settings button must not be inside #tabs');

    const js = await (await fetch(`${server.baseUrl}/app.js`)).text();
    assert.ok(js.includes("'/api/settings'"), 'app.js never calls /api/settings');
    assert.ok(js.includes('elSettings.overlay.hidden'), 'Esc does not know about the Settings dialog');
});
