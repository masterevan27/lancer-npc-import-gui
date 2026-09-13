const test = require('node:test');
const assert = require('node:assert/strict');
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
        'expressions-generate', 'expressions-cancel', 'expressions-stage',
        'expressions-log', 'expressions-sprites', 'expressions-import-folder',
        'expressions-import-target', 'expressions-import', 'expressions-import-status',
    ]) assert.match(panel[0], new RegExp(`id="${id}"`), `missing #${id}`);
    assert.match(panel[0], /id="expressions-count"[^>]*min="1"[^>]*max="8"[^>]*value="1"/);
    assert.match(panel[0], /name="expressions-mode" value="add" checked/);
    assert.match(panel[0], /name="expressions-mode" value="replace"/);
    assert.doesNotMatch(panel[0], /describe/i, 'the CLI-only --describe option leaked into the GUI');
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
    assert.match(rows, /old portrait/);
    assert.match(rows, /data-expression-redo="battle_focus\.webp"/);
    assert.doesNotMatch(rows, /src="[^"]*npc<&/);
    const confirming = renderRows('n1', groups, 'battle_focus.webp');
    assert.match(confirming, /data-expression-delete-confirm="battle_focus\.webp"/);
    assert.match(confirming, /data-expression-delete-cancel="battle_focus\.webp"/);
    assert.doesNotMatch(confirming, /data-expression-redo=/);
});

test('run payload covers add, replace, transparency and the 1-8 count bound', async (t) => {
    const { js } = await served(t);
    const payload = liftFunction(js, 'expressionJobPayload');
    assert.deepEqual(payload({
        id: 'n1', labels: ['joy'], custom: [{ label: 'battle_focus', text: '' }],
        count: '8', mode: 'replace', keepBackground: true,
    }), {
        id: 'n1', labels: ['joy'], custom: [{ label: 'battle_focus', text: '' }],
        count: 8, mode: 'replace', keepBackground: true,
    });
    assert.deepEqual(payload({
        id: 'n1', labels: [], custom: [], count: '1', mode: 'add', keepBackground: false,
        file: 'joy-1.webp',
    }), {
        id: 'n1', labels: [], custom: [], count: 1, mode: 'add', keepBackground: false,
        file: 'joy-1.webp',
    });
    for (const count of ['0', '9', '1.5']) {
        assert.throws(() => payload({ id: 'n1', labels: ['joy'], custom: [], count,
            mode: 'add', keepBackground: false }), /between 1 and 8/);
    }
});

test('generate, redo, cancel and delete use the expression endpoints and refresh safely', async (t) => {
    const { js } = await served(t);
    const start = liftSource(js, 'startExpressionJob');
    assert.match(start, /fetch\('\/api\/expressions'/);
    assert.match(start, /state\.expressionExpectedJobId = job\.jobId/);
    assert.match(start, /startPolling\(\)/);
    assert.match(start, /await refreshExpressions\(id\)/);

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
    assert.match(panel, /view\.importTarget\?\.error/);
    assert.match(liftSource(js, 'updateExpressionImportTarget'), /view\.importTarget\.path/);
    const handler = /el\.expressionsImport\.addEventListener\('click'[\s\S]*?\n\}\);/.exec(js);
    assert.ok(handler, 'no explicit Import button handler');
    assert.match(handler[0], /copied \$\{result\.copied\}, replaced \$\{result\.replaced\}/);
    assert.match(handler[0], /result\.path/);
});
