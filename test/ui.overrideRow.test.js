const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// Four decisions the Create form's trait-override row makes, all of them
// invisible until a render comes back wrong.
//
// WHICH IMAGE A TRAIT REACHES. Four of the tables the override dropdown offers
// only affect one of the two images generate-npc.py produces. Backdrop is the
// scene behind the subject and the token renders on flat white, so forcing a
// Backdrop and generating only a token is a setting that changes nothing;
// Stance is the token's pose and the portrait never mentions one. A GM who
// forced either and got an unchanged image could not tell a failed override
// from an inapplicable one. Weather and Glow placement are covered for the
// same reason - naming two of the four would imply the other two reach both.
//
// WHETHER A PER-PRONOUN VALUE IS REACHABLE. lib/traitOptions.js folds
// 'Outfit (she) +' into Outfit's list so the two can be browsed together, and
// --set-trait pastes whatever is chosen in verbatim. Picking a woman-only
// outfit with Pronouns set to "he" therefore renders a man wearing it. "Any"
// is blocked too: it means the generator rolls the pronouns, so the value is a
// coin flip on contradicting itself, which fails later and less visibly than a
// refusal does.
//
// WHETHER A BASE VALUE HAS BEEN REPLACED, which is the same rule from the other
// end and the half that was missed first time. A variant written without a
// trailing '+' - 'Build (she)', 'Height (she)' - is used INSTEAD of its base
// table rather than added to it, so with Pronouns on "she" every plain Build
// and Height bullet is unrollable while carrying no variant subject of its own
// to gate on. All thirteen sat un-greyed in the picker until replacedFor
// existed.
//
// WHAT A SEARCH MATCHES. Backdrop offers 300-odd bullets and a native <select>
// gives you the arrow keys and a type-ahead that matches from the start of the
// label - which for these is one of a handful of shared opening phrases.
//
// Same lifting approach as ui.setTraitPicker.test.js and ui.rerollConfirm.test.js,
// and for the same reason: app.js touches `document` as it loads so it cannot
// be required, but these functions read nothing but their arguments.
const PORT = 5220;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', '- he/him/his/man', ''].join('\n');

const NEUTRAL = {
    value: 'grey work coveralls || civ', label: 'grey work coveralls · civ',
    heading: 'Outfit', isVariant: false, enabled: true, variantSubject: null,
};
const SHE_ONLY = {
    value: 'a hip-length tan leather jacket || civ',
    label: 'a hip-length tan leather jacket · civ',
    heading: 'Outfit (she) +', isVariant: true, enabled: true, variantSubject: 'she',
};
const HE_ONLY = {
    value: 'a heavy canvas chore coat || civ', label: 'a heavy canvas chore coat · civ',
    heading: 'Outfit (he) +', isVariant: true, enabled: true, variantSubject: 'he',
};

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

async function lift(t, name, helpers) {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const res = await fetch(`${server.baseUrl}/app.js`);
    assert.equal(res.status, 200, '/app.js should be served');
    return liftFunction(await res.text(), name, helpers);
}

test('the four one-image traits each say which image they reach', async (t) => {
    const traitScopeNote = await lift(t, 'traitScopeNote');

    for (const table of ['Backdrop', 'Weather', 'Glow placement']) {
        const note = traitScopeNote(table);
        assert.ok(note, `${table} should carry a note`);
        assert.match(note, /Portrait images only/,
            `${table} reaches the portrait alone and the note must say so`);
    }
    assert.match(traitScopeNote('Stance'), /Token images only/);
});

test('a trait that reaches both images carries no note at all', async (t) => {
    const traitScopeNote = await lift(t, 'traitScopeNote');
    // An empty string would render as a blank grey line under the row, which
    // reads as a note that failed to load rather than as no note.
    for (const table of ['Role', 'Outfit', 'Hair', 'Faction', 'Weapon']) {
        assert.equal(traitScopeNote(table), null, `${table} reaches both images`);
    }
});

test('a neutral value is reachable from every pronoun setting', async (t) => {
    const pronounBlockReason = await lift(t, 'pronounBlockReason');
    for (const subject of ['she', 'he', '']) {
        assert.equal(pronounBlockReason(NEUTRAL, subject), null);
    }
});

test('a variant value is reachable only from its own pronoun set', async (t) => {
    const pronounBlockReason = await lift(t, 'pronounBlockReason');
    assert.equal(pronounBlockReason(SHE_ONLY, 'she'), null);
    assert.equal(pronounBlockReason(HE_ONLY, 'he'), null);

    const wrong = pronounBlockReason(SHE_ONLY, 'he');
    assert.ok(wrong, 'a she-only value must be refused under "he"');
    // The reason has to name both halves of the mismatch. "Not available" on
    // its own sends the reader looking for a broken table rather than at the
    // Pronouns control three fields above it.
    assert.match(wrong, /she/);
    assert.match(wrong, /he/);
    assert.match(wrong, /Outfit \(she\) \+/);
});

test('Any is blocked, and says why rather than just refusing', async (t) => {
    const pronounBlockReason = await lift(t, 'pronounBlockReason');
    const any = pronounBlockReason(SHE_ONLY, '');
    assert.ok(any, 'Any means the generator rolls the pronouns, so this is a coin flip');
    assert.match(any, /Any/);
    assert.match(any, /rolls/);
});

test('search matches every term, in any order, across label and heading', async (t) => {
    const filterTraitOptions = await lift(t, 'filterTraitOptions');
    const all = [NEUTRAL, SHE_ONLY, HE_ONLY];

    assert.deepEqual(filterTraitOptions(all, 'jacket').map((o) => o.value), [SHE_ONLY.value]);
    // Both terms, and in the opposite order to the label's own - the bullets'
    // word order is the tables file's, not one a searcher would guess.
    assert.deepEqual(filterTraitOptions(all, 'civ jacket').map((o) => o.value), [SHE_ONLY.value]);
    assert.deepEqual(filterTraitOptions(all, 'JACKET').map((o) => o.value), [SHE_ONLY.value]);
    // The heading is searchable, which is the quickest route to "what are the
    // women-only outfits".
    assert.deepEqual(filterTraitOptions(all, 'she').map((o) => o.value), [SHE_ONLY.value]);
    assert.deepEqual(filterTraitOptions(all, 'nothing here'), []);
});

test('an empty search returns a copy, not the caller\'s own array', async (t) => {
    const filterTraitOptions = await lift(t, 'filterTraitOptions');
    const all = [NEUTRAL, SHE_ONLY];
    const got = filterTraitOptions(all, '   ');
    assert.deepEqual(got, all);
    // The row splices its current selection into this result. Returning the
    // caller's array would put that splice into createState.traitOptions and
    // corrupt every other row's list.
    assert.notEqual(got, all);
});

test('changing pronouns clears an override the new setting rules out', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await (await fetch(`${server.baseUrl}/app.js`)).text();
    const pronounBlockReason = liftFunction(js, 'pronounBlockReason');
    const clear = liftFunction(js, 'clearOverridesBlockedByPronouns', { pronounBlockReason });

    const traitOptions = { Outfit: [NEUTRAL, SHE_ONLY, HE_ONLY] };
    const overrides = [
        { table: 'Outfit', value: SHE_ONLY.value, custom: false },
        { table: 'Outfit', value: NEUTRAL.value, custom: false },
    ];
    assert.equal(clear(overrides, traitOptions, 'he'), 1);
    assert.equal(overrides[0].value, '', 'the she-only value goes');
    assert.equal(overrides[0].table, 'Outfit', 'the row and its table stay');
    assert.equal(overrides[1].value, NEUTRAL.value, 'the neutral value stays');
});

test('a typed custom value is never cleared by a pronoun change', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await (await fetch(`${server.baseUrl}/app.js`)).text();
    const clear = liftFunction(js, 'clearOverridesBlockedByPronouns',
        { pronounBlockReason: liftFunction(js, 'pronounBlockReason') });

    // A hand-typed value is in no table, so nothing here knows what pronouns
    // it belongs to - and guessing would throw away work the user typed. The
    // generator is the one that gets to refuse it.
    const overrides = [{ table: 'Outfit', value: SHE_ONLY.value, custom: true }];
    assert.equal(clear(overrides, { Outfit: [SHE_ONLY] }, 'he'), 0);
    assert.equal(overrides[0].value, SHE_ONLY.value);
});

const REPLACED_BASE = {
    value: 'lean and rangy', label: 'lean and rangy',
    heading: 'Build', isVariant: false, enabled: true,
    variantSubject: null, replacedFor: ['she'],
};
const REPLACING_VARIANT = {
    value: 'full through the bust and hip || figure',
    label: 'full through the bust and hip · figure',
    heading: 'Build (she)', isVariant: true, enabled: true,
    variantSubject: 'she', replacedFor: [],
};

test('a base value is blocked for a pronoun whose variant REPLACES it', async (t) => {
    const pronounBlockReason = await lift(t, 'pronounBlockReason');

    // 'Build (she)' carries no trailing '+', so it is used INSTEAD of '## Build'
    // rather than added to it - the generator never draws a plain Build bullet
    // for a woman. The base bullets carry no variantSubject of their own, so
    // before replacedFor existed all thirteen of them sat un-greyed in the
    // picker with Pronouns on "she", and picking one forced a value the roller
    // could not have produced.
    const blocked = pronounBlockReason(REPLACED_BASE, 'she');
    assert.ok(blocked, 'a replaced base value must be refused');
    assert.match(blocked, /replaces/);
    assert.match(blocked, /Build/);

    // And it is only blocked for the pronoun that replaces it.
    assert.equal(pronounBlockReason(REPLACED_BASE, 'he'), null);
    assert.equal(pronounBlockReason(REPLACED_BASE, ''), null);
});

test('the variant that does the replacing is not itself blocked', async (t) => {
    const pronounBlockReason = await lift(t, 'pronounBlockReason');
    // The obvious way to get this wrong is to give every bullet of the table
    // the same replacedFor, which would gate away the only pool a woman has.
    assert.equal(pronounBlockReason(REPLACING_VARIANT, 'she'), null);
    assert.ok(pronounBlockReason(REPLACING_VARIANT, 'he'),
        'the variant is still she-only for everyone else');
});

test('an additive variant leaves its base table alone', async (t) => {
    const pronounBlockReason = await lift(t, 'pronounBlockReason');
    // 'Outfit (she) +' ADDS to '## Outfit', so a woman rolls from both and the
    // neutral bullets stay reachable. replacedFor is empty for those, and this
    // is the assertion that the two forms are not being treated alike.
    assert.equal(pronounBlockReason(NEUTRAL, 'she'), null);
    assert.equal(pronounBlockReason(NEUTRAL, 'he'), null);
});
