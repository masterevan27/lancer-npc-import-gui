const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function page(request = async () => ({ portrait: [
    { id: 'shot', text: 'A portrait', sources: ['Backdrop'], randomSources: ['Backdrop'] },
    { id: 'identity:role', text: ' of a mechanic.', sources: ['Role'] },
], token: [{ id: 'stance_line', text: 'Standing.', sources: ['Stance'] }] })) {
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
    const timers = new Map(); let next = 0, active = true, body = {};
    const window = { crypto: { randomUUID: () => 'test-custom' } };
    const context = vm.createContext({ window, document: { createElement: tag => new Element(tag), getElementById: () => null },
        setTimeout: callback => { timers.set(++next, callback); return next; }, clearTimeout: id => timers.delete(id) });
    vm.runInContext(fs.readFileSync(require.resolve('../public/prompt-composer'), 'utf8'), context);
    const controller = window.PromptComposer.create({ element, request, getRequest: () => body, active: () => active });
    const node = name => element.querySelector(`[data-composer-${name}]`);
    const flush = async () => { const pending = [...timers.values()]; timers.clear(); await Promise.all(pending.map(callback => callback())); };
    return { controller, node, element, flush, setBody(value) { body = value; }, logout() { active = false; controller.clear(); } };
}

test('live composer renders random pills, reorders by keyboard, and saves custom text per target', async () => {
    const view = page(); await view.flush();
    assert.match(view.node('prose').textContent, /Random value from Backdrop/);
    const handles = view.node('pills').querySelectorAll('[data-handle]');
    handles[1].dispatch('keydown', { key: 'ArrowLeft' });
    assert.equal(view.controller.getLayout().portrait[0], 'identity:role');
    view.node('add').dispatch('click');
    const input = view.node('pills').querySelector('textarea');
    input.value = 'A {literal} custom sentence.'; input.dispatch('input');
    assert.match(view.node('prose').textContent, /A \{literal\} custom sentence\./);
    assert.equal(view.controller.getLayout().portrait.at(-1).text, input.value);
    view.node('target').value = 'token'; view.node('target').dispatch('change');
    assert.equal(view.node('prose').textContent, 'Standing.');
    assert.equal(view.controller.getLayout().token, undefined);
    view.controller.setLayout({ token: [{ id: 'custom:loaded', text: 'Loaded text. ' }, 'stance_line'] });
    await view.flush();
    assert.equal(view.node('prose').textContent, 'Loaded text. Standing.');
    view.node('reset').dispatch('click');
    assert.equal(view.node('prose').textContent, 'Standing.');
});

test('dragging changes actual layout, while removed tables retain their saved position', async () => {
    const view = page(); await view.flush();
    const cards = view.node('pills').children;
    const handle = cards[1].querySelector('[data-handle]');
    handle.dispatch('dragstart', { dataTransfer: { setData() {} } });
    cards[0].dispatch('drop');
    assert.equal(view.controller.getLayout().portrait[0], 'identity:role');
    view.controller.setLayout({ portrait: ['inactive', 'identity:role', 'shot'] });
    await view.flush();
    assert.equal(view.controller.getLayout().portrait[0], 'inactive');
    assert.equal(view.node('pills').children[0].dataset.partId, 'identity:role');
});

test('late previews cannot overwrite newer choices or restore private text after logout', async () => {
    const replies = [];
    const view = page(() => new Promise(resolve => replies.push(resolve)));
    const first = view.flush();
    view.setBody({ seed: 2 }); view.controller.refresh(); const second = view.flush();
    replies[1]({ portrait: [{ id: 'new', text: 'New choice', sources: [] }], token: [] }); await second;
    replies[0]({ portrait: [{ id: 'old', text: 'Old choice', sources: [] }], token: [] }); await first;
    assert.equal(view.node('prose').textContent, 'New choice');
    view.setBody({ seed: 3 }); view.controller.refresh(); const third = view.flush();
    view.logout();
    replies[2]({ portrait: [{ id: 'private', text: 'Private text', sources: [] }], token: [] }); await third;
    assert.equal(view.node('prose').textContent, '');
    assert.equal(view.element.hidden, true);
});
