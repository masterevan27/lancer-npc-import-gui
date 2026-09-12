const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5252;
const NPC_ID = 'npc-vex-18';
const NPC_NAME = 'Vex';
const TABLES = '## Role\n- an operator\n';

async function fixture(t, mode = 'present') {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'expressions-import-'));
    const base = path.join(external, 'SillyTavern', 'data', 'default-user', 'characters');
    if (mode === 'present') fs.mkdirSync(base, { recursive: true });
    const server = await startTestServer({
        tablesText: TABLES, port: PORT,
        extraConfig: mode === 'unset' ? {} : { sillyTavernCharactersDir: base },
    });
    const folder = path.join(server.dir, 'output', 'Pilots', NPC_NAME);
    fs.mkdirSync(path.join(folder, 'expressions'), { recursive: true });
    fs.writeFileSync(path.join(folder, `${NPC_NAME} Portrait.png`), 'portrait');
    fs.writeFileSync(path.join(folder, `${NPC_NAME} Token.png`), 'token');
    fs.writeFileSync(server.manifestPath, JSON.stringify({
        [folder]: {
            id: NPC_ID, kind: 'npc', name: NPC_NAME, traits: { Role: 'an operator' },
            portrait: `${NPC_NAME} Portrait.png`, token: `${NPC_NAME} Token.png`,
        },
    }));
    t.after(async () => {
        await server.stop();
        fs.rmSync(external, { recursive: true, force: true });
    });
    return { server, folder, expressions: path.join(folder, 'expressions'), base, external };
}

async function postImport(server, body) {
    const res = await fetch(`${server.baseUrl}/api/expressions/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

test('import copies classified sprites, distinguishes new and replaced, and leaves destination-only files', async (t) => {
    const { server, expressions, base } = await fixture(t);
    fs.writeFileSync(path.join(expressions, 'joy.webp'), 'NEW-JOY');
    fs.writeFileSync(path.join(expressions, 'anger.webp'), 'ANGER');
    fs.writeFileSync(path.join(expressions, 'expressions.json'), '{}');
    fs.writeFileSync(path.join(expressions, 'notes.txt'), 'NO');
    const destination = path.join(base, NPC_NAME);
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, 'joy.webp'), 'OLD-JOY');
    fs.writeFileSync(path.join(destination, 'love.webp'), 'LOVE');

    const result = await postImport(server, { id: NPC_ID, folderName: NPC_NAME });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body, { copied: 1, replaced: 1, path: destination });
    assert.equal(fs.readFileSync(path.join(destination, 'joy.webp'), 'utf8'), 'NEW-JOY');
    assert.equal(fs.readFileSync(path.join(destination, 'anger.webp'), 'utf8'), 'ANGER');
    assert.equal(fs.readFileSync(path.join(destination, 'love.webp'), 'utf8'), 'LOVE');
    assert.equal(fs.existsSync(path.join(destination, 'notes.txt')), false);
});
test('import rejects empty, traversal, and separator folder names without copying', async (t) => {
    const { server, expressions, base } = await fixture(t);
    fs.writeFileSync(path.join(expressions, 'joy.webp'), 'JOY');
    for (const folderName of ['', '   ', '../Vex', 'a/b', 'a\\b', '..', 'Vex..Alt']) {
        const result = await postImport(server, { id: NPC_ID, folderName });
        assert.equal(result.status, 400, `${JSON.stringify(folderName)}: ${JSON.stringify(result.body)}`);
    }
    assert.deepEqual(fs.readdirSync(base), []);
});

test('unset and non-directory SillyTavern bases return actionable errors', async (t) => {
    const unset = await fixture(t, 'unset');
    fs.writeFileSync(path.join(unset.expressions, 'joy.webp'), 'JOY');
    const unsetResult = await postImport(unset.server, { id: NPC_ID, folderName: NPC_NAME });
    assert.equal(unsetResult.status, 400);
    assert.match(unsetResult.body.error, /set sillyTavernCharactersDir/);

    await unset.server.stop();
    const missing = await fixture(t, 'missing');
    fs.writeFileSync(path.join(missing.expressions, 'joy.webp'), 'JOY');
    const missingResult = await postImport(missing.server, { id: NPC_ID, folderName: NPC_NAME });
    assert.equal(missingResult.status, 400);
    assert.match(missingResult.body.error, new RegExp(`not a folder.*${path.basename(missing.base)}`));
    assert.equal(fs.existsSync(missing.base), false);
});

test('an existing destination symlink that escapes the characters folder is rejected', async (t) => {
    const { server, expressions, base, external } = await fixture(t);
    fs.writeFileSync(path.join(expressions, 'joy.webp'), 'JOY');
    const outside = path.join(external, 'outside');
    fs.mkdirSync(outside);
    try {
        fs.symlinkSync(outside, path.join(base, NPC_NAME), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err) {
        if (err.code === 'EPERM') return t.skip('creating symlinks requires OS permission');
        throw err;
    }

    const result = await postImport(server, { id: NPC_ID, folderName: NPC_NAME });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.match(result.body.error, /outside|symlink|inside/);
    assert.deepEqual(fs.readdirSync(outside), []);
});
