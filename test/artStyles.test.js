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
    assert.deepEqual(styles.list(file), [{ id: 'default', name: 'Default', description: 'house painterly illustration' }, { id: 'none', name: 'None (no art style)' }]);
    fs.writeFileSync(file, '   '); assert.equal(styles.load(file).length, 2);
    fs.writeFileSync(file, JSON.stringify({ styles: [{ id: 'hidden', name: 'Hidden', prompt: 'secret prompt', secret: true }] }));
    assert.equal(styles.list(file).length, 2);
    assert.equal(styles.list(file, true).length, 3);
    assert.throws(() => styles.select(file, 'hidden'), /unavailable/);
    assert.throws(() => styles.select(file, 'unknown', true), /unavailable/);
    for (const entry of [ { id: 'default', name: 'Override', prompt: 'override' }, { id: 'none', name: 'Override', prompt: 'override' }, { id: 'x', name: 'X', prompt: null }, { id: 'x', name: 'X', prompt: 'x', hidden: 'false' } ]) {
        fs.writeFileSync(file, JSON.stringify({ styles: [entry] })); assert.throws(() => styles.load(file));
    }
});

test('descriptions are optional strings that reach the public list without the prompt', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'styles-desc-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'styles.json');
    fs.writeFileSync(file, JSON.stringify({ styles: [
        { id: 'ink', name: 'Ink', prompt: 'INK_PROMPT_SENTINEL', description: '  monochrome ink wash  ' },
        { id: 'plain', name: 'Plain', prompt: 'plain' },
        { id: 'blank', name: 'Blank', prompt: 'blank', description: '   ' },
    ] }));
    assert.deepEqual(styles.list(file).slice(2), [{ id: 'ink', name: 'Ink', description: 'monochrome ink wash' }, { id: 'plain', name: 'Plain' }, { id: 'blank', name: 'Blank' }]);
    assert.equal(styles.select(file, 'ink').description, 'monochrome ink wash');
    assert.equal(JSON.stringify(styles.list(file)).includes('INK_PROMPT_SENTINEL'), false);
    for (const description of [5, null, ['x'], { text: 'x' }]) {
        fs.writeFileSync(file, JSON.stringify({ styles: [{ id: 'x', name: 'X', prompt: 'x', description }] }));
        assert.throws(() => styles.load(file), /description/);
    }
});

test('none and blank custom styles can be selected without changing Default', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'styles-empty-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'styles.json');
    for (const prompt of ['', ' \n\t ']) {
        fs.writeFileSync(file, JSON.stringify({ styles: [{ id: 'blank', name: 'Blank', prompt }] }));
        assert.equal(styles.select(file).id, 'default');
        for (const id of ['none', 'blank']) {
            assert.equal(styles.select(file, id).prompt, '');
            assert.ok(styles.list(file).some(style => style.id === id));
        }
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
