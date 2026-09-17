const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { STUB } = require('./helpers/secretPromptsStub');
const { isSecretPromptsFileName, listSecretPrompts, validateSelection, normaliseSelection, secretSlots } = require('../lib/secretPrompts');

/*
 * The Secret prompt select of Create NPC is built from the generator's own
 * --list-secret-prompts, so the parser lives in one place. These tests run
 * the listing against a Node stub of the generator and check the pure
 * validation around it.
 */

function folder(t, files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-prompts-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return dir;
}

function options(t, dir) {
    const script = path.join(folder(t, { 'generate-npc.js': STUB }), 'generate-npc.js');
    return { dir, script, tablesPath: 'tables.md', tablesDir: path.join(dir, '..', 'secret-tables'),
        configFile: 'config.json', artStylesPath: 'art-styles.json', executable: process.execPath };
}

test('file names are bare .md names', () => {
    for (const ok of ['a.md', 'Explicit v1.MD']) assert.ok(isSecretPromptsFileName(ok), ok);
    for (const bad of ['a.json', '../a.md', 'x/a.md', 'x\\a.md', '.md', '', null, 7]) assert.ok(!isSecretPromptsFileName(bad), String(bad));
});

test('a missing folder lists nothing without running the generator', async (t) => {
    const missing = path.join(folder(t, {}), 'nope');
    const listing = await listSecretPrompts({ ...options(t, missing), executable: 'no-such-binary' });
    assert.deepEqual(listing, { dir: missing, exists: false, files: [] });
});

test('an empty folder is empty, and a folder of files is listed through the generator', async (t) => {
    const empty = folder(t, { 'notes.txt': 'ignored' });
    assert.deepEqual(await listSecretPrompts(options(t, empty)), { dir: empty, exists: true, files: [] });
    const dir = folder(t, { 'b.md': '## Two\n', 'a.md': '## One\n## Uno\n', 'broken.md': 'broken\n', 'x.json': '{}' });
    const listing = await listSecretPrompts(options(t, dir));
    assert.equal(listing.exists, true);
    assert.deepEqual(listing.files.map(f => f.file), ['a.md', 'b.md', 'broken.md']);
    assert.deepEqual(listing.files[0].templates.map(t => t.name), ['One', 'Uno']);
    assert.match(listing.files[2].error, /broken\.md, line 1/);
});

test('the generator is run with the secret, tables and listing flags', async (t) => {
    const dir = folder(t, { 'a.md': '## One\n' });
    const seen = folder(t, {});
    const spy = path.join(seen, 'spy.js');
    fs.writeFileSync(spy, 'require("fs").writeFileSync(process.argv[1] + ".argv", JSON.stringify(process.argv.slice(1)));\n' + STUB);
    await listSecretPrompts({ ...options(t, dir), script: spy });
    const argv = JSON.parse(fs.readFileSync(spy + '.argv', 'utf8'));
    assert.equal(argv[0], spy);
    for (const flag of ['--secret', '--secret-config', '--art-styles', '--tables', '--secret-tables-dir', '--list-secret-prompts']) assert.ok(argv.includes(flag), flag);
    assert.ok(argv.includes(path.join(dir, 'a.md')));
});

test('a generator failure is a readable error', async (t) => {
    const dir = folder(t, { 'a.md': '## One\n' });
    const bad = path.join(folder(t, {}), 'bad.js');
    fs.writeFileSync(bad, 'console.error("boom"); process.exit(2);');
    await assert.rejects(listSecretPrompts({ ...options(t, dir), script: bad }), /boom/);
    const junk = path.join(folder(t, {}), 'junk.js');
    fs.writeFileSync(junk, 'console.log("not json");');
    await assert.rejects(listSecretPrompts({ ...options(t, dir), script: junk }), /did not return a secret prompt listing/);
});

test('a selection must name a listed, valid file and a template in it', () => {
    const listing = { dir: 'D:/p', files: [
        { file: 'a.md', templates: [{ name: 'One' }] },
        { file: 'broken.md', error: 'broken.md, line 1: broken' },
    ] };
    assert.equal(validateSelection(null, listing), null);
    assert.equal(validateSelection(undefined, listing), null);
    assert.deepEqual(validateSelection({ file: 'a.md', name: 'One' }, listing), { file: path.join('D:/p', 'a.md'), name: 'One' });
    assert.deepEqual(validateSelection({ file: 'a.md', name: 'random' }, listing), { file: path.join('D:/p', 'a.md'), name: 'random' });
    for (const [raw, pattern] of [
        [{ file: '../a.md', name: 'One' }, /unknown secret prompts file/],
        [{ file: 'missing.md', name: 'One' }, /unknown secret prompts file "missing.md"/],
        [{ file: 'broken.md', name: 'random' }, /broken\.md: broken\.md, line 1/],
        [{ file: 'a.md', name: 'Two' }, /a\.md has no secret prompt "Two"/],
        [{ file: 'a.md', name: '' }, /name/],
        [{ file: 'a.md' }, /name/],
        ['a.md', /secretPrompt must be/],
        [['a.md', 'One'], /secretPrompt must be/],
    ]) assert.throws(() => validateSelection(raw, listing), pattern, JSON.stringify(raw));
});

test('presets keep the selection by shape alone', () => {
    assert.equal(normaliseSelection(null), null);
    assert.deepEqual(normaliseSelection({ file: 'a.md', name: 'One', extra: 1 }), { file: 'a.md', name: 'One' });
    assert.throws(() => normaliseSelection({ file: '../a.md', name: 'One' }), /file/);
    assert.throws(() => normaliseSelection({ file: 'a.md', name: '  ' }), /name/);
});

test('secretSlots reads every {secret:...} slot of a stored snapshot once', () => {
    assert.deepEqual(secretSlots({ portrait: 'A {secret:Poses}, {secret:Clothing States}.', token: '{secret:Poses} {secret: Lighting }' }),
        ['Poses', 'Clothing States', 'Lighting']);
    assert.deepEqual(secretSlots(null), []);
    assert.deepEqual(secretSlots({ portrait: 'no slots {{here}}' }), []);
});
