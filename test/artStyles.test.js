const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const styles = require('../lib/artStyles');
test('catalog fallback, privacy aliases and invalid entries are enforced', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'styles-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'styles.json');
    assert.deepEqual(styles.list(file), [{ id: 'default', name: 'Default' }]);
    fs.writeFileSync(file, '   '); assert.equal(styles.load(file).length, 1);
    fs.writeFileSync(file, JSON.stringify({ styles: [{ id: 'hidden', name: 'Hidden', prompt: 'secret prompt', secret: true }] }));
    assert.equal(styles.list(file).length, 1);
    assert.equal(styles.list(file, true).length, 2);
    assert.throws(() => styles.select(file, 'hidden'), /unavailable/);
    assert.throws(() => styles.select(file, 'unknown', true), /unavailable/);
    for (const entry of [ { id: 'default', name: 'Override', prompt: 'override' }, { id: 'x', name: 'X', prompt: 'x', hidden: 'false' } ]) {
        fs.writeFileSync(file, JSON.stringify({ styles: [entry] })); assert.throws(() => styles.load(file));
    }
});

test('a malformed catalog does not hide a public saved item', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'styles-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'styles.json');
    fs.writeFileSync(file, '{"styles":[{"id":"broken"}');

    assert.equal(styles.hidden(file, { art_style: { id: 'ink', name: 'Ink' } }), false);
});

test('a loaded catalog determines saved-item visibility without rereading its file', () => {
    const catalog = [{ id: 'default', name: 'Default', prompt: '', hidden: false },
        { id: 'secret-ink', name: 'Secret ink', prompt: 'ink', hidden: true }];
    assert.equal(styles.hiddenFromCatalog(catalog, { art_style: { id: 'secret-ink' } }), true);
    assert.equal(styles.hiddenFromCatalog(catalog, { art_style: { id: 'ink' } }), false);
});
