const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { startTestServer } = require('./helpers/testServer');

test('Secret authentication protects catalog, files, jobs, and settings', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-api-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const privateDir = path.join(root, 'private'); fs.mkdirSync(privateDir);
    const sharedBackgrounds = path.join(root, 'shared'); fs.mkdirSync(sharedBackgrounds);
    const salt = '0123456789abcdef0123456789abcdef';
    const passwordHash = `scrypt$${salt}$${crypto.scryptSync('test-password', salt, 64).toString('hex')}`;
    const catalog = path.join(root, 'styles.json');
    fs.writeFileSync(catalog, JSON.stringify({ styles: [
        { id: 'ink', name: 'Ink', prompt: 'ink', hidden: false },
        { id: 'hidden', name: 'Hidden name', prompt: 'private prompt', hidden: true },
    ] }));
    const server = await startTestServer({ tablesText: '## Gear\n- a tool\n', port: 5291,
        generatorSource: '/*\nREROLLABLE_TRAITS = ("Gear",)\n*/\nconsole.log(process.argv.slice(2).join(" "));',
        extraConfig: { artStylesPath: catalog, secretImagesDir: privateDir, sillyTavernBackgroundsDir: sharedBackgrounds, secretMode: { username: 'tester', passwordHash } } });
    t.after(() => server.stop());
    let cookie = '';
    const call = (route, body, authenticated = false, extra = {}) => fetch(server.baseUrl + route, {
        method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}), ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.deepEqual(await (await call('/api/secret/session')).json(), { authenticated: false, configured: true });
    const publicCatalog = await (await call('/api/art-styles')).json();
    assert.deepEqual(publicCatalog.styles.map(s => s.id), ['default', 'none', 'ink']);
    assert.equal(JSON.stringify(publicCatalog).includes('prompt'), false);
    for (const route of ['/items', '/image?id=x', '/create-status?jobId=x', '/settings', '/backgrounds']) {
        assert.equal((await call('/api/secret' + route)).status, 401, route);
    }
    assert.equal((await call('/api/create', { artStyle: 'hidden', dryRun: true })).status, 400);
    assert.equal((await call('/api/settings', {})).status, 401);
    assert.equal((await call('/api/secret/login', { username: 'tester', password: 'bad' })).status, 401);
    assert.equal((await call('/api/secret/login', { username: 'tester', password: 'test-password' }, false, { Origin: 'https://evil.test' })).status, 403);
    const login = await call('/api/secret/login', { username: 'tester', password: 'test-password' });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /HttpOnly.*SameSite=Strict/);
    cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await call('/api/art-styles', undefined, true)).json()).styles.length, 4);
    const folder = path.join(privateDir, 'npcs', 'Private'); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'portrait.png'), 'private image');
    const entry = { id: 'private-id', name: 'Private', kind: 'npc', seed: 23, traits: { Gear: 'tool' }, portrait: 'portrait.png', secret: true, art_style: { id: 'hidden', name: 'Hidden name' } };
    fs.writeFileSync(path.join(privateDir, 'manifest.json'), JSON.stringify({ [folder]: entry }));
    const itemsRes = await call('/api/secret/items', undefined, true);
    assert.equal(itemsRes.headers.get('cache-control'), 'no-store');
    const items = (await itemsRes.json()).items;
    assert.equal(items[0].artStyle.id, 'hidden');
    assert.deepEqual(items[0].rerollable, ['Gear']);
    assert.equal(await (await call(items[0].portraitUrl, undefined, true)).text(), 'private image');
    // Even a public manifest accidentally referencing private files is excluded.
    fs.writeFileSync(server.manifestPath, JSON.stringify({ [folder]: { ...entry, secret: false } }));
    assert.equal(JSON.stringify(await (await call('/api/items')).json()).includes('private-id'), false);
    assert.equal((await call('/api/image?id=private-id&which=portrait')).status, 404);
    const publicBackgrounds = path.join(server.dir, 'output', 'backgrounds');
    fs.mkdirSync(publicBackgrounds, { recursive: true });
    fs.symlinkSync(privateDir, path.join(publicBackgrounds, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await call('/api/backgrounds/image?rel=linked/npcs/Private/portrait.png')).status, 404);
    const linkedRel = 'linked/npcs/Private/portrait.png';
    assert.equal((await call('/api/backgrounds/import', { rel: linkedRel })).status, 404);
    assert.equal((await call('/api/backgrounds/animate', { rel: linkedRel, description: 'move', seedMode: 'random' })).status, 404);
    const privateBgId = require('../lib/backgrounds').idFor(linkedRel);
    const deletion = await (await call('/api/delete', { ids: [privateBgId] })).json();
    assert.equal(deletion.results[0].deleted, false);
    assert.ok(fs.existsSync(path.join(folder, 'portrait.png')));
    fs.writeFileSync(path.join(publicBackgrounds, 'Ordinary.png'), 'ordinary');
    assert.equal(await (await call('/api/backgrounds/image?rel=Ordinary.png', undefined, true)).text(), 'ordinary');
    fs.symlinkSync(path.join(folder, 'portrait.png'), path.join(publicBackgrounds, 'Ordinary Animated.webp'), 'file');
    assert.equal((await call('/api/backgrounds/import', { rel: 'Ordinary.png' })).status, 404);
    assert.deepEqual(fs.readdirSync(sharedBackgrounds), []);
    assert.equal((await call('/api/secret/image?rel=../styles.json', undefined, true)).status, 404);
    const created = await (await call('/api/secret/create', { artStyle: 'hidden', dryRun: true, count: 1 }, true)).json();
    assert.ok(created.jobId);
    assert.equal((await call('/api/create-status?jobId=' + created.jobId)).status, 404);
    let job;
    for (let i = 0; i < 50; i++) {
        job = await (await call('/api/secret/create-status?jobId=' + created.jobId, undefined, true)).json();
        if (job.status !== 'running') break;
        await new Promise(r => setTimeout(r, 40));
    }
    assert.match(job.log, /--secret --secret-config/);
    assert.match(job.log, /--art-style hidden/);
    assert.equal((await call('/api/secret/reroll-trait', { id: 'private-id', trait: 'Gear' })).status, 401);
    assert.equal((await call('/api/secret/reroll-trait', { id: 'private-id', trait: 'Unknown' }, true)).status, 400);
    const rerollResponse = await call('/api/secret/reroll-trait', { id: 'private-id', trait: 'Gear' }, true);
    assert.equal(rerollResponse.status, 202);
    const reroll = await rerollResponse.json();
    for (let i = 0; i < 50; i++) {
        job = await (await call('/api/secret/create-status?jobId=' + reroll.jobId, undefined, true)).json();
        if (job.status !== 'running') break;
        await new Promise(r => setTimeout(r, 40));
    }
    assert.match(job.log, /--reroll-trait Gear --apply-only/);
    assert.ok(job.log.includes('--regen-manifest ' + path.join(privateDir, 'manifest.json')));
    assert.match(job.log, /--art-style hidden/);
    assert.match(job.log, /--secret --secret-config/);
    assert.equal((await call('/api/secret/regenerate', { id: 'public-id' }, true)).status, 404);
    const autoPrivate = await (await call('/api/create', { dryRun: true }, true)).json();
    assert.equal(autoPrivate.secret, true);
    assert.equal((await call('/api/create-status?jobId=' + autoPrivate.jobId)).status, 404);
    assert.equal((await call('/api/import', { ids: ['private-id'] }, true)).status, 403);
    assert.equal((await call('/api/settings', { values: { backgroundsDir: privateDir } }, true)).status, 400);
    assert.equal((await call('/api/secret/settings', { secretImagesDir: path.join(server.dir, 'FoundryData', 'private') }, true)).status, 400);
    const publicFolder = path.join(server.dir, 'public-npc'); fs.mkdirSync(publicFolder);
    fs.writeFileSync(path.join(publicFolder, 'portrait.png'), 'public ink');
    fs.writeFileSync(server.manifestPath, JSON.stringify({ [publicFolder]: { ...entry, id: 'ink-id', secret: false, art_style: { id: 'ink', name: 'Ink' } } }));
    assert.equal((await call('/api/image?id=ink-id&which=portrait')).status, 200);
    fs.writeFileSync(path.join(publicBackgrounds, 'Ink.png'), 'ink background');
    fs.writeFileSync(path.join(publicBackgrounds, 'Ink.background.json'), JSON.stringify({ kind: 'background', art_style: { id: 'ink', name: 'Ink' } }));
    assert.equal((await call('/api/backgrounds/image?rel=Ink.png')).status, 200);
    fs.writeFileSync(catalog, JSON.stringify({ styles: [{ id: 'ink', name: 'Ink', prompt: 'ink', hidden: true }] }));
    assert.equal((await call('/api/image?id=ink-id&which=portrait')).status, 404);
    assert.equal((await call('/api/backgrounds/image?rel=Ink.png')).status, 404);
    assert.equal((await call('/api/secret/logout', {}, true)).status, 200);
    assert.equal((await call('/api/secret/items', undefined, true)).status, 401);
});

test('private dynamic generation keeps its style, files and logs in the protected gallery', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-dynamic-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const privateDir = path.join(root, 'private'), script = path.join(root, 'generator.js'), tables = path.join(root, 'tables.md');
    fs.writeFileSync(tables, '## Location\n- hangar\n');
    fs.writeFileSync(script, `const fs=require('node:fs'),path=require('node:path'); const a=process.argv.slice(2), value=k=>a[a.indexOf(k)+1];
      let text=''; process.stdin.on('data',c=>text+=c); process.stdin.on('end',()=>{
        if(a.includes('--preview')) { console.log(JSON.stringify({plans:[{prompt:'private preview',artStyle:value('--art-style')}]})); return; }
        const output=path.join(value('--output-dir'),'test.png'); fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,'PRIVATE PNG');
        fs.writeFileSync(output.replace('.png','.background.json'),JSON.stringify({kind:'background',art_style:{id:value('--art-style'),name:'Ink'},secret:true}));
        console.log('PRIVATE LOG '+a.join(' ')); console.log('BACKGROUND_RESULT '+JSON.stringify({path:output}));
      });`);
    const catalog = path.join(root, 'styles.json'); fs.writeFileSync(catalog, JSON.stringify({ styles: [{ id: 'ink', name: 'Ink', prompt: 'ink' }] }));
    const { hashPassword } = require('../lib/secretMode');
    const server = await startTestServer({ tablesText: '## Gear\n- tool\n', port: 5291, extraConfig: {
        pythonExecutable: process.execPath, generateBackgroundScript: script, dynamicBackgroundTablesPath: tables,
        artStylesPath: catalog, secretImagesDir: privateDir, secretMode: { username: 'test', passwordHash: hashPassword('password') },
    } }); t.after(() => server.stop());
    const workflowDir = path.join(server.dir, 'workflows', 'api', 'secret'); fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, 'Scene.json'), JSON.stringify({ '1': { class_type: 'SaveImage', inputs: {} } }));
    let cookie;
    const call = (route, body) => fetch(server.baseUrl + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const login = await call('/api/secret/login', { username: 'test', password: 'password' }); cookie = login.headers.get('set-cookie').split(';')[0];
    const response = await call('/api/secret/backgrounds/dynamic/render', { environment: 'indoor', artStyle: 'ink', workflow: 'secret/Scene.json' });
    assert.equal(response.status, 202); const { jobId } = await response.json();
    let job;
    for (let i = 0; i < 50; i++) { job = await (await call('/api/secret/backgrounds/status?jobId=' + jobId)).json(); if (job.status !== 'running') break; await new Promise(r => setTimeout(r, 40)); }
    assert.equal(job.status, 'done'); assert.equal(job.produced, 1);
    assert.match(job.log, /--art-style ink/); assert.match(job.log, /--secret --secret-config/);
    assert.ok(job.log.includes('--workflow ' + path.join(workflowDir, 'Scene.json')));
    const gallery = await (await call('/api/secret/items')).json();
    assert.equal(gallery.items[0].artStyle.id, 'ink');
    assert.equal(await (await call(gallery.items[0].portraitUrl)).text(), 'PRIVATE PNG');
    assert.equal(await (await call(job.outputs[0].url)).text(), 'PRIVATE PNG');
    cookie = '';
    assert.equal((await call('/api/backgrounds/status?jobId=' + jobId)).status, 404);
    assert.equal((await call(gallery.items[0].portraitUrl)).status, 401);
});
