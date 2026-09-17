const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');

function element() {
    const classes = new Set(), handlers = {};
    return { hidden: true, src: 'portrait.png', alt: 'Portrait',
        classList: { contains: name => classes.has(name), remove: name => classes.delete(name),
            toggle(name) { if (classes.has(name)) classes.delete(name); else classes.add(name); } },
        addEventListener(name, handler) { handlers[name] = handler; },
        dispatch(name, event = {}) { handlers[name]?.(event); } };
}

function viewer(kind = 'npc') {
    const el = { overlay: element(), imageZoom: element(), imageZoomImg: element(), detailPortrait: element(), detailToken: element() };
    el.imageZoomSource = null;
    el.overlay.hidden = false;
    const document = element();
    // The sliced span also holds the phone layer's shared overlay history,
    // Prev/Next buttons and swipe - top-level code that looks nodes up and
    // registers observers as the span runs. Inert stubs are enough: these
    // tests drive the keyboard and the hover preview, not those paths.
    document.querySelector = () => element();
    document.querySelectorAll = () => [];
    document.getElementById = () => element();
    const window = { matchMedia: () => ({ matches: true }), addEventListener() {}, __overlayClosers: [] };
    const history = { scrollRestoration: 'auto', pushState() {}, go() {} };
    class MutationObserver { observe() {} }
    const state = { detailItemId: 'a', visibleItems: [{ id: 'a', kind }, { id: 'b', kind }] };
    const elDeleteConfirm = { overlay: element() };
    const context = { el, state, document, window, history, MutationObserver, elDeleteConfirm, elRerollConfirm: { overlay: element() },
        elSettings: { overlay: element() }, elTraits: { overlay: element(), imageOverlay: element() },
        elTables: { preview: element() }, openDetail(item) { state.detailItemId = item.id; } };
    vm.runInNewContext(source.slice(source.indexOf('function isTypingTarget('), source.indexOf('el.selectAll.addEventListener(')), context);
    return { ...context, key(key) { const event = { key, preventDefault() { this.defaultPrevented = true; } }; document.dispatch('keydown', event); return event; } };
}

for (const kind of ['npc', 'spaceship', 'background']) {
    test(`${kind} detail can navigate while the hover preview is visible`, () => {
        const page = viewer(kind);
        page.el.detailPortrait.dispatch('mouseenter');
        assert.equal(page.el.imageZoom.hidden, false);
        assert.equal(page.key('ArrowRight').defaultPrevented, true);
        assert.equal(page.state.detailItemId, 'b');
        page.key('ArrowLeft');
        assert.equal(page.state.detailItemId, 'a');
    });
}

test('confirmation dialogs and typing still block navigation, and Escape dismisses hover first', () => {
    const page = viewer();
    page.el.detailPortrait.dispatch('mouseenter');
    page.elDeleteConfirm.overlay.hidden = false;
    page.key('ArrowRight');
    assert.equal(page.state.detailItemId, 'a');
    page.elDeleteConfirm.overlay.hidden = true;
    page.document.activeElement = { tagName: 'INPUT' };
    page.key('ArrowRight');
    assert.equal(page.state.detailItemId, 'a');
    page.key('Escape');
    assert.equal(page.el.imageZoom.hidden, true);
    assert.equal(page.el.overlay.hidden, false);
});

test('normal navigation keeps the hovered image preview on the next item', () => {
    const page = viewer();
    const update = new Function('el', `${source.slice(source.indexOf('function updateImageZoomForDetail('), source.indexOf('attachImageZoom(el.detailPortrait, true)'))}; return updateImageZoomForDetail;`)(page.el);
    page.el.imageZoom.hidden = false;
    update({ name: 'Beta', portraitUrl: 'b-portrait.png', tokenUrl: 'b-token.png' }, true, 'portrait');
    assert.equal(page.el.imageZoom.hidden, false);
    assert.equal(page.el.imageZoomImg.src, 'b-portrait.png');
});

test('clicking either normal detail image toggles expanded size', () => {
    const { el } = viewer();
    for (const image of [el.detailPortrait, el.detailToken]) {
        image.dispatch('click');
        assert.equal(image.classList.contains('image-expanded'), true);
        image.dispatch('click');
        assert.equal(image.classList.contains('image-expanded'), false);
    }
});
