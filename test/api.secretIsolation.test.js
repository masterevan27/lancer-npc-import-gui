const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');
const { hashPassword } = require('../lib/secretMode');

const PORT = 5292;

async function fixture(t, configured = true) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-isolation-'));
    const privateDir = path.join(root, 'private');
    const backgroundsDir = path.join(root, 'public-backgrounds');
    const stagedRefsDir = path.join(root, 'public-refs');
    const stagedImportsDir = path.join(root, 'public-staging');
    for (const dir of [privateDir, backgroundsDir, stagedRefsDir, stagedImportsDir]) fs.mkdirSync(dir);
    const catalog = path.join(root, 'styles.json');
    fs.writeFileSync(catalog, JSON.stringify({ styles: [
        { id: 'hidden', name: 'Hidden style name', prompt: 'HIDDEN_PROMPT_SENTINEL', hidden: true },
    ] }));
    const backgroundScript = path.join(root, 'background.js');
    const marker = path.join(root, 'background-invoked');
    fs.writeFileSync(backgroundScript, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'invoked'); console.log('{}');`);
    const tables = path.join(root, 'background-tables.md');
    fs.writeFileSync(tables, '## Environment\n- city\n');
    const links = [];
    let server;
    t.after(async () => {
        // Unlink junctions before either fixture directory is removed.
        for (const link of links) if (fs.existsSync(link)) fs.unlinkSync(link);
        if (server) await server.stop();
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(root, { recursive: true, force: true });
    });
    server = await startTestServer({
        tablesText: '## Gear\n- a tool\n', port: PORT,
        generatorSource: 'console.log("PRIVATE_JOB_SENTINEL");',
        extraConfig: {
            artStylesPath: catalog, secretImagesDir: privateDir, backgroundsDir,
            stagedRefsDir, stagedImportsDir, generateBackgroundScript: backgroundScript,
            dynamicBackgroundTablesPath: tables,
            ...(configured ? { secretMode: { username: 'tester', passwordHash: hashPassword('test-password') } } : {}),
        },
    });
    const call = (route, body, cookie = '', headers = {}) => fetch(server.baseUrl + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const login = async () => {
        const response = await call('/api/secret/login', { username: 'tester', password: 'test-password' });
        assert.equal(response.status, 200);
        await response.text();
        return response.headers.get('set-cookie').split(';')[0];
    };
    const link = (target, destination) => {
        fs.symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
        links.push(destination);
    };
    return { root, privateDir, backgroundsDir, stagedRefsDir, stagedImportsDir, marker, catalog, server, call, login, link };
}

test('public file routes reject junctions into private storage', async (t) => {
    const f = await fixture(t);
    fs.writeFileSync(path.join(f.privateDir, 'portrait.png'), 'PRIVATE_IMAGE_SENTINEL');
    f.link(f.privateDir, path.join(f.backgroundsDir, 'linked'));
    f.link(f.privateDir, path.join(f.stagedRefsDir, 'run'));
    fs.writeFileSync(path.join(f.stagedImportsDir, 'run.json'), JSON.stringify({
        entries: [{ id: 'candidate', source_image: 'portrait.png', table: 'Gear', bullet: 'a tool' }],
    }));

    for (const route of [
        '/api/backgrounds/image?rel=linked/portrait.png',
        '/api/trait-image?file=run.json&id=candidate',
    ]) {
        await t.test(route, async () => {
            const response = await f.call(route);
            assert.ok([400, 403, 404].includes(response.status), `private file leaked with HTTP ${response.status}`);
            assert.equal((await response.text()).includes('PRIVATE_IMAGE_SENTINEL'), false);
        });
    }

    const publicFolder = path.join(f.root, 'public-npc'); fs.mkdirSync(publicFolder);
    f.link(f.privateDir, path.join(publicFolder, 'linked'));
    fs.writeFileSync(f.server.manifestPath, JSON.stringify({ [publicFolder]: {
        id: 'linked-npc', kind: 'npc', name: 'Linked', portrait: 'linked/portrait.png',
    } }));
    assert.equal((await f.call('/api/image?id=linked-npc&which=portrait')).status, 404);
    const listed = await f.call('/api/items?category=npc');
    assert.equal(listed.status, 200);
    assert.equal((await listed.text()).includes('linked-npc'), false);

    const cookie = await f.login();
    const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'outside.png'), 'OUTSIDE_IMAGE_SENTINEL');
    f.link(outside, path.join(f.privateDir, 'escape'));
    assert.equal((await f.call('/api/secret/image?rel=escape/outside.png', undefined, cookie)).status, 404);
    const inside = await f.call('/api/secret/image?rel=portrait.png', undefined, cookie);
    assert.equal(await inside.text(), 'PRIVATE_IMAGE_SENTINEL');
    assert.equal(inside.headers.get('cache-control'), 'no-store');
});

test('private settings cannot expose output through public roots', async (t) => {
    const f = await fixture(t);
    const cookie = await f.login();
    assert.equal((await f.call('/api/settings', { values: { backgroundsDir: f.privateDir } })).status, 401);
    for (const settings of [
        { backgroundsDir: f.privateDir }, { stagedRefsDir: f.privateDir },
        { npcManifestPath: path.join(f.privateDir, 'manifest.json') },
    ]) assert.equal((await f.call('/api/settings', { values: settings }, cookie)).status, 400, Object.keys(settings)[0]);
    assert.equal((await f.call('/api/secret/settings', { secretImagesDir: f.stagedRefsDir }, cookie)).status, 400);
    const alias = path.join(f.root, 'public-alias'); f.link(f.backgroundsDir, alias);
    assert.equal((await f.call('/api/secret/settings', { secretImagesDir: path.join(alias, 'nested') }, cookie)).status, 400);
});

test('public backgrounds do not expose private metadata through a sidecar symlink', async (t) => {
    const f = await fixture(t);
    fs.writeFileSync(path.join(f.backgroundsDir, 'scene.png'), 'public image');
    const privateMetadata = path.join(f.privateDir, 'scene.background.json');
    fs.writeFileSync(privateMetadata, JSON.stringify({
        kind: 'background', secret: true, prompt: 'PRIVATE_METADATA_SENTINEL',
        art_style: { id: 'hidden', name: 'Hidden style name' },
    }));
    const sidecar = path.join(f.backgroundsDir, 'scene.background.json');
    try { fs.symlinkSync(privateMetadata, sidecar, 'file'); }
    catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('File symlinks are unavailable on this platform');
        throw error;
    }
    t.after(() => { if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar); });
    const response = await f.call('/api/items?category=background');
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(body.includes('PRIVATE_METADATA_SENTINEL'), false);
    assert.equal(body.includes('Hidden style name'), false);
});

test('removing credentials preserves private settings isolation', async (t) => {
    const f = await fixture(t, false);
    assert.deepEqual(await (await f.call('/api/secret/session')).json(), { authenticated: false, configured: false });
    assert.equal((await f.call('/api/settings', { values: { backgroundsDir: f.privateDir } })).status, 401);
    assert.equal((await f.call('/api/secret/settings', { secretImagesDir: f.backgroundsDir })).status, 401);
});

test('making a style hidden suppresses existing public items and direct images', async (t) => {
    const f = await fixture(t);
    const style = { id: 'ink', name: 'Ink style', prompt: 'INK_PROMPT_SENTINEL', hidden: false };
    fs.writeFileSync(f.catalog, JSON.stringify({ styles: [style] }));
    const folder = path.join(f.root, 'public-npc'); fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'portrait.png'), 'PUBLIC_NPC_IMAGE');
    fs.writeFileSync(f.server.manifestPath, JSON.stringify({ [folder]: {
        id: 'styled-npc', kind: 'npc', name: 'Styled NPC', portrait: 'portrait.png',
        art_style: { id: style.id, name: style.name }, portraitPrompt: style.prompt,
    } }));
    fs.writeFileSync(path.join(f.backgroundsDir, 'styled.png'), 'PUBLIC_BACKGROUND_IMAGE');
    fs.writeFileSync(path.join(f.backgroundsDir, 'styled.background.json'), JSON.stringify({
        kind: 'background', prompt: style.prompt, art_style: { id: style.id, name: style.name },
    }));
    for (const category of ['npc', 'background']) {
        const before = await f.call('/api/items?category=' + category);
        assert.equal(before.status, 200);
        assert.equal((await before.text()).includes('Ink style'), true, category);
    }
    assert.equal((await f.call('/api/image?id=styled-npc&which=portrait')).status, 200);
    assert.equal((await f.call('/api/backgrounds/image?rel=styled.png')).status, 200);

    fs.writeFileSync(f.catalog, JSON.stringify({ styles: [{ ...style, hidden: true }] }));
    for (const category of ['npc', 'background']) {
        const after = await f.call('/api/items?category=' + category);
        assert.equal(after.status, 200);
        const body = await after.text();
        assert.equal(body.includes('Ink style'), false, category);
        assert.equal(body.includes('INK_PROMPT_SENTINEL'), false, category);
    }
    assert.equal((await f.call('/api/image?id=styled-npc&which=portrait')).status, 404);
    assert.equal((await f.call('/api/backgrounds/image?rel=styled.png')).status, 404);
    assert.equal(fs.existsSync(path.join(folder, 'portrait.png')), true, 'changing visibility does not move images');
});

test('hidden styles and private jobs stay protected across independent sessions', async (t) => {
    const f = await fixture(t);
    const publicStyles = await (await f.call('/api/art-styles')).text();
    assert.equal(publicStyles.includes('Hidden style name'), false);
    assert.equal(publicStyles.includes('HIDDEN_PROMPT_SENTINEL'), false);
    for (const route of ['/api/create', '/api/backgrounds/dynamic/preview', '/api/backgrounds/dynamic/render', '/api/backgrounds/battlemap']) {
        const response = await f.call(route, { artStyle: 'hidden', dryRun: true });
        assert.equal(response.status, 400, route);
        assert.equal((await response.text()).includes('HIDDEN_PROMPT_SENTINEL'), false);
    }
    assert.equal(fs.existsSync(f.marker), false, 'hidden preview must be refused before invoking the generator');
    const a = await f.login(), b = await f.login();
    const badOrigin = await f.call('/api/art-styles', undefined, a, { Origin: 'https://evil.example' });
    assert.equal(badOrigin.status, 403);
    assert.equal((await f.call('/api/secret/items', undefined, a, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    const created = await (await f.call('/api/create', { artStyle: 'hidden', dryRun: true }, a)).json();
    assert.ok(created.jobId);
    assert.equal(created.secret, true);
    assert.equal((await f.call('/api/create-status?jobId=' + created.jobId)).status, 404);
    assert.equal((await f.call('/api/secret/create-status?jobId=' + created.jobId)).status, 401);
    const job = await f.call('/api/secret/create-status?jobId=' + created.jobId, undefined, a);
    assert.equal(job.status, 200);
    assert.equal(job.headers.get('cache-control'), 'no-store');
    await job.text();
    assert.equal((await f.call('/api/secret/logout', {}, a)).status, 200);
    assert.equal((await f.call('/api/secret/create-status?jobId=' + created.jobId, undefined, a)).status, 401);
    assert.equal((await f.call('/api/secret/items', undefined, b)).status, 200);
    assert.equal((await (await f.call('/api/art-styles', undefined, a)).text()).includes('Hidden style name'), false);
});
