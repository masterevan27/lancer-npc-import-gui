const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');
const { hashPassword } = require('../lib/secretMode');

test('private trait choices and edits use the private manifest and preserve public NPCs', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-traits-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const folder = path.join(root, 'npc');
    fs.mkdirSync(folder);
    const manifestPath = path.join(root, 'manifest.json');
    const guidancePath = path.join(root, 'guidance.json');
    fs.writeFileSync(guidancePath, JSON.stringify({ guidance: [{ id: 'private-palette', name: 'Private palette', prompt: 'Use blue.', hidden: true }] }));
    const entry = { id: 'same-id', name: 'Private NPC', kind: 'npc', seed: 19,
        traits: { Outfit: 'jacket' }, rawTraits: { Outfit: 'jacket || civ' }, secret: true,
        color_guidance: { id: 'private-palette', name: 'Private palette' } };
    fs.writeFileSync(manifestPath, JSON.stringify({ [folder]: entry }));
    const choices = { trait: 'Outfit', dependents: ['Headgear'], choices: [
        { value: 'jacket || civ', heading: 'Outfit', allowed: true, current: true, conflicts: [], releases: [] },
        { value: 'robe || civ', heading: 'Outfit', allowed: true, current: false, conflicts: ['Headgear'], releases: ['Headgear'] },
    ] };
    const generatorSource = `/*
REQUIRED_TABLES = ["Given names", "Pronouns", "Outfit", "Headgear"]
REROLLABLE_TRAITS = ("Outfit",)
RAW_REROLLABLE_TRAITS = tuple(name for name in REQUIRED_TABLES if name not in ("Given names", "Pronouns"))
*/
const fs = require('node:fs');
const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
fs.appendFileSync(__dirname + '/argv.jsonl', JSON.stringify(args) + '\\n');
if (args.includes('--trait-choices')) console.log(${JSON.stringify(JSON.stringify(choices))});
else if (args.includes('--apply-only')) {
    const file = value('--regen-manifest'), data = JSON.parse(fs.readFileSync(file));
    const npc = Object.values(data).find(item => item.id === value('--regen-id'));
    npc.traits.Outfit = 'robe'; npc.rawTraits.Outfit = 'robe || civ';
    npc.portraitPrompt = 'wearing a robe'; npc.artStale = true;
    fs.writeFileSync(file, JSON.stringify(data));
}`;
    const server = await startTestServer({ port: 5297, tablesText: '## Outfit\n- jacket || civ\n- robe || civ\n',
        generatorSource, manifest: { public: { ...entry, secret: false, name: 'Public NPC' } },
        extraConfig: { secretImagesDir: root, colorGuidancePath: guidancePath, secretMode: { username: 'test', passwordHash: hashPassword('password') } } });
    t.after(() => server.stop());
    let cookie = '';
    const call = (route, body) => fetch(server.baseUrl + route, { method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const route = '/api/secret/trait-choices?id=same-id&trait=Outfit';
    assert.equal((await call(route)).status, 401);
    assert.equal((await call('/api/secret/set-trait', { id: entry.id, trait: 'Outfit', value: 'robe || civ' })).status, 401);
    const login = await call('/api/secret/login', { username: 'test', password: 'password' });
    cookie = login.headers.get('set-cookie').split(';')[0];
    const response = await call(route);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).choices[1].value, 'robe || civ');
    const items = (await (await call('/api/secret/items')).json()).items;
    assert.equal(items[0].hasRawTraits, true);
    assert.equal((await call('/api/secret/trait-choices?id=unknown&trait=Outfit')).status, 404);
    assert.equal((await call('/api/secret/trait-choices?id=same-id&trait=Pronouns')).status, 400);
    for (const edit of [{ value: 'invented' }, { value: 'robe || civ', release: ['Gear'] }]) {
        assert.equal((await call('/api/secret/set-trait', { id: entry.id, trait: 'Outfit', ...edit })).status, 400);
    }
    const publicBefore = fs.readFileSync(server.manifestPath, 'utf8');
    const editResponse = await call('/api/secret/set-trait', { id: entry.id, trait: 'Outfit', value: 'robe || civ', release: ['Headgear'] });
    assert.equal(editResponse.status, 202);
    const { jobId } = await editResponse.json();
    let job;
    for (let i = 0; i < 50; i++) {
        job = await (await call('/api/secret/create-status?jobId=' + jobId)).json();
        if (job.status !== 'running') break;
        await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.equal(job.status, 'done');
    assert.equal(fs.readFileSync(server.manifestPath, 'utf8'), publicBefore);
    const updated = (await (await call('/api/secret/items')).json()).items[0];
    assert.equal(updated.traits.Outfit, 'robe');
    assert.equal(updated.portraitPrompt, 'wearing a robe');
    assert.equal(updated.artStale, true);
    assert.equal(updated.colorGuidance.id, 'private-palette');
    const created = await call('/api/secret/create', { dryRun: true, overrides: [{ table: 'Outfit', value: 'robe || civ' }] });
    assert.equal(created.status, 202);
    const createJob = await created.json();
    for (let i = 0; i < 50; i++) {
        job = await (await call('/api/secret/create-status?jobId=' + createJob.jobId)).json();
        if (job.status !== 'running') break;
        await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.equal(job.status, 'done');
    const commands = fs.readFileSync(path.join(server.dir, 'argv.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    for (const args of commands.filter(args => args.includes('--trait-choices') || args.includes('--apply-only'))) {
        assert.equal(args[args.indexOf('--regen-manifest') + 1], manifestPath);
        assert.equal(args[args.indexOf('--tables') + 1], server.tablesPath);
        assert.ok(args.includes('--secret'), 'private manifest reads require explicit secret mode');
        assert.equal(args[args.indexOf('--secret-config') + 1], path.join(server.dir, 'config.json'));
        assert.equal(args[args.indexOf('--color-guidance-catalog') + 1], guidancePath);
    }
    const applied = commands.find(args => args.includes('--apply-only'));
    assert.equal(applied[applied.indexOf('--set-trait') + 1], 'Outfit=robe || civ');
    assert.equal(applied[applied.indexOf('--release-trait') + 1], 'Headgear');
    assert.ok(applied.includes('--secret'));
    assert.equal(applied.includes('--color-guidance'), false, 'keep the saved guidance rather than selecting Default');
    assert.ok(commands.at(-1).includes('Outfit=robe || civ'));
    fs.writeFileSync(manifestPath, JSON.stringify({ [folder]: { ...entry, rawTraits: {} } }));
    assert.equal((await call(route)).status, 400);
    assert.equal((await call('/api/secret/set-trait', { id: entry.id, trait: 'Outfit', value: 'robe || civ' })).status, 400);
});
