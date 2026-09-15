const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const guidance = require('../lib/colorGuidance');

test('catalog fallback, hidden entries and invalid entries are enforced', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guidance-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'guidance.json');
    assert.deepEqual(guidance.list(file), [{ id: 'default', name: 'Default' }]);
    fs.writeFileSync(file, '   '); assert.equal(guidance.load(file).length, 1);
    fs.writeFileSync(file, JSON.stringify({ guidance: [
        { id: 'ochre', name: 'Ochre', prompt: 'Keep the palette to ochre.' },
        { id: 'hidden', name: 'Hidden', prompt: 'private palette', secret: true },
    ] }));
    assert.deepEqual(guidance.list(file).map(g => g.id), ['default', 'ochre']);
    assert.deepEqual(guidance.list(file, true).map(g => g.id), ['default', 'ochre', 'hidden']);
    assert.equal(guidance.select(file, 'ochre').prompt, 'Keep the palette to ochre.');
    assert.equal(guidance.select(file).id, 'default');
    assert.throws(() => guidance.select(file, 'hidden'), /unavailable/);
    assert.throws(() => guidance.select(file, 'unknown', true), /unavailable/);
    for (const entry of [{ id: 'default', name: 'Override', prompt: 'override' }, { id: 'x', name: 'X', prompt: '' },
        { id: 'x', name: 'X', prompt: 'x', hidden: 'false' }, { id: '../x', name: 'X', prompt: 'x' }]) {
        fs.writeFileSync(file, JSON.stringify({ guidance: [entry] })); assert.throws(() => guidance.load(file));
    }
    fs.writeFileSync(file, JSON.stringify({ styles: [] })); assert.throws(() => guidance.load(file), /guidance array/);
});

test('saved metadata reads the manifest key and falls back to Default', () => {
    assert.deepEqual(guidance.metadata({ color_guidance: { id: 'ochre', name: 'Ochre' } }), { id: 'ochre', name: 'Ochre' });
    assert.deepEqual(guidance.metadata({ colorGuidance: { id: 'ochre', name: 'Ochre' } }), { id: 'ochre', name: 'Ochre' });
    assert.deepEqual(guidance.metadata({}), { id: 'default', name: 'Default' });
    assert.deepEqual(guidance.metadata({ color_guidance: { id: 5 } }), { id: 'default', name: 'Default' });
});
