const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// Three decisions sit behind the Re-roll buttons, and this file pins each of
// them.
//
// Which buttons appear is per NPC: generate-npc.py keeps two re-rollable lists
// and picks between them from the entry's raw bullets, so the page has to pick
// the same way or offer a button the server answers 400 to.
//
// What a row shows when the button cannot appear is the second, and it is the
// difference between a limitation and a missing feature. A trait an entry
// cannot re-roll because it predates rawTraits is one full re-roll of the NPC
// away from being re-rollable, and the row has to say so - an empty gutter on
// nearly every NPC's Theme row is what made requirement 2 read as unshipped.
//
// Whether a click asks first is per trait. The generator does not free the
// named trait alone - it frees every trait a filter would have had to re-check,
// so a Theme re-roll redraws a dozen of them - and a control labelled "Re-roll"
// on the Theme row looks like it is buying one. That question goes to the
// generator's own TRAIT_DEPENDENTS, so the traits that free nothing stay quiet
// and the ones that do not are named - and it stays per trait rather than per
// NPC even when the map cannot be read, which is the one place the first
// decision's per-item rule deliberately does not reach.
//
// There is no DOM harness in this repo and no dependencies at all - every test
// drives the real server over HTTP - so the two decisions are written as pure
// functions in app.js and lifted out of the served source to be called here.
// Same approach, and same reasoning, as test/ui.newBadge.test.js and
// test/ui.copyPrompts.test.js; the difference is only that these two questions
// have answers worth asserting rather than wiring worth pinning.
const PORT = 5211;

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
 * synthetic createState.
 *
 * app.js is a browser script that touches `document` as it loads, so it cannot
 * be required here. The functions this file tests read nothing but their
 * arguments, createState and each other, which is what makes cutting them out
 * honest: what runs below is the shipped source of the shipped function, not a
 * copy of its logic written into the test.
 *
 * `helpers` supplies the free names a lifted function calls, of which there are
 * two kinds. traitCascade is itself lifted and passed in, so what runs is still
 * the shipped source on both sides of the call. escapeHtml is the real
 * exception: it is a DOM trick (textContent in, innerHTML out) that cannot run
 * here, so a substitute goes in - and nothing any assertion below turns on lives
 * on that side of the substitution.
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

/** Enough of app.js's escapeHtml for an attribute, without a document. */
const escapeHtml = (text) => String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The shape /api/npc-tables sends: the eleven-name legacy list, the wider one
// an entry with raw bullets gets, the table order both are drawn in, and the
// generator's cascade map - trimmed to the names that matter here, but with
// TRAIT_DEPENDENTS' edges copied exactly, Theme's already resolved through
// THEMED_TABLES the way the parser resolves it.
const STATE = {
    overrideTables: [
        'Callsigns', 'Theme', 'Age', 'Build', 'Hair', 'Hair colour', 'Eyes', 'Feature',
        'Role', 'Faction', 'Outfit', 'Headgear', 'Weapon', 'Gear', 'Backdrop',
        'Glow placement', 'Weather', 'Stance',
    ],
    rerollableTraits: ['Callsigns', 'Build', 'Hair', 'Eyes', 'Headgear'],
    rawRerollableTraits: [
        'Callsigns', 'Theme', 'Age', 'Build', 'Hair', 'Eyes', 'Role', 'Outfit', 'Headgear',
    ],
    traitDependents: {
        Theme: ['Hair', 'Hair colour', 'Feature', 'Outfit', 'Headgear', 'Weapon', 'Backdrop'],
        Role: ['Faction', 'Outfit', 'Weapon'],
        Outfit: ['Headgear', 'Weapon', 'Gear'],
        Weapon: ['Gear', 'Stance'],
        Gear: ['Stance'],
        Backdrop: ['Weather', 'Glow placement', 'Gear'],
        'Hair colour': ['Hair'],
        Age: ['Build', 'Hair colour'],
    },
};

test('an NPC with raw bullets is offered the wider list', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const rerollableForItem = liftFunction(
        await fetchText(server, '/app.js'), 'rerollableForItem', STATE);

    assert.deepEqual(rerollableForItem({ hasRawTraits: true }), STATE.rawRerollableTraits);
    assert.ok(rerollableForItem({ hasRawTraits: true }).includes('Theme'),
        'Theme is the re-roll this whole split exists to offer');
});

test('an NPC without raw bullets keeps the legacy list', async (t) => {
    // Including the entries that report nothing at all, which is what an older
    // server sends: no hasRawTraits key, and the narrow list is the safe read
    // of that - a button that is not offered costs a click at the CLI, a button
    // that is offered wrongly costs a queued job and a hard refusal.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const rerollableForItem = liftFunction(
        await fetchText(server, '/app.js'), 'rerollableForItem', STATE);

    assert.deepEqual(rerollableForItem({ hasRawTraits: false }), STATE.rerollableTraits);
    assert.deepEqual(rerollableForItem({}), STATE.rerollableTraits);
    assert.ok(!rerollableForItem({ hasRawTraits: false }).includes('Theme'),
        'Theme on a lossy entry is a SystemExit from the generator, after the job is queued');
});

/**
 * rerollNeedsConfirm bound to `state`, with the traitCascade it calls lifted out
 * of the same source and handed to it.
 */
async function liftRerollNeedsConfirm(server, state = STATE) {
    const js = await fetchText(server, '/app.js');
    const traitCascade = liftFunction(js, 'traitCascade', state);
    return liftFunction(js, 'rerollNeedsConfirm', state, { traitCascade });
}

test('a Theme row on an NPC without raw bullets says what would turn it on', async (t) => {
    // The requirement was "Theme should have a Re-roll option on an NPC's
    // page", and 9 of the author's 165 NPCs recorded the raw bullets that let
    // Theme re-roll. The other 156 render an empty gutter cell unless the row
    // says otherwise: no control, no explanation, no way to learn that one full
    // re-roll of the NPC unlocks it. The generator's own refusal already says
    // the cure out loud; this is that sentence, on the row.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const rerollControlHtml = liftFunction(
        await fetchText(server, '/app.js'), 'rerollControlHtml', STATE, { escapeHtml });

    const cell = rerollControlHtml('Theme', STATE.rerollableTraits);
    assert.match(cell, /<button[^>]*\bdisabled\b/, 'the Theme row has no affordance at all');
    assert.match(cell, /Re-roll the whole NPC once to record them/,
        'the disabled button does not say how to earn the live one');
    assert.ok(!/data-trait/.test(cell),
        'a disabled control must not carry a trait for the click handler to post');
    // On the wrapper, because a disabled control takes no pointer events and so
    // shows no tooltip - a title on the button itself would be an explanation
    // nobody can read.
    assert.match(cell, /<span class="reroll-unavailable" title="[^"]/);
});

test('a trait no entry can re-roll keeps its empty cell', async (t) => {
    // The rule the disabled button had to be added without breaking. Pronouns
    // and the two halves of the name are refused whatever the entry recorded, so
    // an inert control there would invite a click at a cure that does not exist.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const rerollControlHtml = liftFunction(
        await fetchText(server, '/app.js'), 'rerollControlHtml', STATE, { escapeHtml });

    for (const trait of ['Pronouns', 'Given names', 'Family names']) {
        assert.equal(rerollControlHtml(trait, STATE.rerollableTraits), '',
            `${trait} cannot be re-rolled by anybody and must not show a control`);
    }
});

test('a re-rollable trait still gets the live button', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const rerollControlHtml = liftFunction(
        await fetchText(server, '/app.js'), 'rerollControlHtml', STATE, { escapeHtml });

    // Both ways in: on the legacy list for a lossy entry, and on the wide list
    // an entry with raw bullets is handed - Theme's live button being the one
    // the disabled twin above is a stand-in for.
    const legacy = rerollControlHtml('Hair', STATE.rerollableTraits);
    assert.match(legacy, /data-trait="Hair"/);
    assert.ok(!/\bdisabled\b/.test(legacy));
    assert.match(rerollControlHtml('Theme', STATE.rawRerollableTraits), /data-trait="Theme"/);
});

test('the traits that change nothing else still fire on one click', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const rerollNeedsConfirm = await liftRerollNeedsConfirm(server);

    // A confirmation on every re-roll is a confirmation nobody reads, which
    // spends the one that matters.
    for (const trait of STATE.rerollableTraits) {
        assert.equal(rerollNeedsConfirm(trait), false,
            `${trait} closes to itself and must not raise a dialog`);
    }
});

test('a re-roll that can reach past its own trait asks first', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const rerollNeedsConfirm = await liftRerollNeedsConfirm(server);

    // Theme takes eleven traits with it, Role six, Outfit four, Age three -
    // none of them recoverable, since the old bullets are overwritten and the
    // re-render draws a fresh seed.
    for (const trait of ['Theme', 'Role', 'Outfit', 'Age']) {
        assert.equal(rerollNeedsConfirm(trait), true,
            `${trait} can change more than itself and must be confirmed`);
    }
});

test('a trait nothing depends on raises no dialog, list or no list', async (t) => {
    // What reading the map buys over answering from the legacy eleven, which is
    // the only other list available. Faction, Weather and Stance are outside
    // that list and are not keys in TRAIT_DEPENDENTS at all, so answering from
    // it would open a dialog on Weather to warn about a cascade that does not
    // exist - and one that could then name nothing, since there is nothing to
    // name.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const rerollNeedsConfirm = await liftRerollNeedsConfirm(server);

    for (const trait of ['Faction', 'Weather', 'Stance', 'Glow placement']) {
        assert.ok(!STATE.rerollableTraits.includes(trait),
            `${trait} has to be outside the legacy list for this to test anything`);
        assert.equal(rerollNeedsConfirm(trait), false,
            `${trait} frees nothing and must not raise a dialog`);
    }
});

test('a cascade is enumerated in the order the generator draws it', async (t) => {
    // What reading the real map lets the dialog say: the traits, by name,
    // rather than "more than one trait" or one stock paragraph about Theme's
    // cascade printed over every other trait's.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const traitCascade = liftFunction(await fetchText(server, '/app.js'), 'traitCascade', STATE);

    // Transitively: Theme frees Outfit, the new Outfit frees Gear, the new Gear
    // and Weapon free the Stance. Stopping at the direct dependents would
    // promise a smaller change than the generator makes.
    assert.deepEqual(traitCascade('Theme'), [
        'Theme', 'Hair', 'Hair colour', 'Feature', 'Outfit', 'Headgear', 'Weapon', 'Gear',
        'Backdrop', 'Glow placement', 'Weather', 'Stance',
    ]);
    assert.deepEqual(traitCascade('Weather'), ['Weather']);
    // Draw order, not discovery order, and this is the pair that shows the
    // difference: Hair colour frees Hair, and Hair is drawn first, so that is
    // how the dialog lists them - the same way the CLI's report prints them and
    // the same way the rows run down the detail sheet.
    assert.deepEqual(traitCascade('Hair colour'), ['Hair', 'Hair colour']);
});

test('a cycle in the dependency map ends the walk rather than the tab', async (t) => {
    // generate-npc.py's own trait_cascade() says not to assume a DAG: the map
    // held an Age/Build cycle until recently, and Build's half was dropped for a
    // reason about button behaviour rather than about graph shape, so the next
    // filter audited in both directions will put one back.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const cyclic = {
        ...STATE,
        traitDependents: { ...STATE.traitDependents, Build: ['Age'] },
    };
    const traitCascade = liftFunction(await fetchText(server, '/app.js'), 'traitCascade', cyclic);

    assert.deepEqual(traitCascade('Age'), ['Age', 'Build', 'Hair', 'Hair colour']);
});

test('an unreadable dependency map over-warns rather than going quiet', async (t) => {
    // The degrade has to fall the safe way. A server too old to send the map, or
    // one whose parse missed, leaves the page unable to tell a cascade from a
    // lone re-roll - and an over-warned Weather costs a click, where an
    // unannounced Theme costs a dozen traits and a re-render nobody asked for.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const blind = { ...STATE, traitDependents: {} };
    const rerollNeedsConfirm = await liftRerollNeedsConfirm(server, blind);

    assert.equal(rerollNeedsConfirm('Theme'), true);
    assert.equal(rerollNeedsConfirm('Hair'), false, 'the legacy eleven still fire on one click');
});

test('the blind answer is the same on an NPC that recorded its raw bullets', async (t) => {
    // Every other decision behind these buttons is per NPC, so the one that is
    // not gets pinned rather than left to read as an oversight. Which traits a
    // re-roll drags along is a property of the generator's filters, not of the
    // entry in front of the user, and the two re-rollable lists are not two
    // answers to it - the legacy eleven are simply the only traits still known
    // to free nothing once the map cannot be read. generate-npc.py tests that
    // all eleven close to themselves, and says in that test's own docstring
    // that it does so because this page draws its one-click buttons from
    // REROLLABLE_TRAITS.
    //
    // The wide list carries no such promise: it is every trait but the two
    // halves of the name and Pronouns. Answering the blind question from it
    // because the entry happens to have raw bullets would return false for
    // every button the sheet draws - the whole dialog gone, on exactly the
    // NPCs where Theme's twelve-trait re-roll is offered in the first place.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    const blind = { ...STATE, traitDependents: {} };
    const traitCascade = liftFunction(js, 'traitCascade', blind);
    const rerollNeedsConfirm = liftFunction(js, 'rerollNeedsConfirm', blind, { traitCascade });
    const rerollableForItem = liftFunction(js, 'rerollableForItem', blind);

    // The entry goes in as a second argument the shipped function does not
    // declare, which is deliberate: handed a spare argument it ignores, this
    // asserts today's behaviour, and if the entry is ever made a real parameter
    // and answered from that entry's own list, the same lines fail instead of
    // quietly passing an undefined and testing nothing.
    const modern = { hasRawTraits: true };
    assert.ok(rerollableForItem(modern).includes('Theme'),
        'the wide list has to reach Theme for this to test anything');
    for (const trait of ['Theme', 'Role', 'Outfit', 'Age']) {
        assert.ok(rerollableForItem(modern).includes(trait),
            `${trait} has to be a live button on this entry for the dialog to matter`);
        assert.equal(rerollNeedsConfirm(trait, modern), true,
            `${trait} cascades and must still be confirmed on an entry with raw bullets`);
    }
    // And the cost of being coarse, stated rather than discovered: a trait that
    // frees nothing but sits outside the eleven is warned about too, in a dialog
    // that says it cannot name what changes. One click, against a re-render.
    assert.equal(rerollNeedsConfirm('Weather', modern), true);
    assert.equal(rerollNeedsConfirm('Hair', modern), false,
        'the eleven fire on one click on this entry as well');
});

test('the page ships the dialog the confirmation opens', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/');
    for (const id of ['reroll-confirm-overlay', 'reroll-confirm-message',
        'reroll-confirm-cancel', 'reroll-confirm-ok']) {
        assert.match(html, new RegExp(`id="${id}"`), `the page is missing #${id}`);
    }
    // Hidden at rest, and closable from the keyboard through its own Cancel
    // button rather than by hiding the overlay - confirmReroll() is
    // Promise-based, and a dialog dismissed any other way leaves that Promise
    // unresolved and its listeners stacked, which is the bug the delete dialog
    // already documents.
    assert.match(html, /id="reroll-confirm-overlay" hidden/);
    const js = await fetchText(server, '/app.js');
    assert.match(js, /cancelRerollConfirm/, 'Esc cannot reach the re-roll dialog');
    assert.match(js, /elRerollConfirm\.cancel\.click\(\)/,
        'the Esc path hides the dialog instead of cancelling it');
});

test('the confirmation is awaited before anything is posted', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // The order is the point: a dialog raised after the POST would be a
    // question asked about a job already running.
    const gate = js.indexOf('rerollNeedsConfirm(trait) && !(await confirmReroll(trait))');
    assert.notEqual(gate, -1, 'the click handler no longer gates the re-roll on the dialog');
    assert.ok(gate < js.indexOf("fetch('/api/reroll-trait'"),
        'the re-roll is posted before the confirmation is answered');
});
