const test = require('node:test');
const assert = require('node:assert/strict');
const presets = require('../lib/secretPresets');
const ui = require('../public/secret-mode');
const composer = require('../public/prompt-composer');
const { normaliseLayout } = require('../lib/promptComposer');

test('secret presets retain independent portrait and token fragment order', () => {
    const promptLayout = { portrait: ['extra:camera', 'shot'], token: ['stance_line'] };
    const result = presets.normaliseSettings({ promptLayout }, { files: [] }, { tables: [], disableable: [] });
    assert.deepEqual(result.promptLayout, promptLayout);
});

test('custom text is literal and retained alongside inactive table IDs', () => {
    const parts = [{ id: 'a', text: 'first', sources: [] }, { id: 'b', text: 'second', sources: [] }];
    const custom = { id: 'custom:test', text: '{literal} <b>text</b>' };
    const layout = ['a', 'inactive', custom, 'b'];
    assert.deepEqual(composer.ordered(parts, layout).map(p => p.text), ['first', custom.text, 'second']);
    assert.deepEqual(composer.move(layout, parts, 'b', 'a'), ['b', 'a', 'inactive', custom]);
    assert.deepEqual(normaliseLayout({ portrait: layout }).portrait, layout);
});

test('random placeholders hide sampled values and retain connective prose', () => {
    assert.equal(composer.display({ text: 'a mechanic', prefix: 'a ', suffix: '', randomSources: ['Role'] }), 'a [Random value from Role]');
    assert.equal(composer.display({ text: 'chief mechanic', randomSources: [] }), 'chief mechanic');
});

test('layouts reject malformed, duplicate and oversized snippets', () => {
    for (const input of [[], { other: [] }, { portrait: 'x' }, { portrait: ['a', 'a'] },
        { portrait: [{ id: 'not-custom', text: 'hi' }] }, { portrait: [{ id: 'custom:a', text: 3 }] },
        { portrait: [{ id: 'custom:a', text: 'x'.repeat(4001) }] }]) {
        assert.throws(() => normaliseLayout(input), /promptLayout|snippet/);
    }
});

test('secret creation sends composition but public creation does not', () => {
    const promptLayout = { portrait: ['extra:camera'] };
    const options = { method: 'POST', body: '{}' };
    const selected = { promptLayout };
    assert.deepEqual(JSON.parse(ui.routeRequest('/api/create-npc', options, true, selected).options.body).promptLayout, promptLayout);
    assert.equal(JSON.parse(ui.routeRequest('/api/create-npc', options, false, selected).options.body).promptLayout, undefined);
});
