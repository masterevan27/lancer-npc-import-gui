const test = require('node:test');
const assert = require('node:assert/strict');
const { sceneRequest, relevantValues, changeTrait } = require('../public/dynamic-backgrounds');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('changing weather releases unlocked motion but respects explicit locks', () => {
    const plan = { traits: { Weather: 'rain', Motion: 'rain falling', Lighting: 'lamps' } };
    assert.deepEqual(changeTrait(plan, 'Weather', 'snow', []), { Weather: 'snow', Lighting: 'lamps' });
    assert.equal(changeTrait(plan, 'Weather', 'snow', ['Motion']).Motion, 'rain falling');
});

function uiFixture(apiOverride) {
    const elements = new Map();
    function node() {
        return { value: '', children: [], listeners: {}, disabled: false, textContent: '', hidden: false,
            addEventListener(name, fn) { this.listeners[name] = fn; },
            append(...children) { this.children.push(...children); }, prepend() {},
            replaceChildren() { this.children = []; }, setAttribute() {}, scrollIntoView() {},
            querySelector() { return node(); }, querySelectorAll() { return []; } };
    }
    const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
        createElement: node, createTextNode: (text) => text };
    const watched = [];
    const context = { document, crypto: require('node:crypto').webcrypto,
        api: apiOverride || (async (url) => url.includes('catalogue') ? { tables: [] } : { jobId: 'map-a' }),
        pollBackgroundJob: (id, opts) => { watched.push({ id, opts }); return watched.length; },
        clearInterval() {}, loadBackgrounds: async () => {}, watchBackgroundGalleryUntilSettled() {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/dynamic-backgrounds.js'), 'utf8'), context);
    const ui = context.DynamicBackgrounds;
    ui.onGallery({ dynamicAvailable: true, items: [] });
    return { elements, ui, watched };
}

test('returning to a source resumes its active battlemap watcher without a gallery refresh', async () => {
    const { elements, ui, watched } = uiFixture();
    const a = { rel: 'a.png' }, b = { rel: 'b.png' };
    ui.onSelect(a);
    await elements.get('bg-map-btn').listeners.click();
    assert.equal(watched.length, 1);
    ui.onSelect(b); ui.onSelect(a);
    assert.equal(watched.length, 2);
    assert.equal(watched[1].id, 'map-a');
    assert.equal(elements.get('bg-map-btn').disabled, true);
});

test('a rejected pending map request restores controls after selecting away and back', async () => {
    let reject;
    const request = new Promise((resolve, fail) => { reject = fail; });
    const { elements, ui } = uiFixture(async (url) => url.includes('catalogue') ? { tables: [] } : request);
    const a = { rel: 'a.png' };
    ui.onSelect(a);
    const starting = elements.get('bg-map-btn').listeners.click();
    ui.onSelect({ rel: 'b.png' }); ui.onSelect(a);
    reject(new Error('source disappeared')); await starting;
    assert.equal(elements.get('bg-map-btn').disabled, false);
    assert.match(elements.get('bg-map-status').textContent, /source disappeared/);
});

test('a pool response arriving during preview keeps new trait controls disabled', async () => {
    let catalogue;
    const loading = new Promise((resolve) => { catalogue = resolve; });
    const { elements } = uiFixture((url) => url.includes('catalogue') ? loading : new Promise(() => {}));
    elements.get('bg-dynamic-environment').value = 'outdoor';
    elements.get('bg-dynamic-preview-btn').listeners.click();
    catalogue({ tables: [{ name: 'Weather', values: [{ text: 'rain', environments: ['outdoor'] }] }] });
    await Promise.resolve(); await Promise.resolve();
    const row = elements.get('bg-dynamic-traits').children[0];
    assert.equal(row.children[0].children[1].disabled, true);
    assert.equal(row.children[2].disabled, true);
});

test('single trait reroll retains every other chosen trait and sends only one scene', () => {
    const request = sceneRequest({ traits: { Weather: 'rain', Lighting: 'lamps' } },
        { environment: 'outdoor', seed: 123, count: 4 }, ['Weather'], { only: 'Lighting' });
    assert.deepEqual(request.traits, { Weather: 'rain' });
    assert.equal(request.count, 1); assert.equal(request.seed, 123);
    assert.deepEqual(request.locked, ['Weather']);
});

test('render preserves preview traits for first image and passes batch locks/count', () => {
    const request = sceneRequest({ traits: { Weather: 'rain', Lighting: 'lamps' } },
        { environment: 'outdoor', seed: 0, count: 4, width: 1920, height: 1080 }, ['Lighting'], { render: true });
    assert.equal(request.count, 4); assert.equal(request.seed, 0);
    assert.equal(request.traits.Weather, 'rain'); assert.deepEqual(request.locked, ['Lighting']);
});

test('randomize sends explicit reroll policy and indoor picker excludes outdoor entries', () => {
    const request = sceneRequest(null, { seed: null, count: 2 }, [], { reroll: true });
    assert.equal(request.reroll, true); assert.equal(request.seed, null);
    const values = [{ text: 'rain', environments: ['outdoor'] }, { text: 'lamps', environments: ['indoor', 'outdoor'] }];
    assert.deepEqual(relevantValues({ values }, 'indoor'), [values[1]]);
});
