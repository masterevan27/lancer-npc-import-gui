const test = require('node:test');
const assert = require('node:assert/strict');

// These tests exercise the same request transport used by the browser. A late
// private reply after logout must be discarded before its JSON reaches a view.
const ui = () => require('../public/secret-mode');

test('custom image dimensions travel only with authenticated NPC and ship creation', () => {
    for (const kind of ['npc', 'spaceship']) {
        const options = { method: 'POST', body: JSON.stringify({ kind }) };
        const selections = { dimensions: { [kind]: { width: 1920, height: 1080 } } };
        const privateBody = JSON.parse(ui().routeRequest('/api/create', options, true, selections).options.body);
        assert.equal(privateBody.width, 1920);
        assert.equal(privateBody.height, 1080);
        const publicBody = JSON.parse(ui().routeRequest('/api/create', options, false, selections).options.body);
        assert.equal(publicBody.width, undefined);
        assert.equal(publicBody.height, undefined);
    }
});

test('public selectors discard hidden and secret records and retain Default', () => {
    const styles = [{ id: 'ink', name: 'Ink' }, { id: 'hidden', name: 'Private', hidden: true },
        { id: 'alias', name: 'Alias', secret: true }];
    assert.deepEqual(ui().visibleStyles(styles, false).map(s => s.id), ['default', 'ink']);
    assert.deepEqual(ui().visibleStyles(styles, true).map(s => s.id), ['default', 'ink', 'hidden', 'alias']);
    assert.deepEqual(ui().visibleStyles([], false).map(s => s.id), ['default']);
});

test('Secret creation and background requests route privately with selected styles', () => {
    const options = { method: 'POST', body: JSON.stringify({ count: 2 }) };
    const request = ui().routeRequest('/api/create-npc', options, true, { npc: 'ink' });
    assert.equal(request.path, '/api/secret/create');
    assert.deepEqual(JSON.parse(request.options.body), { count: 2, kind: 'npc', artStyle: 'ink' });
    const bg = ui().routeRequest('/api/backgrounds/dynamic/preview', options, true, { background: 'ink' });
    assert.equal(bg.path, '/api/secret/backgrounds/dynamic/preview');
    assert.equal(JSON.parse(bg.options.body).artStyle, 'ink');
    assert.equal(ui().routeRequest('/api/create-status?jobId=a', {}, true, {}).path,
        '/api/secret/create-status?jobId=a');
});

test('public generation sends its style and keeps normal routes', () => {
    const request = ui().routeRequest('/api/create', { method: 'POST', body: '{"kind":"spaceship"}' }, false, { spaceship: 'ink' });
    assert.equal(request.path, '/api/create');
    assert.equal(JSON.parse(request.options.body).artStyle, 'ink');
    assert.equal(ui().routeRequest('/api/settings', {}, true, {}).path, '/api/settings');
});

test('NPC creation carries the selected colour guidance; other kinds do not', () => {
    const options = { method: 'POST', body: JSON.stringify({ count: 1 }) };
    const selections = { npc: 'ink', background: 'ink', colorGuidance: { npc: 'ochre' } };
    const request = ui().routeRequest('/api/create-npc', options, false, selections);
    assert.equal(request.path, '/api/create-npc');
    assert.equal(JSON.parse(request.options.body).colorGuidance, 'ochre');
    const priv = ui().routeRequest('/api/create-npc', options, true, selections);
    assert.equal(priv.path, '/api/secret/create');
    assert.equal(JSON.parse(priv.options.body).colorGuidance, 'ochre');
    const bg = ui().routeRequest('/api/backgrounds/dynamic/preview', options, false, selections);
    assert.equal('colorGuidance' in JSON.parse(bg.options.body), false);
    const legacy = ui().routeRequest('/api/create-npc', options, false, { npc: 'ink' });
    assert.equal('colorGuidance' in JSON.parse(legacy.options.body), false);
});

test('an in-flight private body cannot reach the caller after logout', async () => {
    let finish;
    const transport = ui().createTransport(async () => ({ status: 200, headers: {},
        text: () => new Promise(resolve => { finish = resolve; }) }));
    transport.setAuthenticated(true);
    const pending = transport.fetch('/api/secret/items');
    await new Promise(resolve => setImmediate(resolve));
    transport.setAuthenticated(false);
    finish('{"items":[{"name":"private name"}]}');
    await assert.rejects(pending, /session changed/i);
});

test('expired private requests clear authentication without returning the body', async () => {
    let expired = false;
    const transport = ui().createTransport(async () => new Response('{"error":"unauthorized"}', { status: 401 }),
        () => { expired = true; });
    transport.setAuthenticated(true);
    await assert.rejects(transport.fetch('/api/secret/items'), /session expired/i);
    assert.equal(transport.authenticated, false);
    assert.equal(expired, true);
});

async function page(authenticated, privateItems, respond = () => undefined) {
    const fs = require('node:fs'), vm = require('node:vm');
    const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
    class Element {
        constructor() { this.children = []; this.value = ''; this.hidden = false; this.disabled = false; this.textContent = ''; this.listeners = {}; this.dataset = {}; this.classList = { add() {}, remove() {}, toggle() {} }; }
        addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
        removeEventListener(name, callback) { this.listeners[name] = (this.listeners[name] || []).filter(fn => fn !== callback); }
        click() { return this.dispatch('click'); }
        async dispatch(name, extra = {}) { for (const callback of this.listeners[name] || []) await callback({ preventDefault() {}, target: this, ...extra }); }
        replaceChildren(...children) { this.children = children; }
        append(...children) { this.children.push(...children); }
        querySelectorAll() { return []; }
        focus() { this.focused = true; }
        scrollIntoView() { this.scrolled = true; }
        setAttribute(name, value) { (this.attributes ||= {})[name] = value; }
        get options() { return this.children; }
        get selectedOptions() { return this.children.filter(option => option.value === this.value); }
    }
    const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
    nodes['set-trait-overlay'].hidden = true;
    const selectors = ['create-art-style', 'create-ship-art-style', 'bg-art-style', 'regen-art-style'].map(id => nodes[id]);
    const guidanceSelectors = ['create-color-guidance', 'regen-color-guidance'].map(id => nodes[id]);
    const document = new Element(); document.body = new Element();
    document.getElementById = id => nodes[id] || null;
    document.createElement = () => new Element();
    const workflows = ['create-workflow', 'create-ship-workflow', 'bg-workflow', 'regen-workflow', 'secret-regen-workflow'].map(id => nodes[id]);
    const descendants = node => [node, ...(node.children || []).flatMap(child => typeof child === 'object' ? descendants(child) : [])];
    document.querySelectorAll = query => query === '[data-art-style]' ? selectors : query === '[data-workflow]' ? workflows
        : query === '[data-color-guidance]' ? guidanceSelectors
        : ['[data-secret-table]', '[data-secret-file]', '[data-disable-table]'].includes(query)
            ? [...new Set(Object.values(nodes).flatMap(descendants))].filter(node => {
                const key = query === '[data-secret-table]' ? 'secretTable' : query === '[data-secret-file]' ? 'secretFile' : 'disableTable';
                return node.dataset && key in node.dataset;
            }) : [];
    document.querySelector = query => query.includes('data-color-guidance') ? guidanceSelectors[0]
        : (query.includes('data-workflow') ? workflows : selectors)[['npc', 'spaceship', 'background'].findIndex(kind => query.includes(`"${kind}"`))] || null;
    const requests = [], navigations = [];
    const window = new Element();
    window.location = { replace: path => navigations.push(path) };
    window.setInterval = () => 1;
    window.setTimeout = callback => setImmediate(callback);
    window.fetch = async (path, options = {}) => {
        requests.push({ path, options });
        let body = {};
        if (path === '/api/secret/session') body = { authenticated, configured: true };
        if (path === '/api/art-styles') body = { styles: [
            { id: 'ink', name: 'Ink' }, { id: 'private-ink', name: 'Private Ink', hidden: true }
        ] };
        if (path === '/api/workflows') body = { workflows: [{ id: 'Public.json', name: 'Public' }, { id: 'secret/Private.json', name: 'Private', hidden: true }] };
        if (path === '/api/color-guidance') body = { guidance: [
            { id: 'ochre', name: 'Ochre' }, { id: 'private-ochre', name: 'Private Ochre', hidden: true }
        ] };
        if (path === '/api/secret/items') body = { items: privateItems || [{ id: 'one', kind: 'npc', name: 'Private NPC',
            portraitUrl: '/api/secret/image?rel=one.png', portraitPrompt: 'Private portrait prompt', artStyle: { name: 'Private Ink' } }] };
        const custom = await respond(path, options);
        return new Response(JSON.stringify(custom === undefined ? body : custom), { status: 200 });
    };
    function Option(text, value) { this.textContent = text; this.value = value; }
    const app = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
    // The slice starts at CAN_HOVER, not at the function itself: the
    // listeners close over that const, so leaving it out of the span would
    // resolve it as an undefined global the moment a listener fires. A
    // matches: true stub keeps this test's mouseenter/mouseleave simulation
    // on the "device can hover" branch, same as before the tap path existed.
    const zoomCode = app.slice(app.indexOf('const CAN_HOVER'), app.indexOf('attachImageZoom(el.detailPortrait)'));
    const attachImageZoom = new Function('el', 'window', zoomCode + '; return attachImageZoom;')(
        { imageZoom: nodes['image-zoom'], imageZoomImg: nodes['image-zoom-img'] },
        { matchMedia: () => ({ matches: true }) },
    );
    const elSetTrait = Object.fromEntries(['overlay', 'title', 'filter', 'list', 'releaseRow', 'release', 'releaseLabel', 'warning', 'cancel', 'ok']
        .map(key => [key, nodes['set-trait-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())]]));
    const context = vm.createContext({ window, document, Option, Response, console, setTimeout, Date, attachImageZoom, elSetTrait,
        elCreate: Object.fromEntries(['count', 'seed', 'name', 'pronouns', 'server', 'portrait', 'token', 'keepRaw', 'unarmed']
            .map(key => [key, nodes['create-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())]])),
        createState: { overrides: [] }, renderOverrideRows() {},
        fetch: (...args) => window.SecretMode.fetch(...args), escapeHtml: text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') });
    vm.runInContext(app.slice(app.indexOf('function createFormSettings('), app.indexOf('function setPresetStatus(')), context);
    vm.runInContext(app.slice(app.indexOf('function groupChoices('), app.indexOf('function traitControlCells('))
        + app.slice(app.indexOf('function openSetTrait('), app.indexOf('function markSeen(')), context);
    vm.runInContext(fs.readFileSync(require.resolve('../public/secret-mode'), 'utf8'), context);
    await document.dispatch('DOMContentLoaded');
    await new Promise(resolve => setImmediate(resolve));
    return { nodes, window, document, requests, navigations };
}

test('secret table selections expose their full text and clear the preview when disabled or random', async () => {
    const value = 'A long scene description with enough detail to need several lines in a narrow table row. '.repeat(5);
    const { document, nodes } = await page(true, [], path => {
        if (path === '/api/secret/tables') return { exists: true, files: [
            { file: 'scenes.json', tables: [{ name: 'Scene', count: 1, values: [value] }] },
        ] };
    });
    const input = document.querySelectorAll('[data-secret-table]')[0];
    const preview = nodes['secret-tables-files'].children[0].children[1].children
        .find(node => node.className === 'secret-table-value')?.children
        .find(node => node.className === 'secret-table-value-preview');
    assert.ok(preview, 'each value picker has a readable full-text preview');
    assert.equal(preview.hidden, true);
    input.checked = true;
    await input.dispatch('change');
    input.valueSelect.value = value;
    await input.valueSelect.dispatch('change');
    assert.equal(preview.textContent, value);
    assert.equal(preview.hidden, false);
    input.checked = false;
    await input.dispatch('change');
    assert.equal(preview.hidden, true);
    input.checked = true;
    await input.dispatch('change');
    assert.equal(preview.hidden, false);
    input.valueSelect.value = '';
    await input.valueSelect.dispatch('change');
    assert.equal(preview.hidden, true);
    assert.equal(preview.textContent, '');
});

test('secret presets restore fixed table values and collapsing preserves the create request', async () => {
    let saved;
    const { nodes, document, window, requests } = await page(true, [], (path, options) => {
        if (path === '/api/secret/tables') return { exists: true, dir: '/private/tables', disableable: ['Stance', 'Backdrop', 'Callsigns'], files: [
            { file: 'a.json', tables: [{ name: 'mood', count: 2, values: ['soft light', 'harsh light'] },
                { name: 'constructor', count: 1, values: ['a jacket'] }] }
        ] };
        if (path === '/api/secret/presets' && options.method === 'POST') {
            saved = JSON.parse(options.body); return { slug: 'private-recipe' };
        }
        if (path === '/api/secret/presets') return { presets: saved ? [{ name: saved.name, slug: 'private-recipe' }] : [] };
        if (path.startsWith('/api/secret/presets/export')) return saved;
    });
    window.prompt = () => 'Private recipe';
    const input = document.querySelectorAll('[data-secret-table]')[0];
    input.checked = true; await input.dispatch('change');
    assert.equal(input.valueSelect.disabled, false);
    assert.equal(input.targetInputs.portrait.checked, true);
    assert.equal(input.targetInputs.token.checked, true);
    input.targetInputs.token.checked = false;
    await input.targetInputs.token.dispatch('change');
    assert.equal(input.targetInputs.portrait.disabled, true, 'keep at least one image target');
    input.valueSelect.value = 'soft light';
    const randomInput = document.querySelectorAll('[data-secret-table]')[1];
    randomInput.checked = true;
    const disabledBoxes = document.querySelectorAll('[data-disable-table]');
    assert.deepEqual(disabledBoxes.map(box => box.dataset.disableTable), ['Stance', 'Backdrop', 'Callsigns']);
    disabledBoxes[1].checked = true;
    disabledBoxes[2].checked = true;
    nodes['create-count'].value = '3'; nodes['create-seed'].value = '42';
    nodes['secret-npc-width'].value = '1920'; nodes['secret-npc-height'].value = '1080';
    nodes['create-art-style'].value = 'private-ink';
    await nodes['secret-preset-save'].dispatch('click');
    assert.deepEqual(saved.settings.extraTables, [{ file: 'a.json', tables: ['mood', 'constructor'], values: { mood: 'soft light' }, targets: { mood: 'portrait' } }]);
    assert.equal(saved.settings.artStyle, 'private-ink');
    assert.equal(saved.settings.width, '1920');
    assert.equal(saved.settings.height, '1080');
    nodes['secret-npc-width'].value = ''; nodes['secret-npc-height'].value = '';
    assert.deepEqual(saved.settings.disabledTables, ['Backdrop', 'Callsigns']);
    for (const box of disabledBoxes) box.checked = false;
    input.checked = false; input.valueSelect.value = '';
    input.targetInputs.portrait.checked = false;
    input.targetInputs.token.checked = true;
    nodes['create-count'].value = '1'; nodes['create-art-style'].value = 'default';
    await nodes['secret-preset-load'].dispatch('click');
    assert.equal(nodes['create-count'].value, '3');
    assert.equal(nodes['secret-npc-width'].value, '1920');
    assert.equal(nodes['secret-npc-height'].value, '1080');
    assert.equal(nodes['create-art-style'].value, 'private-ink');
    assert.equal(input.checked, true); assert.equal(input.valueSelect.value, 'soft light');
    assert.equal(input.targetInputs.portrait.checked, true);
    assert.equal(input.targetInputs.token.checked, false);
    assert.equal(randomInput.targetInputs.portrait.checked, true);
    assert.equal(randomInput.targetInputs.token.checked, true);
    assert.deepEqual(disabledBoxes.map(box => box.checked), [false, true, true]);
    await nodes['secret-tables-collapse'].dispatch('click');
    assert.equal(nodes['secret-tables-content'].hidden, true);
    assert.equal(nodes['secret-tables-toggle'].focused, true);
    assert.equal(nodes['secret-tables-toggle'].attributes['aria-expanded'], 'false');
    await window.SecretMode.fetch('/api/create-npc', { method: 'POST', body: '{"count":3}' });
    assert.deepEqual(JSON.parse(requests.at(-1).options.body).extraTables, saved.settings.extraTables);
    assert.deepEqual(JSON.parse(requests.at(-1).options.body).disabledTables, ['Backdrop', 'Callsigns']);
    assert.equal(JSON.parse(requests.at(-1).options.body).width, '1920');
    assert.equal(JSON.parse(requests.at(-1).options.body).height, '1080');
    await nodes['secret-tables-toggle'].dispatch('click');
    assert.equal(nodes['secret-tables-content'].hidden, false);
    assert.equal(input.valueSelect.value, 'soft light');
    const all = document.querySelectorAll('[data-secret-file]').find(box => box.secretInputs);
    all.checked = false; await all.dispatch('change');
    assert.equal(input.targetInputs.token.disabled, true);
    all.checked = true; await all.dispatch('change');
    assert.equal(input.targetInputs.portrait.checked, true);
    assert.equal(input.targetInputs.token.checked, false, 'file toggle preserves targets');
    assert.equal(input.targetInputs.token.disabled, false);
    delete saved.settings.extraTables[0].targets;
    await nodes['secret-preset-load'].dispatch('click');
    assert.equal(input.targetInputs.portrait.checked, true);
    assert.equal(input.targetInputs.token.checked, true, 'legacy presets restore both targets');
    await nodes['leave-secret'].dispatch('click');
    assert.equal(nodes['secret-presets-section'].hidden, true);
    assert.equal(nodes['secret-preset-select'].children.length, 0);
    assert.equal(nodes['secret-npc-dimensions'].hidden, true);
    assert.equal(nodes['secret-npc-width'].value, '');
});

test('private detail cycles through filtered items and offers per-trait rerolls', async () => {
    const { nodes, document } = await page(true, [
        { id: 'a', name: 'Alpha', kind: 'npc', traits: { Gear: 'tool', Pronouns: 'she' }, rerollable: ['Gear'] },
        { id: 'b', name: 'Beta', kind: 'npc', traits: {}, rerollable: [] },
    ]);
    await nodes['secret-grid'].children[0].dispatch('click');
    assert.equal(nodes['secret-detail-traits'].children[0].children[0].children[0].textContent, 'Re-roll');
    await document.dispatch('keydown', { key: 'ArrowRight' });
    assert.equal(nodes['secret-detail-name'].textContent, 'Beta');
    await document.dispatch('keydown', { key: 'ArrowLeft' });
    assert.equal(nodes['secret-detail-name'].textContent, 'Alpha');
});

test('Secret Set opens the shared picker, saves its exact value and refreshes the detail', async () => {
    const items = [{ id: 'a', name: 'Alpha', kind: 'npc', secret: true, hasRawTraits: true,
        traits: { Outfit: 'jacket', Headgear: 'helmet' }, rerollable: ['Outfit'] }];
    const { nodes, requests, document } = await page(true, items, (path, options) => {
        if (path.startsWith('/api/secret/trait-choices?')) return { choices: [
            { value: 'robe || civ', label: 'robe · civ', allowed: true, current: false, conflicts: ['Headgear'], releases: ['Headgear'] },
        ] };
        if (path === '/api/secret/set-trait') {
            items[0].traits.Outfit = 'robe'; items[0].portraitPrompt = 'wearing a robe'; items[0].artStale = true;
            return { jobId: 'edit' };
        }
        if (path === '/api/secret/create-status?jobId=edit') return { status: 'done' };
    });
    await nodes['secret-grid'].children[0].dispatch('click');
    const button = nodes['secret-detail-traits'].children[0].children.flatMap(cell => cell.children).find(node => node.className === 'set-trait-btn');
    assert.ok(button, 'the private NPC row offers Set');
    const pending = button.dispatch('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes['set-trait-overlay'].hidden, false);
    assert.ok(requests.some(request => request.path === '/api/secret/trait-choices?id=a&trait=Outfit'));
    assert.match(nodes['set-trait-list'].innerHTML, /robe/);
    await document.dispatch('keydown', { key: 'ArrowRight' });
    assert.equal(nodes['secret-detail-name'].textContent, 'Alpha');
    await nodes['set-trait-list'].dispatch('change', { target: { value: 'robe || civ' } });
    assert.equal(nodes['set-trait-release-row'].hidden, false);
    nodes['set-trait-release'].checked = true;
    await nodes['set-trait-ok'].dispatch('click');
    await pending;
    const sent = requests.find(request => request.path === '/api/secret/set-trait');
    assert.deepEqual(JSON.parse(sent.options.body), { id: 'a', trait: 'Outfit', value: 'robe || civ', release: ['Headgear'] });
    assert.ok(nodes['secret-detail-traits'].children[0].children.some(cell => cell.textContent === 'robe'));
    assert.match(nodes['secret-detail-prompts'].textContent, /wearing a robe/);
    assert.match(nodes['secret-detail-status'].textContent, /Regenerate/);
});

test('leaving Secret clears the open picker and discards a late choices response', async () => {
    let finish;
    const { nodes, requests } = await page(true, [{ id: 'a', name: 'Alpha', kind: 'npc', secret: true,
        hasRawTraits: true, traits: { Outfit: 'jacket' }, rerollable: ['Outfit'] }], path => {
        if (path.startsWith('/api/secret/trait-choices?')) return new Promise(resolve => { finish = resolve; });
    });
    await nodes['secret-grid'].children[0].dispatch('click');
    const button = nodes['secret-detail-traits'].children[0].children.flatMap(cell => cell.children).find(node => node.className === 'set-trait-btn');
    assert.ok(button, 'the private NPC row offers Set');
    const pending = button.dispatch('click');
    await new Promise(resolve => setImmediate(resolve));
    await nodes['leave-secret'].dispatch('click');
    assert.equal(nodes['set-trait-overlay'].hidden, true);
    finish({ choices: [{ value: 'private choice', label: 'private choice', conflicts: [], releases: [] }] });
    await pending;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes['set-trait-list'].textContent, '');
    assert.equal(requests.some(request => request.path === '/api/secret/set-trait'), false);
});

test('logged-out page populates all selectors without hidden names', async () => {
    const { nodes } = await page(false);
    for (const id of ['create-art-style', 'create-ship-art-style', 'bg-art-style', 'regen-art-style']) {
        assert.deepEqual(nodes[id].children.map(option => option.value), ['default', 'ink']);
        assert.equal(nodes[id].value, 'default');
    }
    for (const id of ['create-color-guidance', 'regen-color-guidance']) {
        assert.deepEqual(nodes[id].children.map(option => option.value), ['default', 'ochre']);
        assert.equal(nodes[id].value, 'default');
        assert.equal(nodes[id].disabled, false);
    }
    assert.equal(nodes['leave-secret'].hidden, true);
    assert.equal(nodes['secret-images'].hidden, true);
    assert.equal(nodes['secret-storage'].hidden, true);
});

test('authenticated page displays private controls, sends chosen style, and renders prompts', async () => {
    const { nodes, window, requests } = await page(true);
    assert.equal(nodes['leave-secret'].hidden, false);
    assert.equal(nodes['secret-images'].hidden, false);
    assert.equal(nodes['public-gallery'].hidden, true);
    assert.equal(nodes['secret-grid'].children.length, 1);
    await nodes['secret-grid'].children[0].dispatch('click');
    assert.match(nodes['secret-detail-prompts'].textContent, /Private portrait prompt/);
    const portrait = nodes['secret-detail-images'].children[0].children[0];
    await portrait.dispatch('mouseenter');
    assert.equal(nodes['image-zoom'].hidden, false);
    assert.equal(nodes['image-zoom-img'].src, '/api/secret/image?rel=one.png');
    await portrait.dispatch('mouseleave');
    assert.equal(nodes['image-zoom'].hidden, true);
    nodes['create-art-style'].value = 'private-ink';
    nodes['create-workflow'].value = 'secret/Private.json';
    nodes['create-color-guidance'].value = 'private-ochre';
    await window.SecretMode.fetch('/api/create-npc', { method: 'POST', body: '{}' });
    const sent = requests.at(-1);
    assert.equal(sent.path, '/api/secret/create');
    assert.equal(JSON.parse(sent.options.body).artStyle, 'private-ink');
    assert.equal(JSON.parse(sent.options.body).workflow, 'secret/Private.json');
    assert.equal(JSON.parse(sent.options.body).colorGuidance, 'private-ochre');
});

test('Leave Secret invalidates the session and removes private DOM before navigation', async () => {
    const { nodes, window, requests, navigations } = await page(true);
    await nodes['leave-secret'].dispatch('click');
    assert.equal(requests.at(-1).path, '/api/secret/logout');
    assert.equal(window.SecretMode.active, false);
    assert.equal(nodes['secret-grid'].children.length, 0);
    assert.deepEqual(nodes['create-art-style'].children.map(option => option.value), ['default']);
    assert.equal(navigations.at(-1), '/');
});

test('private background details display saved scene prompts and traits', async () => {
    const { nodes } = await page(true, [{ id: 'bg:one', kind: 'background', name: 'Private scene',
        portraitUrl: '/api/secret/image?rel=backgrounds/one.png',
        background: { scene: { prompt: 'Private scene prompt', traits: { Location: 'a station' } } } }]);
    await nodes['secret-grid'].children[0].dispatch('click');
    assert.match(nodes['secret-detail-prompts'].textContent, /Private scene prompt/);
    assert.equal(nodes['secret-detail-traits'].children[0].children[3].textContent, 'a station');
});

test('private catalogue completion refreshes without requiring an animation chain or public announcement', async () => {
    const source = require('node:fs').readFileSync(require.resolve('../public/app.js'), 'utf8');
    const code = source.slice(source.indexOf('async function startBackgroundRender()'), source.indexOf('elBackgrounds.catalogue.addEventListener'));
    let done, privateRefresh = 0, publicAnnouncements = 0, galleryRefresh = 0;
    const els = Object.fromEntries(['renderBtn', 'renderStatus', 'renderLog', 'variants', 'width', 'height',
        'rollSeed', 'seed', 'animateWhenDone', 'chainPingpong'].map(id => [id, { value: '1', checked: false }]));
    const start = new Function('backgroundsState', 'elBackgrounds', 'api', 'pollBackgroundJob',
        'announceBatchComplete', 'BACKGROUND_KIND', 'loadBackgrounds', 'watchBackgroundGalleryUntilSettled', 'window',
        code + '\nreturn startBackgroundRender;')(
        { prefix: 'scene', catalogue: 'backgrounds.md' }, els, async () => ({ jobId: 'private-job' }),
        (id, options) => { done = options.onDone; }, () => { publicAnnouncements++; }, 'background',
        async () => { galleryRefresh++; }, () => {}, { SecretMode: { generated() { privateRefresh++; } } });
    await start();
    done({ status: 'done', produced: 1, producedIds: ['bg:one'], secret: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(privateRefresh, 1);
    assert.equal(publicAnnouncements, 0);
    assert.equal(galleryRefresh, 1);
});
