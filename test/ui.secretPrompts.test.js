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
