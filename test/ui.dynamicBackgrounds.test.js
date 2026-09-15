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

test('changing population releases dependent people choices while preserving locks', () => {
    const plan = { traits: { Population: 'civilian', Activity: 'shopping', 'Clothing and equipment': 'casual', 'Adult age mix': 'older adults' } };
    assert.deepEqual(changeTrait(plan, 'Population', 'military', []), { Population: 'military', 'Adult age mix': 'older adults' });
    const locked = changeTrait(plan, 'Population', 'military', ['Activity']);
    assert.equal(locked.Activity, 'shopping');
    assert.equal(locked['Clothing and equipment'], undefined);
    assert.equal(changeTrait(plan, 'Activity', 'guard duty', []).Population, undefined);
});

test('scene life defaults and explicit opt-outs survive preview and render requests', () => {
    const defaults = sceneRequest(null, {}, []);
    assert.equal(defaults.populatePeople, true);
    assert.equal(defaults.populationDensity, 'natural');
    assert.equal(defaults.vegetation, 'balanced');
    assert.equal(defaults.interiorLife, true);
    for (const render of [false, true]) {
        const request = sceneRequest(null, { populatePeople: false, populationDensity: 'sparse',
            vegetation: 'none', interiorLife: false, count: 3 }, [], { render });
        assert.equal(request.populatePeople, false);
        assert.equal(request.populationDensity, 'sparse');
        assert.equal(request.vegetation, 'none');
        assert.equal(request.interiorLife, false);
    }
});

test('top-down disables people controls and returning to perspective restores the choice', () => {
    const { elements } = uiFixture();
    const people = elements.get('bg-dynamic-people');
    people.checked = true;
    elements.get('bg-dynamic-view').value = 'topdown';
    elements.get('bg-dynamic-view').listeners.change();
    assert.equal(people.disabled, true);
    assert.equal(elements.get('bg-dynamic-density').disabled, true);
    elements.get('bg-dynamic-view').value = 'perspective';
    elements.get('bg-dynamic-view').listeners.change();
    assert.equal(people.disabled, false);
    assert.equal(people.checked, true);
    assert.equal(elements.get('bg-dynamic-density').disabled, false);
});

test('loading a saved scene restores life settings and legacy scenes keep people off', async () => {
    const { elements, ui } = uiFixture();
    ui.onSelect({ rel: 'alive.png', scene: { environment: 'indoor', view: 'perspective', seed: 8,
        traits: {}, populatePeople: false, populationDensity: 'sparse', vegetation: 'lush', interiorLife: false } });
    await elements.get('bg-load-scene').listeners.click();
    assert.equal(elements.get('bg-dynamic-people').checked, false);
    assert.equal(elements.get('bg-dynamic-density').value, 'sparse');
    assert.equal(elements.get('bg-dynamic-vegetation').value, 'lush');
    assert.equal(elements.get('bg-dynamic-interior-life').checked, false);
    ui.onSelect({ rel: 'legacy.png', scene: { environment: 'indoor', seed: 3, traits: {} } });
    await elements.get('bg-load-scene').listeners.click();
    assert.equal(elements.get('bg-dynamic-people').checked, false);
    assert.equal(elements.get('bg-dynamic-vegetation').value, 'none');
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

test('people pickers are grouped and saved choices survive disabling people and changing view', async () => {
    const names = ['Population', 'Clothing and equipment', 'Armament', 'Adult age mix', 'Appearance variety', 'Activity'];
    const catalogue = { tables: [...names, 'Weather'].map((name) => ({ name,
        values: [{ text: name + ' choice', environments: ['outdoor'] }] })) };
    const { elements, ui } = uiFixture(async () => catalogue);
    await elements.get('bg-dynamic-refresh').listeners.click();
    ui.onSelect({ rel: 'people.png', scene: { environment: 'outdoor', view: 'perspective', seed: 19,
        populatePeople: true, traits: Object.fromEntries(names.map((name) => [name, name + ' choice'])) } });
    await elements.get('bg-load-scene').listeners.click();
    const pickers = elements.get('bg-dynamic-people-traits');
    assert.equal(pickers.children.length, names.length);
    assert.equal(elements.get('bg-dynamic-traits').children.length, 1);
    assert.equal(elements.get('bg-dynamic-people-options').hidden, false);
    const people = elements.get('bg-dynamic-people');
    people.checked = false; people.listeners.change();
    assert.equal(pickers.children.length, 0);
    assert.equal(elements.get('bg-dynamic-people-options').hidden, true);
    people.checked = true; people.listeners.change();
    elements.get('bg-dynamic-view').value = 'topdown';
    elements.get('bg-dynamic-view').listeners.change();
    assert.equal(pickers.children.length, 0);
    elements.get('bg-dynamic-view').value = 'perspective';
    elements.get('bg-dynamic-view').listeners.change();
    assert.equal(pickers.children.length, names.length);
    for (const [i, name] of names.entries()) {
        assert.equal(pickers.children[i].children[0].children[1].value, name + ' choice');
        assert.equal(pickers.children[i].children[1].children[0].checked, true);
    }
});

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
