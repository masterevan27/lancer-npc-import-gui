const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { startTestServer } = require('./helpers/testServer');
const { STUB } = require('./helpers/secretPromptsStub');

/*
 * Secret prompts end to end: the listing the select is built from, the
 * argv a selection becomes on the private create and preview, the
 * refusals (public path, unknown file, broken file, unknown name), the
 * preset round trip, and the gallery's view of a templated record with a
 * re-rollable slot table. Port 5433 is this file's own.
 */

const PORT = 5433;

async function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-prompts-api-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const privateDir = path.join(root, 'private'); fs.mkdirSync(privateDir);
    const tablesDir = path.join(root, 'secret-tables'); fs.mkdirSync(tablesDir);
    const promptsDir = path.join(root, 'secret-prompts'); fs.mkdirSync(promptsDir);
    fs.writeFileSync(path.join(tablesDir, 'b.md'), '## mood\n\n- x2 harsh light\n- soft light\n');
    fs.writeFileSync(path.join(promptsDir, 'explicit-v1.md'), '## Solo kneeling\n## Couple scene\n');
    fs.writeFileSync(path.join(promptsDir, 'broken.md'), 'broken\n');
    const salt = '0123456789abcdef0123456789abcdef';
    const passwordHash = `scrypt$${salt}$${crypto.scryptSync('test-password', salt, 64).toString('hex')}`;
    const server = await startTestServer({ tablesText: '## Pronouns\n- she/her/her/woman\n## Age\n- adult\n## Gear\n- a tool\n', port: PORT, generatorSource: STUB,
        extraConfig: { secretImagesDir: privateDir, secretTablesDir: tablesDir, secretPromptsDir: promptsDir, secretMode: { username: 'tester', passwordHash } } });
    t.after(() => server.stop());
    let cookie = '';
    const call = (route, body, authenticated = false) => fetch(server.baseUrl + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const login = await call('/api/secret/login', { username: 'tester', password: 'test-password' });
    assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0];
    async function jobLog(route, body) {
        const res = await call(route, body, true);
        const text = await res.text();
        assert.equal(res.status, 202, text);
        const { jobId } = JSON.parse(text);
        for (let i = 0; i < 50; i++) {
            const job = await (await call('/api/secret/create-status?jobId=' + jobId, undefined, true)).json();
            if (job.status !== 'running') return job.log;
            await new Promise((r) => setTimeout(r, 40));
        }
        throw new Error('job never finished');
    }
    const createLog = body => jobLog('/api/secret/create', { dryRun: true, count: 1, ...body });
    return { call, createLog, jobLog, promptsDir, privateDir, tablesDir, server };
}

test('the listing needs a session and reports templates and broken files', async (t) => {
    const { call, promptsDir } = await setup(t);
    assert.equal((await call('/api/secret/prompts')).status, 401);
    const res = await call('/api/secret/prompts', undefined, true);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const data = await res.json();
    assert.equal(data.dir, promptsDir);
    assert.equal(data.exists, true);
    assert.deepEqual(data.files.map(f => f.file), ['broken.md', 'explicit-v1.md']);
    assert.match(data.files[0].error, /broken\.md, line 1/);
    assert.deepEqual(data.files[1].templates.map(t => t.name), ['Solo kneeling', 'Couple scene']);
    assert.deepEqual(data.files[1].templates[0].pins, { Pronouns: 'she/her' });
});

test('a selection becomes --secret-prompts and --secret-prompt, and the composition flags are dropped', async (t) => {
    const { createLog, promptsDir, tablesDir } = await setup(t);
    const log = await createLog({ secretPrompt: { file: 'explicit-v1.md', name: 'Solo kneeling' },
        extraTables: [{ file: 'b.md', tables: ['mood'], values: { mood: 'soft light' }, targets: { mood: 'token' } }],
        disabledTables: ['Stance'], promptLayout: { portrait: ['shot'] } });
    assert.ok(log.includes(`--secret-prompts ${path.join(promptsDir, 'explicit-v1.md')} --secret-prompt Solo kneeling`), log);
    assert.ok(log.includes(`--secret-tables-dir ${tablesDir}`), log);
    assert.match(log, /--extra-value mood=soft light/);
    for (const flag of ['--extra-tables', '--extra-table ', '--extra-target', '--disable-table', '--prompt-layout']) assert.ok(!log.includes(flag), flag);
    assert.match(log, /--secret --secret-config/);
    const random = await createLog({ secretPrompt: { file: 'explicit-v1.md', name: 'random' } });
    assert.match(random, /--secret-prompt random/);
    const none = await createLog({ secretPrompt: null });
    assert.doesNotMatch(none, /--secret-prompt/);
});

test('the preview carries the selection too', async (t) => {
    const { call } = await setup(t);
    const res = await call('/api/secret/prompt-preview', { secretPrompt: { file: 'explicit-v1.md', name: 'Couple scene' } }, true);
    assert.equal(res.status, 200, await res.clone().text());
    const body = await res.json();
    assert.equal(body.portrait[1].id, 'secret:Poses');
    assert.ok(body.argv.includes('--secret-prompt') && body.argv.includes('Couple scene'));
    assert.ok(!body.argv.includes('--prompt-layout'));
    assert.equal((await call('/api/secret/prompt-preview', { secretPrompt: { file: 'explicit-v1.md', name: 'Nope' } }, true)).status, 400);
});

test('the public path, an unknown file, a broken file and an unknown name are refused', async (t) => {
    const { call } = await setup(t);
    const publicRes = await call('/api/create-npc', { dryRun: true, count: 1, secretPrompt: { file: 'explicit-v1.md', name: 'random' } });
    assert.equal(publicRes.status, 400);
    assert.match((await publicRes.json()).error, /Secret mode only/);
    for (const [selection, pattern] of [
        [{ file: '../explicit-v1.md', name: 'random' }, /unknown secret prompts file/],
        [{ file: 'missing.md', name: 'random' }, /unknown secret prompts file "missing.md"/],
        [{ file: 'broken.md', name: 'random' }, /broken\.md: broken\.md, line 1/],
        [{ file: 'explicit-v1.md', name: 'Nope' }, /has no secret prompt "Nope"/],
        ['explicit-v1.md', /secretPrompt must be/],
    ]) {
        const res = await call('/api/secret/create', { dryRun: true, count: 1, secretPrompt: selection }, true);
        assert.equal(res.status, 400, JSON.stringify(selection));
        assert.match((await res.json()).error, pattern, JSON.stringify(selection));
    }
    const ship = await call('/api/secret/create', { kind: 'spaceship', dryRun: true, count: 1, secretPrompt: { file: 'explicit-v1.md', name: 'random' } }, true);
    assert.equal(ship.status, 400);
    assert.match((await ship.json()).error, /not a spaceship field/);
});

test('secret presets keep the selection and refuse a malformed one', async (t) => {
    const { call } = await setup(t);
    const settings = { count: 1, artStyle: 'default', workflow: 'default', colorGuidance: 'default', secretPrompt: { file: 'explicit-v1.md', name: 'random' } };
    const saved = await call('/api/secret/presets', { name: 'Kneelers', settings }, true);
    assert.equal(saved.status, 200, await saved.clone().text());
    const { slug } = await saved.json();
    const full = await (await call('/api/secret/presets/export?slug=' + slug, undefined, true)).json();
    assert.deepEqual(full.settings.secretPrompt, { file: 'explicit-v1.md', name: 'random' });
    const without = await call('/api/secret/presets', { name: 'Plain', settings: { ...settings, secretPrompt: null } }, true);
    assert.equal(without.status, 200);
    const plain = await (await call('/api/secret/presets/export?slug=' + (await without.json()).slug, undefined, true)).json();
    assert.equal(plain.settings.secretPrompt, undefined);
    assert.equal((await call('/api/secret/presets', { name: 'Bad', settings: { ...settings, secretPrompt: { file: '../x.md', name: 'a' } } }, true)).status, 400);
});

test('a templated record shows its template and can re-roll a slot table', async (t) => {
    const { call, jobLog, privateDir } = await setup(t);
    const folder = path.join(privateDir, 'npcs', 'Private'); fs.mkdirSync(folder, { recursive: true });
    const entry = { id: 'private-id', name: 'Private', kind: 'npc', seed: 23, traits: { Gear: 'a tool' }, rawTraits: { Gear: 'a tool' }, secret: true,
        art_style: { id: 'default', name: 'Default' }, extraTraits: { Poses: 'kneeling' },
        secretPrompt: { file: 'explicit-v1.md', name: 'Solo kneeling', portrait: 'A {secret:Poses} of {npc:identity}.', token: '{secret:Clothing}.', tables: [] } };
    fs.writeFileSync(path.join(privateDir, 'manifest.json'), JSON.stringify({ [folder]: entry }));
    const { items } = await (await call('/api/secret/items', undefined, true)).json();
    assert.deepEqual(items[0].secretPrompt, { file: 'explicit-v1.md', name: 'Solo kneeling' });
    assert.ok(items[0].rerollable.includes('Poses') && items[0].rerollable.includes('Clothing'), JSON.stringify(items[0].rerollable));
    const log = await jobLog('/api/secret/reroll-trait', { id: 'private-id', trait: 'Poses' });
    assert.match(log, /--reroll-trait Poses --apply-only/);
    assert.doesNotMatch(log, /--secret-prompts/);
    assert.equal((await call('/api/secret/reroll-trait', { id: 'private-id', trait: 'Nope' }, true)).status, 400);
    const plainEntry = { ...entry, id: 'plain-id', secretPrompt: undefined };
    fs.writeFileSync(path.join(privateDir, 'manifest.json'), JSON.stringify({ [folder]: plainEntry }));
    const plain = (await (await call('/api/secret/items', undefined, true)).json()).items[0];
    assert.equal(plain.secretPrompt, null);
    assert.ok(!plain.rerollable.includes('Poses'));
});
