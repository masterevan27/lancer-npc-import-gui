const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('discovers API workflows and enforces utility and secret exclusions on selection', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-catalog-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dir = path.join(root, 'workflows', 'api'); fs.mkdirSync(dir, { recursive: true });
    for (const name of ['Public.json', 'Private.json', 'Alias.json', 'UTIL_Helper.json']) {
        fs.writeFileSync(path.join(dir, name), JSON.stringify({ '1': { class_type: 'SaveImage', inputs: {} } }));
    }
    fs.writeFileSync(path.join(dir, 'editor.json'), '{"nodes":[]}');
    fs.mkdirSync(path.join(dir, 'secret'));
    for (const file of ['FolderPrivate.json', 'UTIL_Private.json']) fs.copyFileSync(path.join(dir, 'Public.json'), path.join(dir, 'secret', file));
    fs.writeFileSync(path.join(root, 'workflows.json'), JSON.stringify({ workflows: [
        { file: 'Private.json', hidden: true }, { file: 'Alias.json', secret: true },
    ] }));
    const catalog = require('../lib/workflows').createCatalog(root);
    assert.deepEqual(catalog.list(false).map(x => x.id), ['default', 'Public.json']);
    assert.deepEqual(catalog.list(true).map(x => x.id), ['default', 'Alias.json', 'Private.json', 'Public.json', 'secret/FolderPrivate.json']);
    for (const file of ['Private.json', 'Alias.json', 'UTIL_Helper.json', '../Public.json', 'secret/FolderPrivate.json']) {
        assert.throws(() => catalog.args(file, false), /unavailable workflow/);
    }
    assert.deepEqual(catalog.args('Private.json', true), ['--workflow', path.join(dir, 'Private.json')]);
    assert.deepEqual(catalog.args('secret/FolderPrivate.json', true), ['--workflow', path.join(dir, 'secret', 'FolderPrivate.json')]);
});
