const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5255;
const TABLES = '## Role\n- an operator\n';

function liftSource(js, name) {
    const starts = [`function ${name}(`, `async function ${name}(`];
    const candidates = starts.map((prefix) => js.indexOf(prefix)).filter((index) => index >= 0);
    const start = candidates.length ? Math.min(...candidates) : -1;
    assert.notEqual(start, -1, `app.js no longer defines ${name}`);
    const body = js.indexOf('{', js.indexOf(')', start));
    let depth = 0;
    for (let i = body; i < js.length; i += 1) {
        if (js[i] === '{') depth += 1;
        if (js[i] === '}' && --depth === 0) return js.slice(start, i + 1);
    }
    throw new Error(`could not find the end of ${name}`);
}

function lift(js, name, helpers = {}) {
    const names = Object.keys(helpers);
    // eslint-disable-next-line no-new-func
    return new Function(...names, `${liftSource(js, name)}\nreturn ${name};`)(
        ...names.map((key) => helpers[key]));
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function appJs(t) {
    const server = await startTestServer({ tablesText: TABLES, port: PORT });
    t.after(() => server.stop());
    return (await fetch(`${server.baseUrl}/app.js`)).text();
}

function fakeElements() {
    return {
        headingList: { innerHTML: 'OLD HEADINGS' },
        bulletHeading: { textContent: 'Role' },
        bulletList: { innerHTML: 'OLD BULLETS' },
        empty: { hidden: true, textContent: '' },
        presetList: { innerHTML: 'OLD PRESETS', textContent: '' },
        saveBtn: { disabled: false },
        importInput: { disabled: false },
        preview: { hidden: true },
    };
}

test('reversed table and preset responses cannot overwrite a newer kind', async (t) => {
    const js = await appJs(t);
    const tablesState = {
        kind: 'npc', tables: [], groups: [], capabilities: { odds: true }, selectedTable: 'Role',
        presets: [], pendingPreset: null, flags: {}, parents: {}, odds: { old: true },
        oddsStale: true, oddsReason: 'old', tableRequest: 0, presetRequest: 0,
        oddsRequest: 0, oddsTimer: null,
    };
    const elTables = fakeElements();
    const waits = new Map();
    const api = (url) => {
        const wait = deferred();
        waits.set(url, wait);
        return wait.promise;
    };
    const renderedPresets = [];
    const begin = lift(js, 'beginTablesKindLoad', {
        tablesState, elTables, clearTimeout: () => {},
    });
    const loadTables = lift(js, 'loadTables', {
        tablesState, elTables, api,
        renderTableHeadingList: () => {}, renderTableBullets: () => {}, refreshOdds: () => {},
    });
    const loadPresets = lift(js, 'loadPresets', {
        tablesState, api, renderPresetList: (kind) => renderedPresets.push(kind),
    });

    const oldTables = loadTables();
    const oldPresets = loadPresets();
    begin('expression');
    assert.equal(tablesState.capabilities.odds, false);
    assert.equal(elTables.headingList.innerHTML, '');
    assert.equal(elTables.bulletList.innerHTML, '');
    assert.equal(elTables.saveBtn.disabled, true);
    assert.equal(elTables.importInput.disabled, true);
    const newTables = loadTables();
    const newPresets = loadPresets();

    waits.get('/api/table-bullets?kind=expression').resolve({
        groups: [{ group: 'Expressions', rows: [{ table: { name: 'joy', bullets: [] } }] }],
        flags: {}, capabilities: { odds: false },
    });
    waits.get('/api/presets?kind=expression').resolve({
        presets: [{ slug: 'expression-preset', name: 'Expressions', count: 1 }],
    });
    await Promise.all([newTables, newPresets]);
    assert.equal(tablesState.kind, 'expression');
    assert.equal(tablesState.selectedTable, 'joy');
    assert.equal(tablesState.capabilities.odds, false);
    assert.deepEqual(tablesState.presets.map((preset) => preset.slug), ['expression-preset']);
    assert.equal(elTables.saveBtn.disabled, false);

    waits.get('/api/table-bullets?kind=npc').resolve({
        groups: [{ group: 'NPC', rows: [{ table: { name: 'Role', bullets: [] } }] }],
        flags: { Role: { gun: 'old' } }, capabilities: { odds: true },
    });
    waits.get('/api/presets?kind=npc').resolve({
        presets: [{ slug: 'npc-preset', name: 'NPC', count: 1 }],
    });
    await Promise.all([oldTables, oldPresets]);
    assert.equal(tablesState.kind, 'expression');
    assert.equal(tablesState.selectedTable, 'joy');
    assert.equal(tablesState.capabilities.odds, false);
    assert.deepEqual(tablesState.presets.map((preset) => preset.slug), ['expression-preset']);
    assert.deepEqual(renderedPresets, ['expression']);
});

test('kind switches cancel debounced and in-flight odds and stale preset rows are inert', async (t) => {
    const js = await appJs(t);
    const timer = { pending: true };
    const cleared = [];
    const tablesState = {
        kind: 'npc', tables: [], groups: [], capabilities: { odds: true }, selectedTable: 'Role',
        presets: [], pendingPreset: null, flags: {}, parents: {}, odds: null,
        oddsStale: false, oddsReason: null, tableRequest: 0, presetRequest: 0,
        oddsRequest: 0, oddsTimer: timer,
    };
    const elTables = fakeElements();
    const oddsWait = deferred();
    const apiCalls = [];
    const api = (url, options) => {
        apiCalls.push({ url, options });
        if (url.startsWith('/api/table-odds')) return oddsWait.promise;
        return Promise.resolve({});
    };
    const refreshOdds = lift(js, 'refreshOdds', {
        tablesState, api, renderChances: () => {},
    });
    const oldOdds = refreshOdds();
    const begin = lift(js, 'beginTablesKindLoad', {
        tablesState, elTables, clearTimeout: (value) => cleared.push(value),
    });
    begin('expression');
    assert.deepEqual(cleared, [timer]);
    assert.equal(tablesState.oddsTimer, null);
    assert.equal(tablesState.capabilities.odds, false);
    oddsWait.resolve({ ok: true, samples: 20, tables: { Role: { operator: 1 } } });
    await oldOdds;
    assert.equal(tablesState.odds, null, 'NPC odds crossed into the Expressions editor');

    const deletePresetRow = lift(js, 'deletePresetRow', {
        tablesState, confirm: () => { throw new Error('stale row should be inert before prompting'); },
        api, loadPresets: async () => {},
    });
    await deletePresetRow('npc-preset', 'npc');
    assert.equal(apiCalls.some((call) => call.url === '/api/presets/delete'), false);
});
