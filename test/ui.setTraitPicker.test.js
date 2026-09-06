const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// Two decisions sit behind the picker and this file pins both.
//
// How a value is grouped, because the generator reports two independent kinds
// of "not legal" and only one of them has a remedy in the dialog. A value the
// roller would not have offered (allowed: false) can only be overridden - it
// is ruled out by the traits ABOVE it, and nothing the user ticks changes
// that. A value that would leave a kept trait contradicting (conflicts) can
// offer to re-roll those traits. Collapsing the two into one grey list would
// put a checkbox on rows it cannot help, which is a worse lie than showing no
// checkbox at all.
//
// What the checkbox promises, because releasing a trait re-rolls its whole
// cascade: freeing Outfit while Headgear, Weapon and Gear stay pinned to
// bullets chosen for the outfit that is now gone recreates the contradiction
// one level down. The generator reports `releases` for exactly this reason,
// and a label naming only the conflicts would undercount what moves.
//
// Same lifting approach as ui.rerollConfirm.test.js, and for the same reason:
// there is no DOM harness in this repo, so the decisions are written as pure
// top-level functions in app.js and the shipped source of them is run here.
const PORT = 5215;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

const CLEAN = {
    value: 'a work jacket || civ', heading: 'Outfit',
    allowed: true, current: true, conflicts: [], releases: [],
};
const CONFLICTING = {
    value: 'a kimono || civ notac', heading: 'Outfit',
    allowed: true, current: false, conflicts: ['Headgear'], releases: ['Headgear'],
};
const CASCADING = {
    value: 'a robe || civ dressy', heading: 'Outfit',
    allowed: true, current: false, conflicts: ['Outfit'],
    releases: ['Gear', 'Headgear', 'Outfit', 'Weapon'],
};
const RULED_OUT = {
    value: 'a flight suit || mil', heading: 'Outfit',
    allowed: false, current: false, conflicts: [], releases: [],
};

/** Enough of app.js's escapeHtml for an attribute, without a document. */
const escapeHtml = (text) => String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

/**
 * Lift one top-level function out of app.js. Same mechanism and same
 * justification as ui.rerollConfirm.test.js's copy - app.js touches `document`
 * as it loads, so it cannot be required, but these functions read nothing but
 * their arguments.
 */
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
    const js = await fetchText(server, '/app.js');
    return { fn: liftFunction(js, name, helpers), js };
}

test('the three groups are separated and empty ones are dropped', async (t) => {
    const { fn: groupChoices } = await lift(t, 'groupChoices');

    const groups = groupChoices([CLEAN, CONFLICTING, RULED_OUT]);
    assert.deepEqual(groups.map((g) => g.key), ['clean', 'conflicting', 'ruledOut']);
    assert.deepEqual(groups[0].rows, [CLEAN]);
    assert.deepEqual(groups[1].rows, [CONFLICTING]);
    assert.deepEqual(groups[2].rows, [RULED_OUT]);

    assert.deepEqual(groupChoices([CLEAN]).map((g) => g.key), ['clean']);
    assert.deepEqual(groupChoices([]), []);
});

test('the clean group keeps the order the generator sent', async (t) => {
    const { fn: groupChoices } = await lift(t, 'groupChoices');
    const second = { ...CLEAN, value: 'a second jacket || civ', current: false };
    const groups = groupChoices([CLEAN, second]);
    assert.deepEqual(groups[0].rows.map((r) => r.value),
        ['a work jacket || civ', 'a second jacket || civ']);
});

test('a ruled-out value is never also counted as conflicting', async (t) => {
    // Both flags can be set at once. It belongs in ruledOut alone, because the
    // checkbox could not help it - overriding a gate is the only way in.
    const { fn: groupChoices } = await lift(t, 'groupChoices');
    const both = { ...RULED_OUT, conflicts: ['Headgear'], releases: ['Headgear'] };
    assert.deepEqual(groupChoices([both]).map((g) => g.key), ['ruledOut']);
});

test('every group carries a heading except the clean one', async (t) => {
    const { fn: groupChoices } = await lift(t, 'groupChoices');
    const groups = groupChoices([CLEAN, CONFLICTING, RULED_OUT]);
    assert.equal(groups[0].heading, null);
    assert.match(groups[1].heading, /contradict/i);
    assert.match(groups[2].heading, /ruled out/i);
});

test('the checkbox appears only where it can help', async (t) => {
    const { fn: releaseLabel } = await lift(t, 'releaseLabel');

    assert.equal(releaseLabel(CLEAN), null, 'nothing to release');
    assert.equal(releaseLabel(RULED_OUT), null, 'overriding a gate releases nothing');
    assert.match(releaseLabel(CONFLICTING), /Headgear/);
});

test('the label says when more moves than the conflict it named', async (t) => {
    // releases is four long and conflicts is one, so a label naming only
    // Outfit would imply one trait moves when four do.
    const { fn: releaseLabel } = await lift(t, 'releaseLabel');
    const label = releaseLabel(CASCADING);
    assert.match(label, /Outfit/);
    assert.match(label, /3/, 'the three cascaded traits are accounted for');
});

test('a handful of conflicts are named rather than counted', async (t) => {
    const { fn: releaseLabel } = await lift(t, 'releaseLabel');
    const two = {
        ...CONFLICTING, conflicts: ['Headgear', 'Gear'],
        releases: ['Gear', 'Headgear'],
    };
    const label = releaseLabel(two);
    assert.match(label, /Headgear/);
    assert.match(label, /Gear/);
});

test('many conflicts are counted rather than listed', async (t) => {
    const { fn: releaseLabel } = await lift(t, 'releaseLabel');
    const many = {
        ...CONFLICTING,
        conflicts: ['Hair', 'Hair colour', 'Feature', 'Outfit', 'Headgear'],
        releases: ['Feature', 'Hair', 'Hair colour', 'Headgear', 'Outfit'],
    };
    assert.match(releaseLabel(many), /5/);
});

test('Set... is drawn exactly where Re-roll is offered', async (t) => {
    const { fn: rerollControlHtml } = await lift(t, 'rerollControlHtml', {
        createState: { rawRerollableTraits: ['Hair', 'Theme'] },
        escapeHtml,
    });

    const offered = rerollControlHtml('Hair', ['Hair']);
    assert.match(offered, /class="reroll-btn"/);
    assert.match(offered, /class="set-trait-btn"/);
    assert.doesNotMatch(offered, /disabled/,
        'neither control is born disabled; the running guard does that');
});

test('Set... is absent, not disabled, where Re-roll is only explained', async (t) => {
    // An entry written before rawTraits existed gets a disabled Re-roll
    // carrying the sentence that says how to turn it on. That explanation
    // already covers both controls, so a second disabled button beside it
    // would say the same thing twice and invite a click at a cure the user has
    // just been told about.
    const { fn: rerollControlHtml } = await lift(t, 'rerollControlHtml', {
        createState: { rawRerollableTraits: ['Hair', 'Theme'] },
        escapeHtml,
    });

    const explained = rerollControlHtml('Theme', []);
    assert.match(explained, /reroll-unavailable/, 'the explanatory variant');
    assert.doesNotMatch(explained, /set-trait-btn/);
});

test('a trait neither list offers gets no controls at all', async (t) => {
    const { fn: rerollControlHtml } = await lift(t, 'rerollControlHtml', {
        createState: { rawRerollableTraits: ['Hair', 'Theme'] },
        escapeHtml,
    });
    assert.equal(rerollControlHtml('Pronouns', []), '');
});
