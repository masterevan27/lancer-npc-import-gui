const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/*
 * The Secret tables section of Create NPC. The section's picks travel in
 * the create body through secret-mode.js's request router rather than
 * app.js's createRequestBody(), so the public form stays unaware of them;
 * the router is a pure function and is tested as one. The rest is pinned
 * against the shipped markup and script, the way ui.tableFlags does.
 */

const ui = () => require('../public/secret-mode');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');

test('a logged-in NPC create carries the section picks; ships and the public form do not', () => {
    const picks = { extraTables: [{ file: 'a.json', tables: ['one'] }], disabledTables: ['Stance'] };
    const options = { method: 'POST', body: JSON.stringify({ count: 1 }) };
    const npc = ui().routeRequest('/api/create-npc', options, true, { npc: 'ink', secretTables: picks });
    assert.equal(npc.path, '/api/secret/create');
    assert.deepEqual(JSON.parse(npc.options.body), { count: 1, kind: 'npc', artStyle: 'ink', ...picks });

    const ship = ui().routeRequest('/api/create', { method: 'POST', body: '{"kind":"spaceship"}' }, true, { secretTables: picks });
    assert.deepEqual(JSON.parse(ship.options.body), { kind: 'spaceship', artStyle: 'default' });

    const loggedOut = ui().routeRequest('/api/create-npc', options, false, { npc: 'ink', secretTables: picks });
    assert.equal(loggedOut.path, '/api/create-npc');
    assert.deepEqual(JSON.parse(loggedOut.options.body), { count: 1, artStyle: 'ink' });

    // The section is hidden (null picks) until login populates it.
    const hidden = ui().routeRequest('/api/create-npc', options, true, { npc: 'ink', secretTables: null });
    assert.deepEqual(JSON.parse(hidden.options.body), { count: 1, kind: 'npc', artStyle: 'ink' });
});

test('the markup ships the section hidden, inside the Create NPC form after the overrides', () => {
    const html = read('index.html');
    const section = html.indexOf('id="secret-tables-section"');
    assert.notEqual(section, -1);
    assert.match(html.slice(section, section + 60), /hidden/);
    assert.ok(section > html.indexOf('id="add-override"'));
    assert.ok(section < html.indexOf('id="create-preset-select"'));
    for (const id of ['secret-tables-files', 'secret-tables-status', 'secret-disable-tables']) {
        assert.ok(html.includes(`id="${id}"`), id);
    }
});

test('secret-mode.js fills the section from the private listing and empties it on logout', () => {
    const js = read('secret-mode.js');
    assert.match(js, /json\('\/api\/secret\/tables'\)/);
    assert.match(js, /data-secret-table|dataset\.secretTable/);
    assert.match(js, /dataset\.disableTable/);
    const clear = js.slice(js.indexOf('function clearPrivateView'), js.indexOf('function expire'));
    assert.match(clear, /secret-tables-files/);
    assert.match(clear, /secret-tables-section'\)\.hidden = true/);
    // The detail sheet shows the private values and marks a switched-off default.
    assert.match(js, /item\.extraTraits/);
    assert.match(js, /item\.disabledTables/);
});
