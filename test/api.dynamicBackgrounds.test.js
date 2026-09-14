const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');
const { derivePaths } = require('../lib/paths');
const { buildKinds } = require('../lib/kinds');

test('dynamic paths follow overrides and backgrounds have a tables-only registry entry', () => {
    const p = derivePaths({ npcManifestPath: '/gen/manifest.json', generateNpcScript: '/moved/generate-npc.py', npcTablesPath: '/tables/npc.md' });
    assert.equal(p.generateBackgroundScript, path.join('/moved', 'generate-background.py'));
    assert.equal(p.dynamicBackgroundTablesPath, path.join('/tables', 'background-generator-tables.md'));
    assert.equal(buildKinds(p, {}).background.supports.tables, true);
    assert.equal(buildKinds(p, {}).background.supports.create, false);
});

test('dynamic API works without bespoke catalogues and exposes metadata/maps in the gallery', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-bg-api-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const script = path.join(root, 'generator.js'), tables = path.join(root, 'tables.md');
    fs.writeFileSync(tables, '## Location\n- hangar || indoor\n');
    fs.writeFileSync(script, `const args=process.argv.slice(2);
      if(args.includes('--catalogue'))console.log(JSON.stringify({environments:['indoor'],tables:[]}));
      else {let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>console.log(JSON.stringify({plans:[{...JSON.parse(s),prompt:'scene preview'}]})));}`);
    const server = await startTestServer({ tablesText: '## Pronouns\n- she/her/her/woman\n', port: 5349,
        extraConfig: { pythonExecutable: process.execPath, generateBackgroundScript: script, dynamicBackgroundTablesPath: tables,
            backgroundsDir: root, backgroundPromptsDir: path.join(root, 'missing') } });
    t.after(() => server.stop());
    const get = async (url) => { const r = await fetch(server.baseUrl + url); return { status: r.status, body: await r.json() }; };
    let result = await get('/api/backgrounds/dynamic/catalogue');
    assert.equal(result.status, 200); assert.deepEqual(result.body.environments, ['indoor']);
    const preview = await fetch(server.baseUrl + '/api/backgrounds/dynamic/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ environment: 'indoor', seed: 42 }) });
    assert.equal(preview.status, 200); assert.equal((await preview.json()).plans[0].seed, 42);
    const invalid = await fetch(server.baseUrl + '/api/backgrounds/dynamic/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"count":999}' });
    assert.equal(invalid.status, 400);
    const still = path.join(root, 'Hangar.png'); fs.writeFileSync(still, 'PNG');
    fs.writeFileSync(path.join(root, 'Hangar.background.json'), JSON.stringify({ kind: 'background', seed: 42, traits: { Location: 'hangar || indoor' } }));
    fs.writeFileSync(path.join(root, 'Hangar Battlemap-1.png'), 'PNG');
    fs.writeFileSync(path.join(root, 'Hangar Battlemap-1.background.json'), JSON.stringify({ kind: 'battlemap', source: { path: still, mtime: 0 } }));
    result = await get('/api/backgrounds');
    assert.equal(result.body.available, true); assert.equal(result.body.dynamicAvailable, true);
    assert.equal(result.body.items.length, 1); assert.equal(result.body.items[0].scene.seed, 42);
    assert.equal(result.body.items[0].battlemaps.length, 1);
    const html = await (await fetch(server.baseUrl + '/index.html')).text();
    for (const id of ['bg-mode', 'bg-dynamic-traits', 'bg-dynamic-preview', 'bg-map-btn']) assert.ok(html.includes(`id="${id}"`), id);
});
