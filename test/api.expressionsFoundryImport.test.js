const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

// Unique to this file. Every fixture is temporary and every request uses the
// real server routes that migrate and then re-read the manifest.
const PORT = 5256;
const NPC_ID = 'npc-foundry-expressions-1';
const NPC_NAME = 'Vex';
const TABLES = '## Role\n- an operator\n';
const EXPRESSION_TABLES = '## joy\n- a bright smile\n';

function seedNpc(server) {
    const folder = path.join(server.dir, 'output', 'Pilots', NPC_NAME);
    fs.mkdirSync(folder, { recursive: true });
    const portrait = path.join(folder, `${NPC_NAME} Portrait.png`);
    const token = path.join(folder, `${NPC_NAME} Token.png`);
    fs.writeFileSync(portrait, 'PORTRAIT');
    fs.writeFileSync(token, 'TOKEN');
    const old = new Date('2001-02-03T04:05:06.000Z');
    fs.utimesSync(portrait, old, old);
    fs.writeFileSync(server.manifestPath, JSON.stringify({
        [folder]: {
            id: NPC_ID, kind: 'npc', name: NPC_NAME, seed: 1,
            traits: { Role: 'an operator' },
            portrait: path.basename(portrait), token: path.basename(token),
            files: [path.basename(portrait), path.basename(token)],
        },
    }));
    const oldToken = new Date('2002-03-04T05:06:07.000Z');
    fs.utimesSync(token, oldToken, oldToken);
    return {
        folder, portrait, token,
        portraitMtime: fs.statSync(portrait).mtimeMs,
        tokenMtime: fs.statSync(token).mtimeMs,
    };
}

async function fixture(t, expressionSource = 'process.exit(0);') {
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-expressions-stub-'));
    const script = path.join(stubDir, 'generate-expressions.js');
    fs.writeFileSync(script, expressionSource);
    const server = await startTestServer({
        tablesText: TABLES,
        expressionTablesText: EXPRESSION_TABLES,
        port: PORT,
        extraConfig: {
            pythonExecutable: process.execPath,
            generateExpressionsScript: script,
        },
    });
    t.after(async () => {
        await server.stop();
        fs.rmSync(stubDir, { recursive: true, force: true });
    });
    return { server, stubDir };
}

async function post(server, route, body) {
    const res = await fetch(`${server.baseUrl}${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

async function expressionView(server) {
    return (await (await fetch(`${server.baseUrl}/api/expressions?id=${NPC_ID}`)).json());
}

async function settle(server) {
    for (let i = 0; i < 80; i++) {
        const view = await expressionView(server);
        if (view.job && view.job.status !== 'running') return view;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('expression job never settled');
}

test('Foundry relocation carries safe sprites and merged metadata without changing stale meaning', async (t) => {
    const recorder = [
        'const fs = require("node:fs"); const path = require("node:path");',
        'fs.writeFileSync(path.join(__dirname, "argv.json"), JSON.stringify(process.argv.slice(2)));',
    ].join('\n');
    const { server, stubDir } = await fixture(t, recorder);
    const { folder, portraitMtime, tokenMtime } = seedNpc(server);
    const expressions = path.join(folder, 'expressions');
    fs.mkdirSync(expressions);
    for (const [name, bytes] of [
        ['joy.webp', 'JOY'], ['sadness.webp', 'SAD'], ['constructor.webp', 'CUSTOM'],
        ['__proto__.webp', 'PROTO'],
    ]) fs.writeFileSync(path.join(expressions, name), bytes);
    fs.writeFileSync(path.join(expressions, 'not-a-sprite.txt'), 'NO');
    fs.writeFileSync(path.join(expressions, 'expressions.json'), JSON.stringify({
        'joy.webp': { label: 'joy', prompt: 'fresh token smile', seed: 1,
            source: { kind: 'token', path: path.join(folder, `${NPC_NAME} Token.png`), mtime: tokenMtime } },
        'sadness.webp': { label: 'sadness', prompt: 'old frown', seed: 2,
            source: { path: 'older portrait.png', mtime: portraitMtime - 10000 } },
        'constructor.webp': { label: 'constructor', prompt: 'custom focus', seed: 3,
            source: { path: path.join(folder, `${NPC_NAME} Portrait.png`), mtime: portraitMtime } },
        '__proto__.webp': { label: '__proto__', prompt: 'manual file', seed: 4,
            source: { path: path.join(folder, `${NPC_NAME} Portrait.png`), mtime: portraitMtime } },
    }));

    const expectedDestination = path.join(server.dir, 'FoundryData', 'LancerNPCs', 'Pilots', NPC_NAME);
    const destinationExpressions = path.join(expectedDestination, 'expressions');
    fs.mkdirSync(destinationExpressions, { recursive: true });
    fs.writeFileSync(path.join(destinationExpressions, 'love.webp'), 'DESTINATION ONLY');
    fs.writeFileSync(path.join(destinationExpressions, 'expressions.json'), JSON.stringify({
        'love.webp': { label: 'love', prompt: 'keep me', seed: 9 },
    }));

    const imported = await post(server, '/api/import', { ids: [NPC_ID] });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.results[0].queued, true, JSON.stringify(imported.body));
    const manifest = JSON.parse(fs.readFileSync(server.manifestPath, 'utf8'));
    assert.equal(manifest[folder], undefined);
    assert.ok(manifest[expectedDestination]);
    for (const name of ['joy.webp', 'sadness.webp', 'constructor.webp', '__proto__.webp', 'love.webp']) {
        assert.equal(fs.existsSync(path.join(destinationExpressions, name)), true, name);
    }
    assert.equal(fs.existsSync(path.join(destinationExpressions, 'not-a-sprite.txt')), false);

    const view = await expressionView(server);
    assert.equal(view.groups.find((group) => group.label === 'joy').files[0].stale, false);
    assert.equal(view.groups.find((group) => group.label === 'sadness').files[0].stale, true);
    assert.equal(view.sidecar['joy.webp'].source.kind, 'token');
    assert.equal(view.sidecar['joy.webp'].source.path,
        path.join(expectedDestination, `${NPC_NAME} Token.png`));
    assert.equal(view.sidecar['sadness.webp'].source.path,
        path.join(expectedDestination, `${NPC_NAME} Portrait.png`));
    const destinationTokenMtime = fs.statSync(path.join(expectedDestination, `${NPC_NAME} Token.png`)).mtimeMs;
    const destinationPortraitMtime = fs.statSync(path.join(expectedDestination, `${NPC_NAME} Portrait.png`)).mtimeMs;
    assert.equal(view.sidecar['joy.webp'].source.mtime, destinationTokenMtime);
    assert.ok(Math.abs((destinationPortraitMtime - view.sidecar['sadness.webp'].source.mtime) - 10000) < 0.1,
        'stale portrait delta changed during relocation');
    const custom = view.groups.find((group) => group.label === 'constructor').files[0];
    assert.equal(custom.stale, false);
    assert.equal(custom.prompt, 'custom focus');
    assert.equal(view.groups.find((group) => group.label === '__proto__').files[0].prompt, 'manual file');
    assert.equal(Object.hasOwn(view.sidecar, '__proto__.webp'), true);
    assert.equal(view.sidecar['love.webp'].prompt, 'keep me');

    const image = await fetch(`${server.baseUrl}/api/expression-image?id=${NPC_ID}&file=constructor.webp`);
    assert.equal(image.status, 200);
    assert.equal(await image.text(), 'CUSTOM');
    const redo = await post(server, '/api/expressions', { id: NPC_ID, file: 'constructor.webp' });
    assert.equal(redo.status, 202, JSON.stringify(redo.body));
    assert.equal((await settle(server)).job.status, 'done');
    const argv = JSON.parse(fs.readFileSync(path.join(stubDir, 'argv.json'), 'utf8'));
    assert.deepEqual(argv.slice(-2), ['--file', 'constructor.webp']);
    const removed = await fetch(`${server.baseUrl}/api/expressions/file?id=${NPC_ID}&file=constructor.webp`,
        { method: 'DELETE' });
    assert.equal(removed.status, 200);
});

test('Foundry import refuses a running expression job before copying or moving the manifest', async (t) => {
    const { server } = await fixture(t, 'setTimeout(() => process.exit(0), 2000);');
    const { folder } = seedNpc(server);
    const started = await post(server, '/api/expressions', { id: NPC_ID, labels: ['joy'] });
    assert.equal(started.status, 202);

    const imported = await post(server, '/api/import', { ids: [NPC_ID] });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.results[0].queued, false);
    assert.match(imported.body.results[0].reason, /expression/i);
    const manifest = JSON.parse(fs.readFileSync(server.manifestPath, 'utf8'));
    assert.ok(manifest[folder], 'manifest moved while expressions were rendering');
    assert.equal(fs.existsSync(path.join(server.dir, 'FoundryData', 'LancerNPCs', 'Pilots', NPC_NAME)), false);
    await post(server, '/api/expressions/cancel', { id: NPC_ID });
});

test('Foundry relocation refuses an expressions-directory junction without touching its target', async (t) => {
    const { server } = await fixture(t);
    const { folder } = seedNpc(server);
    const expressions = path.join(folder, 'expressions');
    fs.mkdirSync(expressions);
    fs.writeFileSync(path.join(expressions, 'joy.webp'), 'SOURCE');

    const destination = path.join(server.dir, 'FoundryData', 'LancerNPCs', 'Pilots', NPC_NAME);
    const outside = path.join(server.dir, 'outside-foundry-expressions');
    fs.mkdirSync(destination, { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'joy.webp'), 'OUTSIDE');
    try {
        fs.symlinkSync(outside, path.join(destination, 'expressions'),
            process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err) {
        t.skip(`directory links unavailable: ${err.message}`);
        return;
    }

    const imported = await post(server, '/api/import', { ids: [NPC_ID] });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.results[0].queued, false);
    assert.match(imported.body.results[0].reason, /unsafe expressions directory/i);
    assert.equal(fs.readFileSync(path.join(outside, 'joy.webp'), 'utf8'), 'OUTSIDE');
    const manifest = JSON.parse(fs.readFileSync(server.manifestPath, 'utf8'));
    assert.ok(manifest[folder], 'manifest moved after rejecting the unsafe destination');
});

test('Foundry relocation refuses a linked source destination before writing outside its folder', async (t) => {
    const { server } = await fixture(t);
    const { folder } = seedNpc(server);
    const destination = path.join(server.dir, 'FoundryData', 'LancerNPCs', 'Pilots', NPC_NAME);
    const outside = path.join(server.dir, 'outside-token.png');
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(outside, 'OUTSIDE');
    try {
        fs.symlinkSync(outside, path.join(destination, `${NPC_NAME} Token.png`), 'file');
    } catch (err) {
        t.skip(`file links unavailable: ${err.message}`);
        return;
    }

    const imported = await post(server, '/api/import', { ids: [NPC_ID] });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.results[0].queued, false);
    assert.match(imported.body.results[0].reason, /unsafe .*destination/i);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'OUTSIDE');
    const manifest = JSON.parse(fs.readFileSync(server.manifestPath, 'utf8'));
    assert.ok(manifest[folder], 'manifest moved after rejecting the linked source destination');
});
