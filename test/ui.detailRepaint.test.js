const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// "When re-rolling a trait for an NPC, it doesn't seem to update their trait
// value on their page."
//
// It never could. The detail sheet was painted exactly once, by openDetail(),
// and el.detailTraits.innerHTML was assigned at exactly one line in the whole
// file. The poll tick called renderRegenPanel(), which touches the seed line,
// the radios, the buttons' disabled flag, the status line and the two <img>
// srcs - and nothing else. The new trait value was in /api/items the whole
// time; the page simply never asked again.
//
// The second half of the report - "re-rolling a 2nd trait creates a new image
// without the 1st" - is what the staged-edit design answers: a trait edit now
// applies to the stored NPC and renders nothing, edits accumulate on the entry,
// and Regenerate is the one deliberate action that makes a picture. Which
// leaves one new thing to say out loud, and this pins that too: the art on
// screen is older than the traits under it.
//
// There is no DOM harness in this repo - see ui.rerollConfirm.test.js for why -
// so most of this reads the served source of /app.js, with the one extraction
// that can be run lifted out and run.
const PORT = 5223;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

/** Enough of app.js's escapeHtml for a cell, without a document. Copied from ui.traitColumns. */
const escapeHtml = (text) => String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

/** One top-level function's source, brace-matched from its own `function` keyword. */
function liftSource(js, name) {
    const start = js.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `app.js no longer defines ${name}`);
    // From past the parameter list, not from the first `{` after the name: a
    // function taking a destructured options object opens a brace in its own
    // signature, and matching that one lifts nothing but the parameter names.
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

/** Lift one top-level function out of app.js and make it callable. Copied from ui.traitColumns. */
function liftFunction(js, name, helpers = {}) {
    const names = Object.keys(helpers);
    // eslint-disable-next-line no-new-func
    return new Function(...names, `${liftSource(js, name)}\nreturn ${name};`)(
        ...names.map((k) => helpers[k]));
}

async function appJs(t) {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    return fetchText(server, '/app.js');
}

test('the trait table has a renderer of its own', async (t) => {
    const js = await appJs(t);
    assert.match(js, /function renderDetailTraits\(/,
        'the trait table is still built inline inside openDetail, so it can only ever be '
        + 'painted at the moment the sheet opens');
    // One assignment, in that function and nowhere else - a second copy left
    // behind in openDetail is how the two would drift apart.
    const assignments = js.match(/el\.detailTraits\.innerHTML\s*=/g) || [];
    assert.equal(assignments.length, 1,
        'the trait table is written from more than one place');
});

test('the whole sheet is repainted, not just the regen panel', async (t) => {
    const js = await appJs(t);
    for (const name of ['renderDetailHeader', 'renderDetailPrompts', 'renderDetailFor']) {
        assert.match(js, new RegExp(`function ${name}\\(`), `app.js no longer defines ${name}`);
    }
    const compose = liftSource(js, 'renderDetailFor');
    for (const call of ['renderDetailHeader(', 'renderDetailTraits(',
        'renderDetailPrompts(', 'renderRegenPanel(']) {
        assert.ok(compose.includes(call),
            `renderDetailFor does not call ${call}), so that part of the sheet stays frozen`);
    }
});

test('the poll tick repaints the whole sheet', async (t) => {
    const js = await appJs(t);
    const poll = liftSource(js, 'startPolling');
    assert.match(poll, /renderDetailFor\(openItem\)/,
        'the poll tick still repaints only the regen panel, so a finished re-roll leaves the '
        + 'trait table showing the pre-roll values');
    assert.doesNotMatch(poll, /renderRegenPanel\(openItem\)/,
        'the tick calls renderRegenPanel directly, which skips everything else on the sheet');
});

test('the traits are painted before the regen panel', async (t) => {
    const js = await appJs(t);
    const compose = liftSource(js, 'renderDetailFor');
    // renderDetailTraits() replaces the table's innerHTML and hands back
    // freshly-ENABLED buttons; renderRegenPanel() is what shuts them for a
    // running job. The other order would re-enable both gutters every two
    // seconds during a render, reopening the window in which a second job can
    // be started on an NPC that is already rendering.
    assert.ok(compose.indexOf('renderDetailTraits(') < compose.indexOf('renderRegenPanel('),
        'the regen panel is painted before the traits, so a repaint mid-render hands the '
        + 'trait buttons back enabled');
});

test('renderDetailTraits renders the current values and the right buttons', async (t) => {
    const js = await appJs(t);
    const detailTraits = { innerHTML: '' };
    const renderDetailTraits = liftFunction(js, 'renderDetailTraits', {
        el: { detailTraits, scopeLegend: {} },
        TRAIT_KEY_EXCLUDE: ['name', 'Given names', 'Family names'],
        escapeHtml,
        // The scope labelling and the Animation row (see traitScopeOf and
        // animationTraitRow in app.js) are not what this test is about, so
        // they are stubbed to nothing rather than lifted.
        traitScopeOf: () => 'both',
        scopePill: () => '',
        animationTraitRow: () => '',
        traitControlCells: liftFunction(js, 'traitControlCells', {
            createState: { rawRerollableTraits: ['Outfit'] },
            escapeHtml,
        }),
        rerollableForItem: liftFunction(js, 'rerollableForItem', {
            createState: { rawRerollableTraits: ['Outfit'], rerollableTraits: [] },
        }),
        // renderDetailTraits now asks vocabFor(item.kind) which lists to read,
        // so the lift has to supply it or the call throws a ReferenceError
        // before a single row is built. The shipped vocabFor is lifted rather
        // than stubbed - it closes over traitVocab and over createState, both
        // free variables, so both are injected here. The items below carry no
        // kind, so this resolves the createState above: the same NPC lists
        // this file has always asserted against. Which kinds traitVocab really
        // holds is ui.kindVocab.test.js's question, not this file's.
        vocabFor: liftFunction(js, 'vocabFor', {
            traitVocab: {},
            createState: { rawRerollableTraits: ['Outfit'], rerollableTraits: [] },
        }),
    });

    // A modern entry: the value it holds now, and a live pair of controls.
    renderDetailTraits({ hasRawTraits: true, traits: { name: 'Jia Hale', Outfit: 'a kimono' } });
    assert.match(detailTraits.innerHTML, /a kimono/,
        'the table does not show the value the item currently carries');
    assert.doesNotMatch(detailTraits.innerHTML, /Jia Hale/,
        'the name is back in the trait table, which is what TRAIT_KEY_EXCLUDE exists to drop');
    assert.equal((detailTraits.innerHTML.match(/class="reroll-btn"/g) || []).length, 1,
        'one live Re-roll per rerollable trait');
    assert.match(detailTraits.innerHTML, /class="set-trait-btn"/);

    // A legacy entry gets the explanation instead - the button set is computed
    // per item, so repainting it with the values is what turns those buttons on
    // the first time a legacy entry is re-rolled and gains its raw bullets.
    renderDetailTraits({ hasRawTraits: false, traits: { Outfit: 'a kimono' } });
    assert.match(detailTraits.innerHTML, /reroll-unavailable/,
        'a legacy entry is offered live buttons its manifest cannot answer');
});

test('a trait edit posts to /api/stage-trait and renders nothing', async (t) => {
    const js = await appJs(t);
    const stage = liftSource(js, 'stageTraitEdit');
    assert.match(stage, /fetch\('\/api\/stage-trait'/,
        'the shared trait handler no longer posts a staged edit');
    // The route that renders is deliberately not reached from a trait button
    // any more. A re-roll used to queue two ComfyUI jobs, which is why trying
    // three haircuts took the better part of an hour and why a second edit
    // could not even be started until the first render had finished.
    assert.doesNotMatch(js, /fetch\('\/api\/reroll-trait'/,
        'a trait button still starts a render, so edits cannot accumulate');
    assert.doesNotMatch(js, /fetch\('\/api\/set-trait'/,
        'the Set… button still starts a render, so edits cannot accumulate');
    // And the result is painted from the response, which the server re-read
    // from the manifest - so what appears is the stored NPC rather than an echo
    // of what was asked for.
    assert.match(stage, /renderDetailFor\(fresh\)/,
        'the staged edit does not repaint the sheet, so the new value is invisible again');
});

test('the stale-art notice ships hidden, styled and honoured', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/');
    assert.match(html, /id="regen-stale"[^>]*hidden/,
        'the stale-art notice ships visible, so every sheet claims its art is out of date');

    const css = await fetchText(server, '/style.css');
    // Both halves, the same discipline ui.regenBanner.test.js applies to the
    // banner: a rule that set `display` on this element would beat the
    // browser's own `[hidden] { display: none }` and make the attribute inert.
    assert.match(css, /\.regen-stale\s*\{/,
        'nothing styles the stale-art notice, so it reads as another radio label');
    assert.doesNotMatch(css, /\.regen-stale\s*\{[^}]*display:/,
        '.regen-stale sets display, which overrides the hidden attribute and pins it open');

    const js = await appJs(t);
    const panel = liftSource(js, 'renderRegenPanel');
    assert.match(panel, /el\.regenStale\.hidden = !item\.artStale/,
        'nothing shows or hides the notice, so it never appears');
    assert.match(panel, /classList\.toggle\('accent'/,
        'the Regenerate button is not highlighted when there is something staged to render');
});

test('the stale badge is its own arm of the badge chain, after the regen arms', async (t) => {
    const js = await appJs(t);
    // liftSource cannot be used for render(): openSetTrait has a nested
    // function of the same name, and it comes first in the file. The top-level
    // one is the only `function render()` whose closing brace is in column one.
    const render = /^function render\(\) \{[\s\S]*?\n\}/m.exec(js);
    assert.ok(render, 'render is no longer a top-level function, so this check is vacuous');
    const chain = render[0];
    const failed = chain.indexOf("'Regen failed'");
    const stale = chain.indexOf("'Art out of date'");
    const building = chain.indexOf("'Building 3D…'");
    assert.ok(failed !== -1 && stale !== -1 && building !== -1,
        'one of the three badge arms is gone from render()');
    // Placement, not just presence. A live or failed render outranks the notice
    // because it is about to settle the question; a 3D build does not, because
    // a portrait that no longer matches the traits is the more actionable fact.
    assert.ok(failed < stale && stale < building,
        'the stale badge moved out of its slot between the regen arms and the 3D ones');
    // Still one slot, and the New tag still independent of it - a staged NPC
    // can equally be brand new, and folding the two together drops one.
    assert.match(js, /\n\s*if \(item\.isNew && !item\.imported\) \{/,
        'the New tag was folded into the badge chain, where it competes for the one slot');
});
