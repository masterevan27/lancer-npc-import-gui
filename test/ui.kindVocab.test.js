const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// Task 5's whole job: rerollableForItem, traitCascade and rerollNeedsConfirm
// read a per-kind vocabulary instead of always reading createState by name,
// so a spaceship's detail sheet can eventually draw its own reroll buttons
// and cascade warnings from shipCreateState instead of the NPC's lists.
//
// The hazard the design is built around: those three functions read a free
// variable literally named createState, and test/ui.rerollConfirm.test.js
// lifts each of them out of the served source and injects a variable of
// exactly that name. The fix is an optional trailing parameter defaulting to
// createState - the lift still injects createState, the default still binds
// to it, and every one of that file's existing single-argument calls keeps
// meaning exactly what it meant before this task. This file pins that seam
// from the other side: that the parameter is really there, that a caller
// which does pass a second argument gets a different kind's lists back, and
// that no second copy of the trait machinery has been written for ships.
//
// Same approach as ui.rerollConfirm.test.js and ui.batchBanner.test.js: no
// DOM harness in this repo, so the served source is fetched over HTTP and
// either read directly with source-assertions or lifted out and run.
const PORT = 5231;

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '',
].join('\n');

async function fetchText(server, path) {
    const res = await fetch(`${server.baseUrl}${path}`);
    assert.equal(res.status, 200, `${path} should be served`);
    return res.text();
}

/**
 * Lift one top-level function out of app.js and hand it back bound to a
 * synthetic createState - copied from ui.rerollConfirm.test.js's own
 * liftFunction, on purpose: what runs below has to be the shipped source of
 * the shipped function under the exact same extraction, or a pass here would
 * prove nothing about whether that other file's lift still binds.
 */
function liftFunction(js, name, createState, helpers = {}) {
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
    return new Function('createState', ...names,
        `${js.slice(start, end)}\nreturn ${name};`)(createState, ...names.map((k) => helpers[k]));
}

// The NPC vocabulary, trimmed the same way ui.rerollConfirm.test.js's own
// STATE is - just enough that "the default still reaches the NPC lists"
// means something.
const NPC_STATE = {
    overrideTables: ['Theme', 'Age', 'Build', 'Hair', 'Eyes', 'Headgear'],
    rerollableTraits: ['Build', 'Hair', 'Eyes', 'Headgear'],
    rawRerollableTraits: ['Theme', 'Age', 'Build', 'Hair', 'Eyes', 'Headgear'],
    traitDependents: { Theme: ['Hair', 'Headgear'] },
};

// A ship's own vocabulary - a different shape of data entirely (no NPC trait
// name appears in it), so a test that reads it back can only be reading the
// vocabulary it was actually handed rather than falling through to the NPC's.
const SHIP_STATE = {
    overrideTables: ['Ship type', 'Size', 'Hull', 'Engine', 'Weapon Mount'],
    rerollableTraits: ['Size', 'Engine'],
    rawRerollableTraits: ['Ship type', 'Size', 'Hull', 'Engine', 'Weapon Mount'],
    traitDependents: {
        'Ship type': ['Size', 'Hull'],
        Size: ['Engine'],
    },
};

test('rerollableForItem still answers from createState on a single argument', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // The createState-injection style ui.rerollConfirm.test.js's own lift
    // uses: one argument at the call site, so the seam's default parameter is
    // what has to supply the vocabulary.
    const rerollableForItem = liftFunction(js, 'rerollableForItem', NPC_STATE);

    assert.deepEqual(rerollableForItem({ hasRawTraits: true }), NPC_STATE.rawRerollableTraits);
    assert.deepEqual(rerollableForItem({ hasRawTraits: false }), NPC_STATE.rerollableTraits);
});

test('rerollableForItem answers from a second vocabulary when one is handed to it', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // createState is bound to the NPC state here too, so a result that came
    // back NPC-shaped would prove the second argument was ignored rather than
    // that the default silently won.
    const rerollableForItem = liftFunction(js, 'rerollableForItem', NPC_STATE);

    assert.deepEqual(
        rerollableForItem({ hasRawTraits: true }, SHIP_STATE), SHIP_STATE.rawRerollableTraits);
    assert.ok(!rerollableForItem({ hasRawTraits: true }, SHIP_STATE).includes('Theme'),
        'the ship vocabulary answered with an NPC trait, so this is still reading createState');
});

test('traitCascade walks the vocabulary it is handed, not createState', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    const traitCascade = liftFunction(js, 'traitCascade', NPC_STATE);

    // Ship type frees Size and Hull; the new Size frees Engine. Ordered by
    // SHIP_STATE.overrideTables, the same way traitCascade orders an NPC's
    // cascade by createState.overrideTables.
    assert.deepEqual(
        traitCascade('Ship type', SHIP_STATE),
        ['Ship type', 'Size', 'Hull', 'Engine']);
    // A trait the ship map does not gate closes to itself, same as an NPC's.
    assert.deepEqual(traitCascade('Weapon Mount', SHIP_STATE), ['Weapon Mount']);
});

test('the seam signature is pinned, so a future refactor cannot drop the default quietly', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // This is the line ui.rerollConfirm.test.js's lift depends on without
    // saying so anywhere in that file: it hands rerollableForItem a single
    // argument and trusts the default to supply createState. If this
    // signature ever loses its default, or the parameter is reordered, this
    // assertion goes red here - which is the point, because the alternative
    // is ui.rerollConfirm.test.js failing for a reason nothing in it explains.
    assert.match(js, /function rerollableForItem\(item, vocab = createState\)/,
        'rerollableForItem no longer takes an optional vocab defaulting to createState');
    assert.match(js, /function traitCascade\(trait, vocab = createState\)/,
        'traitCascade no longer takes an optional vocab defaulting to createState');
    assert.match(js, /function rerollNeedsConfirm\(trait, vocab = createState\)/,
        'rerollNeedsConfirm no longer takes an optional vocab defaulting to createState');
});

test('traitVocab and vocabFor exist, and an unknown kind falls back to createState', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    assert.match(js, /const traitVocab = \{/, 'app.js no longer declares traitVocab');
    assert.match(js, /npc:\s*createState/, 'traitVocab no longer maps npc to createState');
    assert.match(js, /spaceship:\s*shipCreateState/,
        'traitVocab no longer maps spaceship to shipCreateState');

    const vocabFor = liftFunction(js, 'vocabFor', NPC_STATE, { traitVocab: { npc: NPC_STATE } });
    assert.equal(vocabFor('npc'), NPC_STATE);
    // A kind this page has never heard of - not spaceship, not anything else
    // - has to answer with the NPC vocabulary rather than undefined, or every
    // reader of vocabFor's result would need its own null check.
    assert.equal(vocabFor('mystery-kind'), NPC_STATE);
});

test('shipCreateState is declared and shaped like the vocabulary the three functions read', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // Declared, not left for a later task to introduce - an undeclared
    // shipCreateState would throw evaluating `const traitVocab = { ...,
    // spaceship: shipCreateState }` on every single page load, npc-only
    // sessions included, long before any spaceship is ever opened.
    assert.match(js, /const shipCreateState = \{/, 'app.js no longer declares shipCreateState');
    const decl = js.slice(js.indexOf('const shipCreateState = {'));
    const body = decl.slice(0, decl.indexOf('};') + 1);
    for (const field of ['overrideTables', 'rerollableTraits', 'rawRerollableTraits', 'traitDependents']) {
        assert.match(body, new RegExp(`${field}:`),
            `shipCreateState is missing ${field}, which rerollableForItem/traitCascade/`
            + 'rerollNeedsConfirm read off whatever vocabulary they are handed');
    }
});

test('ensureVocab exists to load a kind\'s vocabulary lazily', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    assert.match(js, /async function ensureVocab\(kind\)/, 'app.js no longer declares ensureVocab');
    const selectCategory = /async function selectCategory\([\s\S]*?\n\}/.exec(js);
    assert.ok(selectCategory, 'selectCategory is no longer a top-level function');
    assert.match(selectCategory[0], /ensureVocab\(/,
        'selectCategory no longer loads the category\'s vocabulary before its grid');
    assert.ok(
        selectCategory[0].indexOf('ensureVocab(') < selectCategory[0].indexOf('refreshItems()'),
        'the vocabulary loads after the grid does, so the detail sheet can still open on an '
        + 'empty list the first time a kind is selected');
});

// The no-duplication rule, mechanically enforced: the staged-edit and reroll
// machinery is written once and shared across kinds by taking a vocabulary
// parameter, not copied per kind. A function named for ships here would mean
// a second implementation had been written instead of the seam this task
// cuts - and would drift from the shared one the moment either changed.
test('no ship-specific copy of the trait-rendering machinery exists', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    assert.doesNotMatch(js, /renderShipDetailTraits|renderShipRegenPanel/,
        'a ship-specific copy of the shared trait machinery has appeared in app.js');
});
