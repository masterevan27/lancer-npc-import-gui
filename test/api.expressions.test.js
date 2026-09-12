const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');
const { DEFAULT_EXPRESSION_LABELS } = require('../lib/expressions');

// Unique to this file. Server test files run concurrently.
const PORT = 5251;
const NPC_ID = 'npc-vex-17';
const SHIP_ID = 'spaceship-vex-17';
const NPC_NAME = 'Vex';
const TABLES = '## Role\n- an operator\n\n## Animation\n- the camera stays still\n';
const EXPRESSION_TABLES = '## joy\n- a bright genuine smile\n\n## anger\n- a furious glare\n';

function seedItem(server, { id = NPC_ID, kind = 'npc', portrait = true } = {}) {
    const folder = path.join(server.dir, 'output', kind === 'npc' ? 'Pilots' : 'Ships', NPC_NAME);
    fs.mkdirSync(folder, { recursive: true });
    if (portrait) fs.writeFileSync(path.join(folder, `${NPC_NAME} Portrait.png`), 'portrait');
    fs.writeFileSync(path.join(folder, `${NPC_NAME} Token.png`), 'token');
    const manifest = JSON.parse(fs.readFileSync(server.manifestPath, 'utf8'));
    manifest[folder] = {
        id, kind, name: NPC_NAME, seed: 17, traits: { Role: 'an operator' },
        portrait: `${NPC_NAME} Portrait.png`, token: `${NPC_NAME} Token.png`,
        files: [`${NPC_NAME} Portrait.png`, `${NPC_NAME} Token.png`],
    };
    fs.writeFileSync(server.manifestPath, JSON.stringify(manifest));
    return folder;
}

async function startWithStub(t, source, extraConfig = {}) {
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expressions-stub-'));
    const script = path.join(stubDir, 'generate-expressions.js');
    fs.writeFileSync(script, source);
    const resolvedExtraConfig = typeof extraConfig === 'function' ? extraConfig(stubDir) : extraConfig;
    const server = await startTestServer({
        tablesText: TABLES,
        expressionTablesText: EXPRESSION_TABLES,
        port: PORT,
        extraConfig: {
            pythonExecutable: process.execPath,
            generateExpressionsScript: script,
            ...resolvedExtraConfig,
        },
    });
    t.after(async () => {
        await server.stop();
        try { fs.rmSync(stubDir, { recursive: true, force: true }); } catch { /* child may still hold it */ }
    });
    return { server, stubDir, script };
}

async function jsonRequest(server, route, options) {
    const res = await fetch(`${server.baseUrl}${route}`, options);
    return { status: res.status, body: await res.json() };
}

function post(server, route, body) {
    return jsonRequest(server, route, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
}

async function expressionView(server, id = NPC_ID) {
    return (await jsonRequest(server, `/api/expressions?id=${encodeURIComponent(id)}`)).body;
}

async function settle(server, id = NPC_ID) {
    for (let i = 0; i < 120; i++) {
        const view = await expressionView(server, id);
        if (view.job && view.job.status !== 'running') return view;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('expression job never settled');
}

const WRITE_JOY_STUB = [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const argv = process.argv.slice(2);',
    'fs.writeFileSync(path.join(__dirname, "argv.json"), JSON.stringify(argv));',
    'const manifest = JSON.parse(fs.readFileSync(argv[argv.indexOf("--manifest") + 1], "utf8"));',
    'const entry = Object.entries(manifest).find(([, value]) => value.id === argv[argv.indexOf("--id") + 1]);',
    'const out = path.join(entry[0], "expressions");',
    'fs.mkdirSync(out, { recursive: true });',
    'process.stdout.write("uploading portrait\\nqueued render\\n");',
    'fs.writeFileSync(path.join(out, argv.includes("--file") ? argv[argv.indexOf("--file") + 1] : "joy.webp"), "WEBP");',
].join('\n');

test('GET groups default and custom sprites, merges lenient sidecar data, and marks old portraits', async (t) => {
    const { server } = await startWithStub(t, 'process.exit(0);');
    const folder = seedItem(server);
    const expressions = path.join(folder, 'expressions');
    fs.mkdirSync(expressions);
    fs.writeFileSync(path.join(expressions, 'joy.webp'), 'JOY');
    fs.writeFileSync(path.join(expressions, 'joy-2.webp'), 'JOY2');
    fs.writeFileSync(path.join(expressions, 'battle_focus.webp'), 'CUSTOM');
    fs.writeFileSync(path.join(expressions, 'ignore.png'), 'NO');
    const portraitMtime = fs.statSync(path.join(folder, `${NPC_NAME} Portrait.png`)).mtimeMs;
    fs.writeFileSync(path.join(expressions, 'expressions.json'), JSON.stringify({
        'joy.webp': { label: 'joy', prompt: 'smile', seed: 4, source: { path: 'portrait.png', mtime: portraitMtime } },
        'joy-2.webp': { label: 'joy', prompt: 'older smile', seed: 5, source: { path: 'portrait.png', mtime: portraitMtime - 1000 } },
    }));

    const view = await expressionView(server);
    assert.deepEqual(view.labels, DEFAULT_EXPRESSION_LABELS);
    assert.equal(view.groups.length, DEFAULT_EXPRESSION_LABELS.length + 1);
    assert.equal(view.groups[0].label, 'admiration');
    assert.deepEqual(view.groups.find((group) => group.label === 'anger').files, []);
    assert.deepEqual(view.groups.find((group) => group.label === 'joy').files.map((file) => ({
        file: file.file, prompt: file.prompt, stale: file.stale,
    })), [
        { file: 'joy.webp', prompt: 'smile', stale: false },
        { file: 'joy-2.webp', prompt: 'older smile', stale: true },
    ]);
    assert.equal(view.groups.at(-1).label, 'battle_focus');
    assert.equal(view.sidecar['joy.webp'].seed, 4);
    assert.equal(view.job, null);
    assert.deepEqual(view.importTarget, {
        directory: '', folderName: NPC_NAME, path: '',
        error: 'set sillyTavernCharactersDir in config.json to SillyTavern\'s data/<user>/characters folder',
    });

    const items = (await jsonRequest(server, '/api/items?category=npc')).body.items;
    const item = items.find((candidate) => candidate.id === NPC_ID);
    assert.equal(item.hasExpressions, true);
    assert.equal(item.expressionCount, 3);
    assert.equal(item.expressionStatus, null);
});

test('POST validates before spawning and only supports NPCs', async (t) => {
    const { server, stubDir } = await startWithStub(t,
        'require("node:fs").writeFileSync(require("node:path").join(__dirname, "spawned"), "yes");');
    seedItem(server);
    seedItem(server, { id: SHIP_ID, kind: 'spaceship' });

    const cases = [
        { body: { id: NPC_ID, labels: ['!!!'] }, error: /empty/ },
        { body: { id: NPC_ID, custom: [{ label: '', text: 'x' }] }, error: /label/ },
        { body: { id: NPC_ID, count: 0 }, error: /count/ },
        { body: { id: NPC_ID, count: 9 }, error: /between 1 and 8/ },
        { body: { id: NPC_ID, mode: 'erase' }, error: /mode/ },
        { body: { id: NPC_ID, file: '../joy.webp' }, error: /file/ },
    ];
    for (const fixture of cases) {
        const result = await post(server, '/api/expressions', fixture.body);
        assert.equal(result.status, 400, JSON.stringify(result.body));
        assert.match(result.body.error, fixture.error);
    }
    const ship = await post(server, '/api/expressions', { id: SHIP_ID, labels: ['joy'] });
    assert.equal(ship.status, 400);
    assert.match(ship.body.error, /not supported/);
    assert.equal(fs.existsSync(path.join(stubDir, 'spawned')), false);

    const malformed = await fetch(`${server.baseUrl}/api/expressions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json',
    });
    assert.equal(malformed.status, 400);
    const nullBody = await fetch(`${server.baseUrl}/api/expressions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null',
    });
    assert.equal(nullBody.status, 400);
});

test('a custom-only job sends configured manifest and tables, reports progress, and bounds its log', async (t) => {
    const source = [
        'const fs = require("node:fs"); const path = require("node:path");',
        'const argv = process.argv.slice(2);',
        'fs.writeFileSync(path.join(__dirname, "argv.json"), JSON.stringify(argv));',
        'process.stdout.write("x".repeat(9000) + "\\nplanning\\nrender");',
        'setTimeout(() => process.stdout.write("ing joy\\n"), 100);',
        'setTimeout(() => {}, 250);',
    ].join('\n');
    const { server, stubDir, script } = await startWithStub(t, source);
    seedItem(server);

    const started = await post(server, '/api/expressions', {
        id: NPC_ID, custom: [{ label: 'Battle Focus', text: 'cold resolve' }],
        count: 2, mode: 'replace', keepBackground: true,
    });
    assert.equal(started.status, 202, JSON.stringify(started.body));
    assert.equal(started.body.status, 'running');
    assert.ok(started.body.jobId);
    let progress;
    for (let i = 0; i < 30; i++) {
        progress = await expressionView(server);
        if (progress.job?.stage === 'rendering joy') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(progress.job.status, 'running');
    assert.equal(progress.job.stage, 'rendering joy');
    const done = await settle(server);
    assert.equal(done.job.status, 'done', done.job.error);
    assert.equal(done.job.stage, null);
    assert.ok(done.job.log.length <= 8000);
    assert.match(done.job.log, /rendering joy/);

    const argv = JSON.parse(fs.readFileSync(path.join(stubDir, 'argv.json'), 'utf8'));
    assert.equal(argv[0], '--id');
    assert.equal(argv[1], NPC_ID);
    assert.equal(argv[argv.indexOf('--manifest') + 1], server.manifestPath);
    assert.equal(argv[argv.indexOf('--tables') + 1], server.expressionTablesPath);
    assert.equal(argv[argv.indexOf('--custom') + 1], 'battle_focus=cold resolve');
    assert.equal(argv.includes('-e'), false, 'custom-only mode must not imply all defaults');
    assert.deepEqual(argv.slice(-4), ['--count', '2', '--replace', '--keep-background']);
    assert.match(script, /generate-expressions\.js$/);
});

test('partial output remains listable when the generator exits with an error', async (t) => {
    const source = `${WRITE_JOY_STUB}\nprocess.stderr.write("second sprite failed\\n"); process.exit(1);`;
    const { server } = await startWithStub(t, source);
    seedItem(server);

    assert.equal((await post(server, '/api/expressions', { id: NPC_ID, labels: ['joy'], count: 2 })).status, 202);
    const done = await settle(server);
    assert.equal(done.job.status, 'error');
    assert.match(done.job.error, /second sprite failed/);
    assert.deepEqual(done.groups.find((group) => group.label === 'joy').files.map((file) => file.file), ['joy.webp']);
});

test('exact-file redo sends only --file and keeps the saved sprite visible', async (t) => {
    const { server, stubDir } = await startWithStub(t, WRITE_JOY_STUB);
    const folder = seedItem(server);
    fs.mkdirSync(path.join(folder, 'expressions'));
    fs.writeFileSync(path.join(folder, 'expressions', 'joy.webp'), 'OLD');
    fs.writeFileSync(path.join(folder, 'expressions', 'expressions.json'), JSON.stringify({
        'joy.webp': { label: 'joy', prompt: 'saved prompt', seed: 9 },
    }));

    const started = await post(server, '/api/expressions', { id: NPC_ID, file: 'joy.webp' });
    assert.equal(started.status, 202, JSON.stringify(started.body));
    await settle(server);
    const argv = JSON.parse(fs.readFileSync(path.join(stubDir, 'argv.json'), 'utf8'));
    assert.deepEqual(argv.slice(-2), ['--file', 'joy.webp']);
    assert.equal(argv.includes('-e'), false);
    assert.equal(argv.includes('--custom'), false);
});

test('expression jobs exclude regeneration and animation in both directions and block item deletion', async (t) => {
    const slow = 'setTimeout(() => process.exit(0), 1200);';
    const { server } = await startWithStub(t, slow, (stubDir) => {
        const regenStub = path.join(stubDir, 'generate-npc.js');
        const animateStub = path.join(stubDir, 'animate.js');
        fs.writeFileSync(regenStub, slow);
        fs.writeFileSync(animateStub, slow);
        return { generateNpcScript: regenStub, animatePortraitScript: animateStub };
    });
    seedItem(server);

    assert.equal((await post(server, '/api/expressions', { id: NPC_ID, labels: ['joy'] })).status, 202);
    assert.equal((await post(server, '/api/regenerate', { id: NPC_ID, which: 'portrait' })).status, 409);
    assert.equal((await post(server, '/api/animation', { id: NPC_ID })).status, 409);
    const deleted = await post(server, '/api/delete', { ids: [NPC_ID] });
    assert.equal(deleted.body.results[0].deleted, false);
    assert.match(deleted.body.results[0].reason, /expressions/);
    await post(server, '/api/expressions/cancel', { id: NPC_ID });

    assert.equal((await post(server, '/api/regenerate', { id: NPC_ID, which: 'portrait' })).status, 202);
    assert.equal((await post(server, '/api/expressions', { id: NPC_ID, labels: ['joy'] })).status, 409);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.equal((await post(server, '/api/animation', { id: NPC_ID })).status, 202);
    assert.equal((await post(server, '/api/expressions', { id: NPC_ID, labels: ['joy'] })).status, 409);
});

test('cancel permits a new job and stale callbacks cannot complete the replacement job', async (t) => {
    const source = [
        'const fs = require("node:fs"); const path = require("node:path");',
        'const counter = path.join(__dirname, "count");',
        'const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) + 1 : 1;',
        'fs.writeFileSync(counter, String(n));',
        'if (n === 1) { process.on("SIGTERM", () => {}); setTimeout(() => process.exit(1), 250); }',
        'else setTimeout(() => process.exit(0), 650);',
    ].join('\n');
    const { server, stubDir } = await startWithStub(t, source);
    seedItem(server);
    const first = await post(server, '/api/expressions', { id: NPC_ID, labels: ['joy'] });
    for (let i = 0; i < 40; i++) {
        if (fs.existsSync(path.join(stubDir, 'count'))) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(fs.readFileSync(path.join(stubDir, 'count'), 'utf8'), '1');
    const canceled = await post(server, '/api/expressions/cancel', { id: NPC_ID });
    assert.equal(canceled.status, 200);
    assert.equal(canceled.body.status, 'canceled');
    const second = await post(server, '/api/expressions', { id: NPC_ID, labels: ['anger'] });
    assert.equal(second.status, 202);
    assert.notEqual(second.body.jobId, first.body.jobId);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const during = await expressionView(server);
    assert.equal(during.job.jobId, second.body.jobId);
    assert.equal(during.job.status, 'running');
    assert.equal((await settle(server)).job.status, 'done');
});

test('image and delete accept only real classified files inside expressions and delete sidecar metadata atomically', async (t) => {
    const { server } = await startWithStub(t, 'process.exit(0);');
    const folder = seedItem(server);
    const expressions = path.join(folder, 'expressions');
    fs.mkdirSync(expressions);
    fs.writeFileSync(path.join(expressions, 'joy.webp'), 'JOY-BYTES');
    fs.mkdirSync(path.join(expressions, 'anger.webp'));
    fs.writeFileSync(path.join(folder, 'love.webp'), 'OUTSIDE');
    fs.writeFileSync(path.join(expressions, 'expressions.json'), JSON.stringify({
        'joy.webp': { label: 'joy', seed: 8 }, 'missing.webp': { label: 'missing' },
    }));

    const image = await fetch(`${server.baseUrl}/api/expression-image?id=${NPC_ID}&file=joy.webp`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/webp');
    assert.equal(await image.text(), 'JOY-BYTES');
    assert.equal((await fetch(`${server.baseUrl}/api/expression-image?id=${NPC_ID}&file=../love.webp`)).status, 400);
    assert.equal((await fetch(`${server.baseUrl}/api/expression-image?id=${NPC_ID}&file=anger.webp`)).status, 404);

    const removed = await jsonRequest(server, `/api/expressions/file?id=${NPC_ID}&file=joy.webp`, { method: 'DELETE' });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.deepEqual(removed.body, { deleted: true, file: 'joy.webp' });
    assert.equal(fs.existsSync(path.join(expressions, 'joy.webp')), false);
    const sidecar = JSON.parse(fs.readFileSync(path.join(expressions, 'expressions.json'), 'utf8'));
    assert.equal('joy.webp' in sidecar, false);
    assert.equal(sidecar['missing.webp'].label, 'missing');
    assert.deepEqual(fs.readdirSync(expressions).filter((name) => name.includes('.tmp')), []);
});

test('an expressions directory symlink outside the NPC is never listed, served, or deleted', async (t) => {
    const { server } = await startWithStub(t, 'process.exit(0);');
    const folder = seedItem(server);
    const outside = path.join(server.dir, 'outside-expressions');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'joy.webp'), 'OUTSIDE');
    try {
        fs.symlinkSync(outside, path.join(folder, 'expressions'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err) {
        if (err.code === 'EPERM') return t.skip('creating symlinks requires OS permission');
        throw err;
    }

    const view = await expressionView(server);
    assert.deepEqual(view.groups.find((group) => group.label === 'joy').files, []);
    assert.equal((await fetch(`${server.baseUrl}/api/expression-image?id=${NPC_ID}&file=joy.webp`)).status, 404);
    const removed = await jsonRequest(server, `/api/expressions/file?id=${NPC_ID}&file=joy.webp`, { method: 'DELETE' });
    assert.equal(removed.status, 404);
    assert.equal(fs.readFileSync(path.join(outside, 'joy.webp'), 'utf8'), 'OUTSIDE');
});
