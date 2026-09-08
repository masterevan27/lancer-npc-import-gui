const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// Which prompt each trait reaches is a fact about generate-npc.py's two
// templates, restated in app.js so the sheet can label the rows. The
// restatement is what this pins: the portrait-only and token-only sets are
// read off build_prompts() there, and a trait moving between the templates
// should fail here rather than quietly mislabel the sheet.
//
// No DOM harness in this repo (see ui.rerollConfirm.test.js), so the helpers
// are lifted out of the served app.js and run bare, the way
// ui.traitColumns.test.js does for traitControlCells.
const PORT = 5236;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

const escapeHtml = (text) => String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

/**
 * Lift a `const NAME = ...;` literal out of app.js. The statement ends at
 * the first `;` followed by a line break - CRLF or LF, since the checked-in
 * file is CRLF on Windows and LF after git's normalisation elsewhere.
 */
function liftConst(js, name, helpers = {}) {
    const start = js.indexOf(`const ${name} = `);
    assert.notEqual(start, -1, `app.js no longer defines ${name}`);
    const tail = js.slice(start).match(/;\r?\n/);
    assert.ok(tail, `could not find the end of ${name}`);
    const end = start + tail.index + 1;
    const names = Object.keys(helpers);
    // eslint-disable-next-line no-new-func
    return new Function(...names, `${js.slice(start, end)}\nreturn ${name};`)(
        ...names.map((k) => helpers[k]));
}

/** Lift one top-level function out of app.js. Copied from ui.traitColumns. */
function liftFunction(js, name, helpers = {}) {
    const start = js.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `app.js no longer defines ${name}`);
    let depth = 0;
    let end = -1;
    for (let i = js.indexOf('{', start); i < js.length; i += 1) {
        if (js[i] === '{') depth += 1;
        if (js[i] === '}') {
            depth -= 1;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    assert.notEqual(end, -1, `could not find the end of ${name}`);
    const names = Object.keys(helpers);
    // eslint-disable-next-line no-new-func
    return new Function(...names, `${js.slice(start, end)}\nreturn ${name};`)(
        ...names.map((k) => helpers[k]));
}

async function appJs(t) {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    return fetchText(server, '/app.js');
}

/** The real traitControlCells, lifted with its own two helpers. */
function liftControlCells(js) {
    return liftFunction(js, 'traitControlCells', {
        createState: { rawRerollableTraits: [] },
        escapeHtml,
    });
}

function scopeHelpers(js) {
    const TRAIT_SCOPES = liftConst(js, 'TRAIT_SCOPES', { ANIMATION_TRAIT: 'Animation' });
    const SCOPE_LABELS = liftConst(js, 'SCOPE_LABELS');
    const traitScopeOf = liftFunction(js, 'traitScopeOf', { TRAIT_SCOPES });
    const scopePill = liftFunction(js, 'scopePill', { SCOPE_LABELS });
    return { TRAIT_SCOPES, SCOPE_LABELS, traitScopeOf, scopePill };
}

test('the portrait-only and token-only traits are the ones the templates say', async (t) => {
    const { traitScopeOf } = scopeHelpers(await appJs(t));
    for (const trait of ['Backdrop', 'Weather', 'Glow placement']) {
        assert.equal(traitScopeOf('npc', trait), 'portrait', `${trait} reaches only the portrait`);
    }
    for (const trait of ['Height', 'Stance']) {
        assert.equal(traitScopeOf('npc', trait), 'token', `${trait} reaches only the token`);
    }
    assert.equal(traitScopeOf('npc', 'Animation'), 'animation');
    for (const trait of ['Role', 'Outfit', 'Glow colour', 'Weapon', 'Theme', 'Hair colour']) {
        assert.equal(traitScopeOf('npc', trait), 'both', `${trait} reaches both prompts`);
    }
});

test('an entry with no kind is an NPC, and a spaceship gets no labels at all', async (t) => {
    const { traitScopeOf } = scopeHelpers(await appJs(t));
    assert.equal(traitScopeOf(undefined, 'Backdrop'), 'portrait');
    assert.equal(traitScopeOf('spaceship', 'Backdrop'), 'both',
        'the ship templates are not what TRAIT_SCOPES describes');
});

test('a pill names the scope in words and carries a class the CSS colours', async (t) => {
    const { scopePill } = scopeHelpers(await appJs(t));
    assert.match(scopePill('token'), /class="scope-pill scope-token"/);
    assert.match(scopePill('token'), />Token only</);
    assert.match(scopePill('portrait'), />Portrait only</);
    assert.match(scopePill('animation'), />Animated only</);
    assert.equal(scopePill('both'), '', 'both is the default and needs no label');
});

test('the Animation row keeps the four-column shape and its own button classes', async (t) => {
    const js = await appJs(t);
    const { scopePill } = scopeHelpers(js);
    const traitControlCells = liftControlCells(js);
    const view = {
        status: null, descriptions: ['a', 'b'], pending: null,
        description: 'the wind moves their hair. the camera does not move.',
    };
    const animationTraitRow = liftFunction(js, 'animationTraitRow', {
        state: { animationOwnerId: 'npc-1', animationView: view },
        escapeHtml, scopePill, ANIMATION_TRAIT: 'Animation', traitControlCells,
    });
    const row = animationTraitRow({ id: 'npc-1' });
    assert.deepEqual([...row.matchAll(/<td class="([^"]*)"/g)].map((m) => m[1]),
        ['reroll-cell', 'set-cell']);
    assert.match(row, /class="anim-reroll-btn"/);
    assert.match(row, /class="anim-set-btn"/);
    assert.doesNotMatch(row, /class="reroll-btn"/,
        'the trait gutters\' class would route the click to /api/stage-trait');
    assert.match(row, /scope-pill scope-animation/);
    assert.match(row, /the wind moves their hair/);
    assert.doesNotMatch(row, /disabled/, 'a settled view leaves the controls live');
});

test('before the view lands, and while a render runs, the Animation controls are shut', async (t) => {
    const js = await appJs(t);
    const { scopePill } = scopeHelpers(js);
    const traitControlCells = liftControlCells(js);
    const lift = (state) => liftFunction(js, 'animationTraitRow', {
        state, escapeHtml, scopePill, ANIMATION_TRAIT: 'Animation', traitControlCells,
    });
    const unanswered = lift({ animationOwnerId: null, animationView: null })({ id: 'npc-1' });
    assert.equal((unanswered.match(/disabled/g) || []).length, 2);

    const running = lift({
        animationOwnerId: 'npc-1',
        animationView: { status: 'running', descriptions: ['a'], pending: null, description: 'a' },
    })({ id: 'npc-1' });
    assert.equal((running.match(/disabled/g) || []).length, 2);

    const someoneElses = lift({
        animationOwnerId: 'npc-2',
        animationView: { status: null, descriptions: ['a'], pending: null, description: 'theirs' },
    })({ id: 'npc-1' });
    assert.doesNotMatch(someoneElses, /theirs/, 'a view for another NPC must not paint this row');
});

test('a staged description says so, until the loop shows it', async (t) => {
    const js = await appJs(t);
    const { scopePill } = scopeHelpers(js);
    const traitControlCells = liftControlCells(js);
    const animationTraitRow = liftFunction(js, 'animationTraitRow', {
        state: {
            animationOwnerId: 'npc-1',
            animationView: { status: 'done', descriptions: ['a', 'b'], pending: 'b', description: 'a' },
        },
        escapeHtml, scopePill, ANIMATION_TRAIT: 'Animation', traitControlCells,
    });
    const row = animationTraitRow({ id: 'npc-1' });
    assert.match(row, /<td>b <span class="scope-note">/);
    assert.match(row, /press Re-animate/);
});
