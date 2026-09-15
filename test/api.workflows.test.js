const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');
const { hashPassword } = require('../lib/secretMode');

test('workflow choices reach NPC and ship creation/regeneration and enforce private selection', async t => {
    const os = require('node:os');
    const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'private-workflow-'));
    t.after(() => fs.rmSync(privateRoot, { recursive: true, force: true }));
    const stub = 'const fs = require("node:fs"), path = require("node:path"); fs.writeFileSync(path.join(__dirname, "argv.json"), JSON.stringify(process.argv.slice(2))); console.log(process.argv.slice(2).join(" "));';
    const server = await startTestServer({ port: 5296, tablesText: '## Gear\n- tool\n',
        generatorSource: stub, spaceshipGeneratorSource: stub, spaceshipTablesText: '## Hull\n- hull\n',
        extraConfig: { secretImagesDir: privateRoot, secretMode: { username: 'test', passwordHash: hashPassword('password') } } });
    t.after(() => server.stop());
    const dir = path.join(server.dir, 'workflows', 'api'); fs.mkdirSync(path.join(dir, 'secret'), { recursive: true });
    const graph = JSON.stringify({ '1': { class_type: 'SaveImage', inputs: {} } });
    fs.writeFileSync(path.join(dir, 'Custom.json'), graph);
    fs.writeFileSync(path.join(dir, 'secret', 'Private.json'), graph);
    let cookie = '';
    const call = (route, body) => fetch(server.baseUrl + route, { method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    async function completed(response, statusPath) {
        assert.equal(response.status, 202, await response.clone().text());
        const result = await response.json();
        for (let n = 0; n < 80; n++) {
            const job = await (await call(statusPath + encodeURIComponent(result.jobId || 'item'))).json();
            if (job.status === 'done' || job.status === 'error') return job;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.fail('job did not complete');
    }
    assert.deepEqual((await (await call('/api/workflows')).json()).workflows.map(w => w.id), ['default', 'Custom.json']);
    assert.equal((await call('/api/create', { workflow: 'secret/Private.json', dryRun: true })).status, 400);
    for (const kind of ['npc', 'spaceship']) {
        const created = await completed(await call('/api/create', { kind, workflow: 'Custom.json', dryRun: true }), '/api/create-status?jobId=');
        assert.ok(created.log.includes('--workflow ' + path.join(dir, 'Custom.json')));
        const folder = path.join(server.dir, 'public-' + kind); fs.mkdirSync(folder);
        const id = 'public-' + kind;
        fs.writeFileSync(server.manifestPath, JSON.stringify({ [folder]: { id, kind, name: 'Public example', seed: 31 } }));
        assert.equal((await call('/api/regenerate', { id, workflow: 'secret/Private.json' })).status, 400);
        assert.equal((await call('/api/regenerate', { id, workflow: 'Custom.json' })).status, 202);
        let args;
        for (let n = 0; n < 80; n++) {
            args = JSON.parse(fs.readFileSync(path.join(server.dir, 'argv.json'), 'utf8'));
            if (args.includes(id)) break;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.ok(args.includes(id));
        assert.equal(args[args.indexOf('--workflow') + 1], path.join(dir, 'Custom.json'));
    }
    const login = await call('/api/secret/login', { username: 'test', password: 'password' });
    cookie = login.headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await (await call('/api/workflows')).json()).workflows.map(w => w.id), ['default', 'Custom.json', 'secret/Private.json']);
    for (const kind of ['npc', 'spaceship']) {
        const created = await completed(await call('/api/create', { kind, workflow: 'secret/Private.json', dryRun: true }), '/api/secret/create-status?jobId=');
        assert.ok(created.log.includes('--workflow ' + path.join(dir, 'secret', 'Private.json')));
        const folder = path.join(privateRoot, kind); fs.mkdirSync(folder);
        fs.writeFileSync(path.join(privateRoot, 'manifest.json'), JSON.stringify({ [folder]: { id: 'item', kind, name: 'Example', seed: 42 } }));
        const regenerated = await completed(await call('/api/secret/regenerate', { id: 'item', workflow: 'secret/Private.json' }), '/api/secret/create-status?jobId=');
        assert.ok(regenerated.log.includes('--workflow ' + path.join(dir, 'secret', 'Private.json')));
        assert.match(regenerated.log, /--new-seed 42/);
    }
});
