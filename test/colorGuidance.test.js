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
    const builtins = [{ id: 'default', name: 'Default', description: 'house palette: greys, olive drab and rust' }, { id: 'none', name: 'None (no colour guidance)' }];
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

test('descriptions are optional strings that reach the public list without the prompt', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guidance-desc-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'guidance.json');
    fs.writeFileSync(file, JSON.stringify({ guidance: [
        { id: 'ochre', name: 'Ochre', prompt: 'Keep the palette to ochre and bone white.', description: ' ochre, bone white ' },
        { id: 'plain', name: 'Plain', prompt: 'Keep the palette plain.' },
        { id: 'blank', name: 'Blank', prompt: 'Keep the palette blank.', description: '' },
    ] }));
    assert.deepEqual(guidance.list(file).slice(2), [{ id: 'ochre', name: 'Ochre', description: 'ochre, bone white' }, { id: 'plain', name: 'Plain' }, { id: 'blank', name: 'Blank' }]);
    assert.equal(guidance.select(file, 'ochre').description, 'ochre, bone white');
    assert.equal(JSON.stringify(guidance.list(file)).includes('Keep the palette'), false);
    for (const description of [5, null, ['x'], { text: 'x' }]) {
        fs.writeFileSync(file, JSON.stringify({ guidance: [{ id: 'x', name: 'X', prompt: 'x', description }] }));
        assert.throws(() => guidance.load(file), /description/);
    }
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
