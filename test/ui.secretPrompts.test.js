const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/*
 * The Secret prompt select of Create NPC: the request router carrying the
 * pick, the markup, the read-only composer while a template is chosen,
 * and the source-level pins of secret-mode.js and app.js the way
 * ui.secretTables does.
 */

const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
const ui = () => require('../public/secret-mode');

function composerPage(locked, request = async () => ({ portrait: [
    { id: 'npc:identity', text: 'A mechanic', sources: ['Role'], randomSources: ['Role'] },
    { id: 'secret:Poses', text: ' kneeling.', sources: ['Poses'], randomSources: ['Poses'] },
], token: [] })) {
    class Element {
        constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.style = { setProperty() {} }; this.classList = { add() {}, remove() {} }; this.textContent = ''; this.value = ''; }
        append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
        replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
        addEventListener(type, action) { (this.listeners[type] ||= []).push(action); }
        dispatch(type, extra = {}) { for (const action of this.listeners[type] || []) action({ target: this, preventDefault() {}, stopPropagation() {}, ...extra }); }
        setAttribute(key, value) { this[key] = value; }
        focus() { this.focused = true; }
        closest() { return form; }
        contains(node) { return node === this || this.children.some(child => child.contains(node)); }
        querySelectorAll(selector) {
            const attribute = selector.match(/^\[data-(.*)\]$/)?.[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            return this.children.flatMap(child => [...((attribute ? Object.hasOwn(child.dataset, attribute) : child.tag === selector) ? [child] : []), ...child.querySelectorAll(selector)]);
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    }
    const form = new Element(), element = new Element(); form.append(element);
    for (const name of ['target', 'pills', 'status', 'prose', 'add', 'reset']) {
        const node = new Element(); node.dataset['composer' + name[0].toUpperCase() + name.slice(1)] = ''; element.append(node);
    }
    const timers = new Map(); let next = 0;
    const window = { crypto: { randomUUID: () => 'test-custom' } };
    const context = vm.createContext({ window, document: { createElement: tag => new Element(tag), getElementById: () => null },
        setTimeout: callback => { timers.set(++next, callback); return next; }, clearTimeout: id => timers.delete(id) });
    vm.runInContext(read('prompt-composer.js'), context);
    const controller = window.PromptComposer.create({ element, request, getRequest: () => ({}), active: () => true, locked });
    const node = name => element.querySelector(`[data-composer-${name}]`);
    const flush = async () => { const pending = [...timers.values()]; timers.clear(); await Promise.all(pending.map(callback => callback())); };
    return { controller, node, flush };
}

test('a locked composer previews the filled template read-only', async () => {
    let locked = true;
    const view = composerPage(() => locked); await view.flush();
    assert.match(view.node('prose').textContent, /Random value from Poses/);
    assert.equal(view.node('pills').querySelectorAll('[data-handle]').length, 0);
    assert.equal(view.node('add').disabled, true);
    assert.equal(view.node('reset').disabled, true);
    assert.match(view.node('status').textContent, /template fixes the order/);
    assert.deepEqual(Object.keys(view.controller.getLayout()), []);
    locked = false;
    // setLayout re-renders at once; refresh() alone would skip an unchanged request.
    view.controller.setLayout({}); await view.flush();
    assert.equal(view.node('pills').querySelectorAll('[data-handle]').length, 2);
    assert.equal(view.node('add').disabled, false);
});

test('locking ignores a saved layout without losing it', async () => {
    let locked = false;
    const view = composerPage(() => locked); await view.flush();
    const layout = { portrait: ['secret:Poses', 'npc:identity', { id: 'custom:extra', text: 'Extra pill.' }] };
    view.controller.setLayout(layout); await view.flush();
    assert.equal(view.node('pills').children.length, 3);
    assert.equal(view.node('pills').querySelectorAll('textarea').length, 1);
    assert.equal(view.node('pills').children[0].dataset.partId, 'secret:Poses');
    locked = true;
    // setLayout re-renders at once, with the same layout, so nothing but locked() changes.
    view.controller.setLayout(layout); await view.flush();
    assert.equal(view.node('pills').children.length, 2);
    assert.equal(view.node('pills').querySelectorAll('textarea').length, 0);
    assert.equal(view.node('pills').children[0].dataset.partId, 'npc:identity');
    assert.equal(view.node('pills').children[1].dataset.partId, 'secret:Poses');
    assert.deepEqual(Object.keys(view.controller.getLayout()), []);
    locked = false;
    view.controller.setLayout(layout); await view.flush();
    assert.equal(view.node('pills').querySelectorAll('textarea').length, 1);
});

test('a logged-in NPC create carries the secret prompt and drops the composition fields', () => {
    const options = { method: 'POST', body: JSON.stringify({ count: 1 }) };
    const pick = { file: 'explicit-v1.md', name: 'random' };
    const picks = { extraTables: [{ file: 'a.json', tables: ['one'] }], disabledTables: ['Stance'] };
    const npc = ui().routeRequest('/api/create-npc', options, true, { npc: 'ink', secretTables: picks, promptLayout: { portrait: ['shot'] }, secretPrompt: pick });
    assert.equal(npc.path, '/api/secret/create');
    assert.deepEqual(JSON.parse(npc.options.body), { count: 1, kind: 'npc', artStyle: 'ink', secretPrompt: pick });
    const none = ui().routeRequest('/api/create-npc', options, true, { npc: 'ink', secretTables: picks, secretPrompt: null });
    assert.deepEqual(JSON.parse(none.options.body), { count: 1, kind: 'npc', artStyle: 'ink', ...picks });
    const ship = ui().routeRequest('/api/create', { method: 'POST', body: '{"kind":"spaceship"}' }, true, { secretPrompt: pick });
    assert.deepEqual(JSON.parse(ship.options.body), { kind: 'spaceship', artStyle: 'default' });
    const loggedOut = ui().routeRequest('/api/create-npc', options, false, { secretPrompt: pick });
    assert.deepEqual(JSON.parse(loggedOut.options.body), { count: 1, artStyle: 'default' });
});

test('the markup ships the select hidden, just before the secret tables section', () => {
    const html = read('index.html');
    const section = html.indexOf('id="secret-prompt-section"');
    assert.notEqual(section, -1);
    assert.match(html.slice(section, section + 60), /hidden/);
    assert.ok(section > html.indexOf('id="add-override"'));
    assert.ok(section < html.indexOf('id="secret-tables-section"'));
    for (const id of ['secret-prompt-select', 'secret-prompt-status', 'secret-prompt-summary']) assert.ok(html.includes(`id="${id}"`), id);
});

test('secret-mode.js fills the select from the listing, locks pins, labels the gallery and clears on logout', () => {
    const js = read('secret-mode.js');
    assert.match(js, /json\('\/api\/secret\/prompts'\)/);
    assert.match(js, /Random from \$\{/);
    assert.match(js, /locked: \(\) => !!promptPick/);
    assert.match(js, /Pinned by the selected secret prompt|locked: true/);
    assert.match(js, /Secret prompt: \$\{item\.secretPrompt\.name\}/);
    assert.match(js, /secretPrompt: secretPromptPick\(\)/);
    assert.match(js, /Reload Secret mode: secret prompt/);
    const clear = js.slice(js.indexOf('function clearPrivateView'), js.indexOf('function expire'));
    assert.match(clear, /promptPick = null/);
    assert.match(clear, /secret-prompt-section'\)\.hidden = true|secret-prompt-section'\)\) get\('secret-prompt-section'\)\.hidden = true/);
    // The detail sheet offers Re-roll on a slot table the record can re-roll.
    const detail = js.slice(js.indexOf('function openDetail'), js.indexOf('function stepDetail'));
    assert.match(detail, /item\.extraTraits[\s\S]*rerollable[\s\S]*includes\(key\)/);
});

test('app.js renders locked override rows and keeps them out of requests and presets', () => {
    const js = read('app.js');
    const rows = js.slice(js.indexOf('function renderOverrideRows'), js.indexOf('function createRequestBody'));
    assert.match(rows, /override\.locked/);
    assert.match(rows, /Pinned by the selected secret prompt/);
    const body = js.slice(js.indexOf('function createRequestBody'), js.indexOf('async function startCreateJob'));
    assert.match(body, /!o\.locked/);
    const settings = js.slice(js.indexOf('function createFormSettings'), js.indexOf('function applyCreateSettings'));
    assert.match(settings, /!o\.locked/);
});

test('the composer preview request carries the secret prompt pick', () => {
    const js = read('secret-mode.js');
    const call = js.slice(js.indexOf('PromptComposer.create('), js.indexOf('request: body => post('));
    assert.match(call, /secretPrompt: secretPromptPick\(\)/);
});

test('applySecretSettings releases the pin lock before applying a preset', () => {
    const js = read('secret-mode.js');
    const settings = js.slice(js.indexOf('function applySecretSettings'), js.indexOf('function setSecretTablesCollapsed'));
    const lockIndex = settings.indexOf('lockPins({})');
    const applyIndex = settings.indexOf('applyCreateSettings(');
    assert.notEqual(lockIndex, -1);
    assert.notEqual(applyIndex, -1);
    assert.ok(lockIndex < applyIndex);
});
