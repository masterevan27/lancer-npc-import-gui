const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5245;
const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

async function fetchText(server, path) {
    const res = await fetch(`${server.baseUrl}${path}`);
    assert.equal(res.status, 200, `${path} should be served`);
    return res.text();
}

function liftSource(js, name) {
    const start = js.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `app.js no longer defines ${name}`);
    const body = js.indexOf('{', js.indexOf(')', start));
    let depth = 0;
    for (let i = body; i < js.length; i += 1) {
        if (js[i] === '{') depth += 1;
        if (js[i] === '}') {
            depth -= 1;
            if (depth === 0) return js.slice(start, i + 1);
        }
    }
    throw new Error(`could not find the end of ${name}`);
}

function liftFunction(js, name, helpers = {}) {
    const names = Object.keys(helpers);
    // eslint-disable-next-line no-new-func
    return new Function(...names, `${liftSource(js, name)}\nreturn ${name};`)(
        ...names.map((key) => helpers[key]));
}

function liftAsyncFunction(js, name, helpers = {}) {
    const names = Object.keys(helpers);
    const source = liftSource(js, name).replace(/^function /, 'async function ');
    // eslint-disable-next-line no-new-func
    return new Function(...names, `${source}\nreturn ${name};`)(
        ...names.map((key) => helpers[key]));
}

function liftListenerSource(js, target, eventName) {
    const marker = `${target}.addEventListener('${eventName}',`;
    const start = js.indexOf(marker);
    assert.notEqual(start, -1, `app.js no longer registers ${target} ${eventName}`);
    const body = js.indexOf('{', start + marker.length);
    let depth = 0;
    for (let i = body; i < js.length; i += 1) {
        if (js[i] === '{') depth += 1;
        if (js[i] === '}') {
            depth -= 1;
            if (depth === 0) {
                const end = js.indexOf(');', i);
                assert.notEqual(end, -1, `could not find the end of ${target} ${eventName}`);
                return js.slice(start, end + 2);
            }
        }
    }
    throw new Error(`could not find the callback body for ${target} ${eventName}`);
}

const escapeHtml = (text) => String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function served(t) {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    return {
        html: await fetchText(server, '/index.html'),
        js: await fetchText(server, '/app.js'),
        css: await fetchText(server, '/style.css'),
    };
}

test('the NPC sheet contains the complete expression controls without a describe field', async (t) => {
    const { html } = await served(t);
    const panel = /<div[^>]+id="expressions-panel"[\s\S]*?<\/div>\s*<p class="scope-legend"/.exec(html);
    assert.ok(panel, 'no Expressions panel beside the portrait action panels');
    for (const id of [
        'expressions-labels', 'expressions-all', 'expressions-none', 'expressions-missing',
        'expression-custom-label', 'expression-custom-prompt', 'expression-custom-add',
        'expression-custom-chips', 'expressions-count', 'expressions-keep-background',
        'expressions-source',
        'expressions-generate', 'expressions-cancel', 'expressions-stage',
        'expressions-log', 'expressions-sprites', 'expressions-import-folder',
        'expressions-import-target', 'expressions-import', 'expressions-import-status',
    ]) assert.match(panel[0], new RegExp(`id="${id}"`), `missing #${id}`);
    assert.match(panel[0], /id="expressions-count"[^>]*min="1"[^>]*max="8"[^>]*value="1"/);
    assert.match(panel[0], /name="expressions-mode" value="add" checked/);
    assert.match(panel[0], /name="expressions-mode" value="replace"/);
    assert.match(panel[0], /id="expressions-source"[\s\S]*value="token">Full-body token<[\s\S]*value="portrait">Portrait</);
    assert.doesNotMatch(panel[0], /describe/i, 'the CLI-only --describe option leaked into the GUI');
});

test('generated sprites sit in a collapsed section so the trait table stays near the top', async (t) => {
    const { html, js } = await served(t);
    const details = /<details class="expressions-sprites-details"(?<attrs>[^>]*)>[\s\S]*?<\/details>/.exec(html);
    assert.ok(details, 'the sprite rows are not wrapped in a collapsible <details>');
    assert.doesNotMatch(details.groups.attrs, /\bopen\b/, 'the sprite section must start collapsed');
    assert.match(details[0], /<summary>[\s\S]*id="expressions-sprites-count"[\s\S]*<\/summary>/);
    assert.match(details[0], /id="expressions-sprites"/);

    const countText = liftFunction(js, 'expressionSpritesCountText');
    assert.equal(countText([
        { label: 'joy', files: [{ file: 'joy.webp' }, { file: 'joy-1.webp' }] },
        { label: 'anger', files: [] },
        { label: 'fear', files: [{ file: 'fear.webp' }] },
    ]), '(2 of 3 labels, 3 sprites)');
    assert.equal(countText([{ label: 'joy', files: [{ file: 'joy.webp' }] }]), '(1 of 1 labels, 1 sprite)');
    assert.equal(countText(undefined), '(0 of 0 labels, 0 sprites)');
});

test('default labels come from the API in order and Missing selects empty rows', async (t) => {
    const { js } = await served(t);
    const markup = liftFunction(js, 'expressionLabelGridMarkup', { escapeHtml });
    const labels = ['surprise', 'joy', 'anger'];
    const groups = [
        { label: 'surprise', files: [] },
        { label: 'joy', files: [{ file: 'joy.webp' }] },
        { label: 'anger', files: [] },
    ];
    const html = markup(labels, new Set(['joy']));
    assert.ok(html.indexOf('surprise') < html.indexOf('joy'));
    assert.ok(html.indexOf('joy') < html.indexOf('anger'));
    assert.equal((html.match(/type="checkbox"/g) || []).length, 3);
    assert.match(html, /value="joy" checked/);
    assert.deepEqual(liftFunction(js, 'missingExpressionLabels')({ labels, groups }), ['surprise', 'anger']);
    assert.doesNotMatch(js, /\['admiration',[\s\S]*'surprise'\]/,
        'the browser defines a second copy of the 28 defaults');
});

test('custom labels are sanitized and multiple table-backed chips keep empty prompts', async (t) => {
    const { js } = await served(t);
    const sanitize = liftFunction(js, 'sanitizeExpressionLabel');
    assert.equal(sanitize('  Battle Focus!!  '), 'battle_focus');
    assert.equal(sanitize('<script>'), 'script');
    assert.equal(sanitize('!!!'), '');

    const chips = liftFunction(js, 'expressionCustomChipsMarkup', { escapeHtml })([
        { label: 'battle_focus', text: '' },
        { label: 'quiet_joy', text: 'soft smile <steady>' },
    ]);
    assert.equal((chips.match(/data-custom-remove=/g) || []).length, 2);
    assert.match(chips, /battle_focus/);
    assert.match(chips, /table prompt/);
    assert.match(chips, /soft smile &lt;steady&gt;/);
    assert.doesNotMatch(chips, /<steady>/);
});

test('sprite rows retain server order, show empty slots, metadata and inline delete confirmation', async (t) => {
    const { js } = await served(t);
    const renderRows = liftFunction(js, 'expressionSpriteRowsMarkup', { escapeHtml });
    const groups = [
        { label: 'joy', files: [] },
        { label: 'battle_focus', files: [{
            file: 'battle_focus.webp', prompt: 'cold <resolve>', seed: 17, stale: true,
        }] },
    ];
    const rows = renderRows(
        'npc<&"',
        groups,
        null,
    );
    assert.ok(rows.indexOf('joy') < rows.indexOf('battle_focus'));
    assert.match(rows, /expression-empty/);
    assert.match(rows, /cold &lt;resolve&gt; · seed 17/);
    assert.match(rows, /old source image/);
    assert.match(rows, /data-expression-redo="battle_focus\.webp"/);
    assert.doesNotMatch(rows, /src="[^"]*npc<&/);
    const confirming = renderRows('n1', groups, 'battle_focus.webp');
    assert.match(confirming, /data-expression-delete-confirm="battle_focus\.webp"/);
    assert.match(confirming, /data-expression-delete-cancel="battle_focus\.webp"/);
    assert.doesNotMatch(confirming, /data-expression-redo=/);
});

test('run payload covers source, add, replace, transparency and the 1-8 count bound', async (t) => {
    const { js } = await served(t);
    const payload = liftFunction(js, 'expressionJobPayload');
    assert.deepEqual(payload({
        id: 'n1', labels: ['joy'], custom: [{ label: 'battle_focus', text: '' }],
        count: '8', mode: 'replace', keepBackground: true, source: 'token',
    }), {
        id: 'n1', labels: ['joy'], custom: [{ label: 'battle_focus', text: '' }],
        count: 8, mode: 'replace', keepBackground: true, source: 'token',
    });
    assert.deepEqual(payload({
        id: 'n1', labels: [], custom: [], count: '1', mode: 'add', keepBackground: false,
        file: 'joy-1.webp', source: 'portrait',
    }), {
        id: 'n1', labels: [], custom: [], count: 1, mode: 'add', keepBackground: false,
        file: 'joy-1.webp', source: 'portrait',
    });
    for (const count of ['0', '9', '1.5']) {
        assert.throws(() => payload({ id: 'n1', labels: ['joy'], custom: [], count,
            mode: 'add', keepBackground: false }), /between 1 and 8/);
    }
    assert.throws(() => payload({ id: 'n1', labels: ['joy'], custom: [], count: '1',
        mode: 'add', keepBackground: false, source: 'image' }), /source/i);
});

test('source selector initializes per NPC, preserves polling choices, and disables unavailable options', async (t) => {
    const { js } = await served(t);
    const token = { disabled: false };
    const portrait = { disabled: false };
    const select = {
        value: '', disabled: false,
        querySelector: (selector) => selector.includes('token') ? token : portrait,
    };
    const el = {
        expressionsLabels: { innerHTML: '' }, expressionsSource: select,
        expressionCustomLabel: { value: '' }, expressionCustomPrompt: { value: '' },
        expressionCustomStatus: { textContent: '' }, expressionsCount: { value: '' },
        expressionsKeepBackground: { checked: true }, expressionsImportFolder: { value: '' },
        expressionsImportStatus: { textContent: '' },
    };
    const state = { expressionCustom: ['old'] };
    const availability = liftFunction(js, 'renderExpressionSourceAvailability', { el });
    const render = liftFunction(js, 'renderExpressionForm', {
        el, state,
        expressionLabelGridMarkup: () => '<labels>', renderExpressionCustomChips: () => {},
        renderExpressionSourceAvailability: availability,
        document: { querySelector: () => ({ checked: false }) },
    });
    render({
        labels: ['joy'], defaultSource: 'portrait',
        sources: { token: { available: false }, portrait: { available: true } },
        importTarget: { folderName: 'One' },
    });
    assert.equal(select.value, 'portrait');
    assert.equal(token.disabled, true);
    assert.equal(portrait.disabled, false);

    select.value = 'portrait';
    availability({
        sources: { token: { available: true }, portrait: { available: true } },
    }, false);
    assert.equal(select.value, 'portrait');
    availability({
        sources: { token: { available: true }, portrait: { available: false } },
    }, false);
    assert.equal(select.value, 'portrait', 'polling must not replace an intentional unavailable choice');
    assert.equal(portrait.disabled, true);
    render({
        labels: ['joy'], defaultSource: 'token',
        sources: { token: { available: true }, portrait: { available: false } },
        importTarget: { folderName: 'Two' },
    });
    assert.equal(select.value, 'token', 'switching form owner resets through the new view default');
    assert.equal(token.disabled, false);
    assert.equal(portrait.disabled, true);
});

test('Redo observes every portrait conflict without overblocking Delete', async (t) => {
    const { js } = await served(t);
    const expressionJobRunning = liftFunction(js, 'expressionJobRunning');
    const expressionStartBlocked = liftFunction(js, 'expressionStartBlocked', { expressionJobRunning });
    const disabled = liftFunction(js, 'expressionSpriteActionDisabled', {
        expressionJobRunning, expressionStartBlocked,
    });
    const idle = {
        id: 'n1', regenStatus: null, model3dStatus: null,
        animationStatus: null, expressionStatus: null,
    };

    assert.equal(disabled('redo', idle, null, null), false);
    assert.equal(disabled('delete', idle, null, null), false);
    assert.equal(disabled('redo', idle, null, null, false), true,
        'Redo cannot render after its selected source disappears');
    assert.equal(disabled('delete', idle, null, null, false), false,
        'source availability must not overblock Delete');
    for (const key of ['regenStatus', 'model3dStatus', 'animationStatus']) {
        const busy = { ...idle, [key]: 'running' };
        assert.equal(disabled('redo', busy, null, null), true, `${key} must block Redo`);
        assert.equal(disabled('delete', busy, null, null), false,
            `${key} must not change Delete's expression-only exclusion`);
    }
    const expressionJob = { status: 'running' };
    assert.equal(disabled('redo', idle, expressionJob, null), true);
    assert.equal(disabled('delete', idle, expressionJob, null), true);
    const itemSaysRunning = { ...idle, expressionStatus: 'running' };
    assert.equal(disabled('redo', itemSaysRunning, { status: 'done' }, null), true,
        'a poll item that sees a newer job must outrank an older detail view');
    assert.equal(disabled('delete', itemSaysRunning, { status: 'done' }, null), true);
    assert.equal(disabled('redo', idle, null, 'n1'), true);
    assert.equal(disabled('delete', idle, null, 'n1'), true,
        'Delete must not race a POST that is becoming an expression job');
    assert.equal(disabled('redo', idle, null, 'another-npc'), false);
});

test('the panel treats a running item as newer than a stale done detail job', async (t) => {
    const { js } = await served(t);
    const formControl = { disabled: false };
    const redoButton = { dataset: { expressionRedo: 'joy.webp' }, disabled: false };
    const el = {
        expressionsPanel: {
            hidden: true,
            querySelectorAll: () => [formControl],
        },
        expressionsGenerate: { disabled: false, textContent: '' },
        expressionsCancel: { disabled: true },
        expressionsImport: { disabled: false },
        expressionsStage: { textContent: '' },
        expressionsLog: { textContent: '' },
        expressionsSprites: {
            innerHTML: '', textContent: '', querySelectorAll: () => [redoButton],
        },
        expressionsSpritesCount: { textContent: '' },
        expressionsImportFolder: { value: 'Vex' },
        expressionsImportTarget: { textContent: '' },
    };
    const state = {
        expressionFormOwnerId: 'n1', expressionStartPendingId: null,
        expressionCustom: [], expressionLastStatus: 'done', expressionDeleteFile: null,
    };
    const render = liftFunction(js, 'renderExpressionsPanel', {
        el,
        state,
        selectedExpressionLabels: () => ['joy'],
        renderExpressionForm: () => { throw new Error('same owner must not reset the form'); },
        expressionSpriteRowsMarkup: () => '<sprite-row>',
        expressionSpritesCountText: () => '',
        updateExpressionImportTarget: () => {},
        expressionImportFolderError: () => null,
        expressionConfiguredBaseError: () => null,
        renderExpressionSourceAvailability: () => {},
        expressionJobRunning: liftFunction(js, 'expressionJobRunning'),
        expressionSpriteActionDisabled: liftFunction(js, 'expressionSpriteActionDisabled', {
            expressionJobRunning: liftFunction(js, 'expressionJobRunning'),
            expressionStartBlocked: liftFunction(js, 'expressionStartBlocked', {
                expressionJobRunning: liftFunction(js, 'expressionJobRunning'),
            }),
        }),
    });
    render({
        id: 'n1', kind: 'npc', supports: { expressions: true },
        expressionStatus: 'running', regenStatus: null,
        model3dStatus: null, animationStatus: null,
    }, {
        labels: ['joy'], groups: [{ label: 'joy', files: [{ file: 'joy.webp' }] }],
        job: { jobId: 'old', status: 'done', stage: null, log: '', error: null },
        importTarget: { directory: 'characters', folderName: 'Vex', path: 'characters/Vex', error: null },
    });

    assert.equal(el.expressionsGenerate.disabled, true);
    assert.equal(el.expressionsGenerate.textContent, 'Generating…');
    assert.equal(el.expressionsCancel.disabled, false);
    assert.equal(el.expressionsImport.disabled, true);
    assert.equal(formControl.disabled, true);
    assert.equal(redoButton.disabled, true);
    assert.equal(el.expressionsStage.textContent,
        'Generating… this can take several minutes per sprite.');
    assert.equal(state.expressionLastStatus, 'running',
        'completion tracking must follow the effective running state, not the stale detail job');
});

test('the shared expression starter closes the double-click window for Generate and Redo', async (t) => {
    const { js } = await served(t);
    let release;
    let fetchCalls = 0;
    let rerenders = 0;
    const response = new Promise((resolve) => { release = resolve; });
    const state = {
        detailItemId: 'n1', expressionStartSerial: 0, expressionStartPendingId: null,
        expressionExpectedJobId: null, expressionView: { groups: [], job: null },
        expressionOwnerId: 'n1', items: [{ id: 'n1', expressionStatus: null }],
    };
    const expressionJobRunning = liftFunction(js, 'expressionJobRunning');
    const expressionStartBlocked = liftFunction(js, 'expressionStartBlocked', { expressionJobRunning });
    const start = liftAsyncFunction(js, 'startExpressionJob', {
        state,
        expressionStartBlocked,
        setExpressionActionError: () => {},
        fetch: async () => { fetchCalls += 1; return response; },
        startPolling: () => {},
        rerenderCurrentExpressions: () => { rerenders += 1; },
        renderDetailFor: () => {},
        refreshItems: async () => {},
        refreshExpressions: async () => {},
    });

    const first = start({ id: 'n1' });
    assert.equal(state.expressionStartPendingId, 'n1',
        'the pending state must exist before fetch yields to a double click');
    await assert.rejects(start({ id: 'n1' }), /already starting/i);
    assert.equal(fetchCalls, 1, 'the second click must not send a second POST');

    release({ ok: true, status: 202, json: async () => ({ jobId: 'job-1', status: 'running' }) });
    await first;
    assert.equal(state.expressionStartPendingId, null);
    assert.ok(rerenders >= 2, 'sprite actions must repaint when pending starts and ends');
    await assert.rejects(start({ id: 'n1' }), /already running/i);
    assert.equal(fetchCalls, 1, 'a stale panel must not send another POST for a running item');
});

test('failed expression actions survive repaint only for their owning NPC and success clears them', async (t) => {
    const { js } = await served(t);
    const state = {
        detailItemId: 'n1', expressionStartSerial: 0, expressionStartPendingId: null,
        expressionExpectedJobId: null, expressionView: { groups: [], job: null },
        expressionOwnerId: 'n1', expressionFormOwnerId: 'n1', expressionCustom: [],
        expressionLastStatus: null, expressionDeleteFile: null, expressionActionError: null,
        items: [{
            id: 'n1', kind: 'npc', supports: { expressions: true }, expressionStatus: null,
            regenStatus: null, model3dStatus: null, animationStatus: null,
        }, {
            id: 'n2', kind: 'npc', supports: { expressions: true }, expressionStatus: null,
            regenStatus: null, model3dStatus: null, animationStatus: null,
        }],
    };
    const setExpressionActionError = liftFunction(js, 'setExpressionActionError', { state });
    let rerenders = 0;
    const expressionJobRunning = liftFunction(js, 'expressionJobRunning');
    const expressionStartBlocked = liftFunction(js, 'expressionStartBlocked', { expressionJobRunning });
    const start = liftAsyncFunction(js, 'startExpressionJob', {
        state, expressionStartBlocked, setExpressionActionError,
        fetch: async () => ({
            ok: false, status: 400,
            json: async () => ({ error: 'count must be an integer between 1 and 8' }),
        }),
        startPolling: () => {},
        rerenderCurrentExpressions: () => { rerenders += 1; },
        renderDetailFor: () => {}, refreshItems: async () => {}, refreshExpressions: async () => {},
    });
    await assert.rejects(start({ id: 'n1', labels: ['joy'], count: 9 }), /between 1 and 8/);
    assert.deepEqual(state.expressionActionError, {
        id: 'n1', message: "Couldn't start: count must be an integer between 1 and 8",
    });
    assert.ok(rerenders >= 2, 'the failed POST path must repaint after pending state clears');

    const el = {
        expressionsPanel: { hidden: false, querySelectorAll: () => [] },
        expressionsGenerate: { disabled: false, textContent: '' }, expressionsCancel: { disabled: true },
        expressionsImport: { disabled: true }, expressionsStage: { textContent: '' },
        expressionsLog: { textContent: '' },
        expressionsSprites: { innerHTML: '', textContent: '', querySelectorAll: () => [] },
        expressionsSpritesCount: { textContent: '' },
        expressionsImportFolder: { value: 'Vex' }, expressionsImportTarget: { textContent: '' },
    };
    const render = liftFunction(js, 'renderExpressionsPanel', {
        el, state, selectedExpressionLabels: () => ['joy'], renderExpressionForm: () => {},
        expressionSpriteRowsMarkup: () => '', expressionSpritesCountText: () => '',
        updateExpressionImportTarget: () => {},
        expressionImportFolderError: () => null, expressionConfiguredBaseError: () => null,
        renderExpressionSourceAvailability: () => {},
        expressionJobRunning, expressionSpriteActionDisabled: () => false,
    });
    const view = {
        labels: ['joy'], groups: [{ label: 'joy', files: [] }], job: null,
        importTarget: { error: null, baseError: null },
    };
    render(state.items[0], view);
    render(state.items[0], view);
    assert.match(el.expressionsStage.textContent, /Couldn't start:.*count/);
    render(state.items[1], view);
    assert.equal(el.expressionsStage.textContent, '', 'n1 error leaked to n2');

    for (const message of ["Couldn't cancel: no job", "Couldn't delete: disk denied"]) {
        setExpressionActionError('n1', message);
        render(state.items[0], view);
        render(state.items[0], view);
        assert.equal(el.expressionsStage.textContent, message);
    }

    setExpressionActionError('n1', null);
    render(state.items[0], view);
    assert.equal(el.expressionsStage.textContent, '');
});

test('generate, redo, cancel and delete use the expression endpoints and refresh safely', async (t) => {
    const { js } = await served(t);
    const start = liftSource(js, 'startExpressionJob');
    assert.match(start, /fetch\('\/api\/expressions'/);
    assert.match(start, /state\.expressionExpectedJobId = job\.jobId/);
    assert.match(start, /startPolling\(\)/);
    assert.match(start, /await refreshExpressions\(id\)/);

    const generate = /el\.expressionsGenerate\.addEventListener\('click'[\s\S]*?\n\}\);/.exec(js);
    assert.ok(generate, 'Generate handler is missing');

    const click = /el\.expressionsSprites\.addEventListener\('click'[\s\S]*?\n\}\);/.exec(js);
    assert.ok(click, 'sprite actions are not delegated');
    assert.match(click[0], /dataset\.expressionRedo/);
    assert.match(click[0], /file/);
    assert.match(click[0], /dataset\.expressionDeleteConfirm/);
    assert.match(click[0], /DELETE/);
    assert.doesNotMatch(click[0], /confirm\(/, 'Delete uses a browser confirmation');

    assert.match(js, /fetch\('\/api\/expressions\/cancel'/);
    assert.match(js, /api\('\/api\/expressions\/import'/);
});

test('registered Generate and Redo handlers post the current rendered source selection', async (t) => {
    const { js } = await served(t);
    const registered = {};
    const listener = (name, extra = {}) => ({
        ...extra,
        addEventListener(type, handler) { registered[`${name}:${type}`] = handler; },
    });
    const requests = [];
    const fixtures = {
        el: {
            expressionsGenerate: listener('generate', { disabled: false }),
            expressionsSprites: listener('sprites'),
            expressionsSource: { value: 'token' },
            expressionsCount: { value: '2' },
            expressionsKeepBackground: { checked: true },
            expressionsStage: { textContent: '' },
        },
        state: {
            detailItemId: 'n1', expressionCustom: [{ label: 'battle_focus', text: 'focused' }],
            items: [{ id: 'n1' }], expressionOwnerId: 'n1',
            expressionView: { job: null }, expressionStartPendingId: null,
            expressionStartSerial: 0, expressionExpectedJobId: null,
        },
        document: { querySelector: () => ({ value: 'replace' }) },
        selectedExpressionLabels: () => ['joy'],
        expressionStartBlocked: () => false,
        fetch: async (url, options) => {
            requests.push({ url, body: JSON.parse(options.body) });
            return {
                ok: true, status: 202,
                json: async () => ({ jobId: `job-${requests.length}`, status: 'running' }),
            };
        },
        startPolling: () => {},
        renderDetailFor: () => {},
        refreshItems: async () => {},
        refreshExpressions: async () => {},
        setExpressionActionError: () => {},
        rerenderCurrentExpressions: () => {},
        expressionSpriteActionDisabled: () => false,
    };
    const source = [
        'const el = fixtures.el; const state = fixtures.state; const document = fixtures.document;',
        'const selectedExpressionLabels = fixtures.selectedExpressionLabels;',
        'const expressionStartBlocked = fixtures.expressionStartBlocked;',
        'const fetch = fixtures.fetch; const startPolling = fixtures.startPolling;',
        'const renderDetailFor = fixtures.renderDetailFor;',
        'const refreshItems = fixtures.refreshItems; const refreshExpressions = fixtures.refreshExpressions;',
        'const setExpressionActionError = fixtures.setExpressionActionError;',
        'const rerenderCurrentExpressions = fixtures.rerenderCurrentExpressions;',
        'const expressionSpriteActionDisabled = fixtures.expressionSpriteActionDisabled;',
        liftSource(js, 'expressionJobPayload'),
        liftSource(js, 'startExpressionJob').replace(/^function /, 'async function '),
        liftListenerSource(js, 'el.expressionsGenerate', 'click'),
        liftListenerSource(js, 'el.expressionsSprites', 'click'),
    ].join('\n');
    const context = { fixtures };
    vm.createContext(context);
    vm.runInContext(source, context);

    await registered['generate:click']();
    fixtures.el.expressionsSource.value = 'portrait';
    const redoButton = { dataset: { expressionRedo: 'joy.webp' } };
    await registered['sprites:click']({ target: { closest: () => redoButton } });

    assert.deepEqual(requests, [{
        url: '/api/expressions',
        body: {
            id: 'n1', labels: ['joy'],
            custom: [{ label: 'battle_focus', text: 'focused' }],
            count: 2, mode: 'replace', keepBackground: true, source: 'token',
        },
    }, {
        url: '/api/expressions',
        body: {
            id: 'n1', labels: [], custom: [], count: 1, mode: 'add',
            keepBackground: true, source: 'portrait', file: 'joy.webp',
        },
    }]);
});

test('refresh rejects late item and job responses and polling treats expression jobs as running', async (t) => {
    const { js } = await served(t);
    const state = {
        detailItemId: 'n1', expressionRequestSerial: 4, expressionExpectedJobId: 'new-job',
    };
    const current = liftFunction(js, 'expressionResponseIsCurrent', { state });
    assert.equal(current('n1', 4, { job: null }), false,
        'a pre-start GET with no job must not replace a job that has since started');
    assert.equal(current('n1', 4, { job: { jobId: 'old-job' } }), false);
    assert.equal(current('n1', 4, { job: { jobId: 'new-job' } }), true);
    assert.equal(current('n2', 4, { job: { jobId: 'new-job' } }), false);
    assert.equal(current('n1', 3, { job: { jobId: 'new-job' } }), false);

    const refresh = liftSource(js, 'refreshExpressions');
    assert.match(refresh, /expressionResponseIsCurrent\(id, requestSerial, view\)/);

    const poll = liftSource(js, 'startPolling');
    assert.match(poll, /await refreshExpressions\(state\.detailItemId\)/);
    assert.match(poll, /expressionStatus === 'running'/);
});

test('the panel is NPC-capability-only and mutually excludes portrait actions', async (t) => {
    const { js } = await served(t);
    const panel = liftSource(js, 'renderExpressionsPanel');
    assert.match(panel, /item\.supports \? !item\.supports\.expressions : item\.kind !== 'npc'/);
    assert.match(panel, /item\.regenStatus === 'running'/);
    assert.match(panel, /item\.model3dStatus === 'running'/);
    assert.match(panel, /item\.animationStatus === 'running'/);
    const open = liftSource(js, 'openDetail');
    assert.match(open, /item\.supports \? item\.supports\.expressions : item\.kind === 'npc'[\s\S]*refreshExpressions\(item\.id\)/,
        'opening a spaceship still asks its rejected expressions endpoint');
    assert.match(liftSource(js, 'refreshExpressions'), /item\.supports \? !item\.supports\.expressions : item\.kind !== 'npc'[\s\S]*return/,
        'a shared poll tick still asks the rejected endpoint for an open spaceship');

    for (const name of ['renderRegenPanel', 'renderModel3dPanel', 'renderAnimationPanel']) {
        assert.match(liftSource(js, name), /item\.expressionStatus === 'running'/,
            `${name} does not disable its action while expressions render`);
    }
});

test('poll refreshes do not rebuild unsent labels, chips, count, mode or folder name', async (t) => {
    const { js } = await served(t);
    const panel = liftSource(js, 'renderExpressionsPanel');
    assert.match(panel, /state\.expressionFormOwnerId !== item\.id/);
    assert.match(panel, /renderExpressionForm\(view\)/);
    assert.doesNotMatch(panel, /expressionsCount\.value\s*=/,
        'every poll overwrites the unsent variants count');
    const refresh = liftSource(js, 'refreshExpressions');
    assert.doesNotMatch(refresh, /expressionCustom\s*=\s*\[\]/,
        'polling discards pending custom chips');
});

test('the SillyTavern import is explicit and reports target, counts and path', async (t) => {
    const { js } = await served(t);
    const panel = liftSource(js, 'renderExpressionsPanel');
    assert.match(panel, /expressionConfiguredBaseError\(view\.importTarget\)/);
    assert.match(panel, /expressionImportFolderError/);
    assert.match(liftSource(js, 'updateExpressionImportTarget'), /view\.importTarget\.path/);
    const handler = /el\.expressionsImport\.addEventListener\('click'[\s\S]*?\n\}\);/.exec(js);
    assert.ok(handler, 'no explicit Import button handler');
    assert.match(handler[0], /copied \$\{result\.copied\}, replaced \$\{result\.replaced\}/);
    assert.match(handler[0], /result\.path/);
});

test('an edited safe folder overrides only the default-name error, not a configured-base error', async (t) => {
    const { js } = await served(t);
    const folderError = liftFunction(js, 'expressionImportFolderError');
    const configuredError = liftFunction(js, 'expressionConfiguredBaseError');
    assert.equal(folderError('Safe Folder'), null);
    assert.match(folderError('Vex..Alt'), /\.\./);
    assert.equal(configuredError({ error: 'bad default', baseError: null }), null);
    assert.equal(configuredError({ error: 'old server error' }), 'old server error');

    const formControl = { disabled: false };
    const el = {
        expressionsPanel: { hidden: false, querySelectorAll: () => [formControl] },
        expressionsGenerate: { disabled: false, textContent: '' },
        expressionsCancel: { disabled: true },
        expressionsImport: { disabled: true },
        expressionsStage: { textContent: '' },
        expressionsLog: { textContent: '' },
        expressionsSprites: { innerHTML: '', textContent: '', querySelectorAll: () => [] },
        expressionsSpritesCount: { textContent: '' },
        expressionsImportFolder: { value: 'Safe Folder' },
        expressionsImportTarget: { textContent: '' },
    };
    const state = {
        expressionFormOwnerId: 'n1', expressionStartPendingId: null,
        expressionCustom: [], expressionLastStatus: null, expressionDeleteFile: null,
        expressionActionError: null,
    };
    const updateExpressionImportTarget = liftFunction(js, 'updateExpressionImportTarget', {
        el, expressionImportFolderError: folderError, expressionConfiguredBaseError: configuredError,
    });
    const expressionJobRunning = liftFunction(js, 'expressionJobRunning');
    const render = liftFunction(js, 'renderExpressionsPanel', {
        el, state,
        selectedExpressionLabels: () => ['joy'],
        renderExpressionForm: () => {},
        expressionSpriteRowsMarkup: () => '',
        expressionSpritesCountText: () => '',
        updateExpressionImportTarget,
        expressionImportFolderError: folderError,
        expressionConfiguredBaseError: configuredError,
        renderExpressionSourceAvailability: () => {},
        expressionJobRunning,
        expressionSpriteActionDisabled: () => false,
    });
    const item = {
        id: 'n1', kind: 'npc', supports: { expressions: true },
        expressionStatus: null, regenStatus: null, model3dStatus: null, animationStatus: null,
    };
    const view = {
        labels: ['joy'], groups: [{ label: 'joy', files: [{ file: 'joy.webp' }] }], job: null,
        importTarget: {
            directory: 'characters', folderName: 'Vex..Alt', path: '',
            error: 'folderName must not contain ".."', baseError: null,
        },
    };
    render(item, view);
    assert.equal(el.expressionsImportTarget.textContent, 'characters/Safe Folder');
    assert.equal(el.expressionsImport.disabled, false);

    view.importTarget.baseError = 'sillyTavernCharactersDir is not a folder: missing';
    render(item, view);
    assert.equal(el.expressionsImportTarget.textContent, view.importTarget.baseError);
    assert.equal(el.expressionsImport.disabled, true);
});
