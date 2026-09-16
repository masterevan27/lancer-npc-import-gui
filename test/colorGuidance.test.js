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
    const builtins = [{ id: 'default', name: 'Default' }, { id: 'none', name: 'None (no colour guidance)' }];
    assert.deepEqual(guidance.list(file), builtins);
    fs.writeFileSync(file, '   '); assert.equal(guidance.load(file).length, 2);
    fs.writeFileSync(file, JSON.stringify({ guidance: [
        { id: 'ochre', name: 'Ochre', prompt: 'Keep the palette to ochre.' },
        { id: 'hidden', name: 'Hidden', prompt: 'private palette', secret: true },
    ] }));
    assert.deepEqual(guidance.list(file).map(g => g.id), ['default', 'none', 'ochre']);
    assert.deepEqual(guidance.list(file, true).map(g => g.id), ['default', 'none', 'ochre', 'hidden']);
    assert.equal(guidance.select(file, 'ochre').prompt, 'Keep the palette to ochre.');
    assert.equal(guidance.select(file).id, 'default');
    assert.deepEqual(guidance.select(file, 'none'), { id: 'none', name: 'None (no colour guidance)', prompt: '', hidden: false });
    assert.throws(() => guidance.select(file, 'hidden'), /unavailable/);
    assert.throws(() => guidance.select(file, 'unknown', true), /unavailable/);
    for (const entry of [{ id: 'default', name: 'Override', prompt: 'override' }, { id: 'none', name: 'Override', prompt: 'override' },
        { id: 'x', name: 'X', prompt: '' },
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

test('random selects an available guidance and excludes built-in placeholders', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guidance-random-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'guidance.json');
    fs.writeFileSync(file, JSON.stringify({ guidance: [
        { id: 'ochre', name: 'Ochre', prompt: 'Keep it ochre.' },
        { id: 'hidden', name: 'Hidden', prompt: 'Private.', hidden: true },
    ] }));
    for (let i = 0; i < 20; i++) assert.equal(guidance.select(file, 'random').id, 'ochre');
    assert.ok(['ochre', 'hidden'].includes(guidance.select(file, 'random', true).id));
});
