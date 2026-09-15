const test = require('node:test');
const assert = require('node:assert/strict');

// These tests exercise the same request transport used by the browser. A late
// private reply after logout must be discarded before its JSON reaches a view.
const ui = () => require('../public/secret-mode');

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

async function page(authenticated, privateItems) {
    const fs = require('node:fs'), vm = require('node:vm');
    const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
    class Element {
        constructor() { this.children = []; this.value = ''; this.hidden = false; this.disabled = false; this.textContent = ''; this.listeners = {}; this.classList = { add() {}, remove() {}, toggle() {} }; }
        addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
        async dispatch(name) { for (const callback of this.listeners[name] || []) await callback({ preventDefault() {}, target: this }); }
        replaceChildren(...children) { this.children = children; }
        append(...children) { this.children.push(...children); }
        querySelectorAll() { return []; }
        focus() {}
        setAttribute() {}
    }
    const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
    const selectors = ['create-art-style', 'create-ship-art-style', 'bg-art-style'].map(id => nodes[id]);
    const document = new Element(); document.body = new Element();
    document.getElementById = id => nodes[id] || null;
    document.createElement = () => new Element();
    document.querySelectorAll = query => query === '[data-art-style]' ? selectors : [];
    document.querySelector = query => selectors[['npc', 'spaceship', 'background'].findIndex(kind => query.includes(`"${kind}"`))] || null;
    const requests = [], navigations = [];
    const window = new Element();
    window.location = { replace: path => navigations.push(path) };
    window.setInterval = () => 1;
    window.fetch = async (path, options = {}) => {
        requests.push({ path, options });
        let body = {};
        if (path === '/api/secret/session') body = { authenticated, configured: true };
        if (path === '/api/art-styles') body = { styles: [
            { id: 'ink', name: 'Ink' }, { id: 'private-ink', name: 'Private Ink', hidden: true }
        ] };
        if (path === '/api/secret/items') body = { items: privateItems || [{ id: 'one', kind: 'npc', name: 'Private NPC',
            portraitUrl: '/api/secret/image?rel=one.png', portraitPrompt: 'Private portrait prompt', artStyle: { name: 'Private Ink' } }] };
        return new Response(JSON.stringify(body), { status: 200 });
    };
    function Option(text, value) { this.textContent = text; this.value = value; }
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/secret-mode'), 'utf8'),
        { window, document, Option, Response, console, setTimeout, Date });
    await document.dispatch('DOMContentLoaded');
    await new Promise(resolve => setImmediate(resolve));
    return { nodes, window, requests, navigations };
}

test('logged-out page populates all selectors without hidden names', async () => {
    const { nodes } = await page(false);
    for (const id of ['create-art-style', 'create-ship-art-style', 'bg-art-style']) {
        assert.deepEqual(nodes[id].children.map(option => option.value), ['default', 'ink']);
        assert.equal(nodes[id].value, 'default');
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
    nodes['create-art-style'].value = 'private-ink';
    await window.SecretMode.fetch('/api/create-npc', { method: 'POST', body: '{}' });
    const sent = requests.at(-1);
    assert.equal(sent.path, '/api/secret/create');
    assert.equal(JSON.parse(sent.options.body).artStyle, 'private-ink');
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
    assert.match(nodes['secret-detail-traits'].textContent, /a station/);
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
