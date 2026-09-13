const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');
const { splitBulletFlags, TABLE_FLAGS } = require('../lib/tableFlags');

/*
 * The Tables tab draws a flag strip under every bullet, which means app.js has
 * to know two things lib/tableFlags.js already knows: which '||' segment holds
 * the flags, and which flags a table reads.
 *
 * The second is sent down with the tables, so it cannot drift. The FIRST is
 * duplicated - app.js has its own bulletBody()/bulletFlagsOf(), because the
 * browser cannot require() a lib module - and a duplicate is exactly the kind
 * of thing that drifts silently. If app.js sliced a Backdrop at its first '||'
 * it would hide the scene sentence from the list and show the scene as a flag,
 * and nothing else in the suite would notice.
 *
 * So these tests lift the client's copies out of the shipped app.js and hold
 * them against the server's, case for case. There is no DOM harness in this
 * repo - see ui.rerollConfirm.test.js for why - so the rest is pinned against
 * the shipped markup and CSS, which is where a regression would land.
 */

const PORT = 5220;
const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
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

const THREE = new Set(['Backdrop', 'Hair colour', 'Faction']);

async function lifted(t) {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const css = await fetchText(server, '/style.css');
    // bulletBody/bulletFlagsOf both call proseSegmentsOf, which resolves a
    // pronoun variant to its base heading - so it has to be lifted first and
    // injected, rather than the arity set being passed straight in.
    //
    // proseSegmentsOf also reads tablesState.parents now, to resolve a GROUP
    // table's arity through the table that references it (I3) - stubbed here
    // with no groups at all, since every CASE below is an ordinary table and
    // none of them exercise that fallback.
    const proseSegmentsOf = liftFunction(js, 'proseSegmentsOf', {
        THREE_SEGMENT_TABLES: THREE,
        tablesState: { parents: {} },
    });
    return {
        js,
        css,
        proseSegmentsOf,
        bulletBody: liftFunction(js, 'bulletBody', { proseSegmentsOf }),
        bulletFlagsOf: liftFunction(js, 'bulletFlagsOf', { proseSegmentsOf }),
    };
}

/* The cases both copies have to agree on, chosen to break a naive split. */
const CASES = [
    ['Hair', 'a high, tight {colour} topknot || updo'],
    ['Hair', 'a short {colour} crop'],
    ['Headgear', '{Subject} {wear} a wide woven sedge hat. || crown'],
    ['Headgear', '{Subject} {wear} a woven hat. || @neosamurai'],
    ['Weapon', 'a curved blade raised overhead || hands weapon blade @grimdark'],
    // Three-segment tables: the second '||' segment is PROSE that reaches the
    // prompt, and reading it as flags is the corruption this guards.
    ['Backdrop', 'A character portrait || {Subject} {is_are} on a rooftop at dusk || nogear weather'],
    ['Backdrop', 'A character portrait || {Subject} {is_are} in a blurred alley'],
    ['Hair colour', 'greying || || older'],
    ['Hair colour', 'silver-white || fading to green at the tips'],
    ['Faction', 'Baronies || heavy brocade and gold braid || dressy'],
    // Pronoun variants: the arity follows the BASE heading, and the wide woven
    // hat that prompted the 'crown' flag lives under 'Headgear (she) +' rather
    // than 'Headgear', so getting this wrong would have missed the one bullet
    // the whole feature was built for.
    ['Headgear (she) +', '{Subject} {wear} a wide woven hat, thin red-framed glasses. || crown'],
    ['Hair (she) +', 'a messy {colour} topknot, one side shaved close beneath it || updo'],
    ['Hair colour (she) +', 'greying || || older'],
];

test("the client's bulletBody agrees with the server's, segment for segment", async (t) => {
    const { bulletBody } = await lifted(t);
    for (const [table, text] of CASES) {
        assert.equal(
            bulletBody(table, text),
            splitBulletFlags(table, text).body,
            `${table}: ${text}`);
    }
});

test("the client's bulletFlagsOf agrees with the server's", async (t) => {
    const { bulletFlagsOf } = await lifted(t);
    for (const [table, text] of CASES) {
        const { flags, themes } = splitBulletFlags(table, text);
        assert.deepEqual(bulletFlagsOf(table, text), [...flags, ...themes],
            `${table}: ${text}`);
    }
});

test('a Backdrop bullet shows its scene sentence rather than losing it', async (t) => {
    // The specific regression: slicing at the FIRST '||' would print only
    // "A character portrait" in the list and offer the scene as a flag.
    const { bulletBody, bulletFlagsOf } = await lifted(t);
    const text = 'A character portrait || {Subject} {is_are} on a rooftop at dusk || weather';
    assert.match(bulletBody('Backdrop', text), /on a rooftop at dusk/);
    assert.deepEqual(bulletFlagsOf('Backdrop', text), ['weather']);
});

test('a pronoun variant resolves to its base heading arity on the client too', async (t) => {
    const { proseSegmentsOf } = await lifted(t);
    assert.equal(proseSegmentsOf('Hair colour (she) +'), 2);
    assert.equal(proseSegmentsOf('Headgear (she) +'), 1);
    assert.equal(proseSegmentsOf('Backdrop'), 2);
});

test('the client and server keep the same three-segment table list', async (t) => {
    const { js } = await lifted(t);
    // Both copies are literal lists, so they can disagree. Adding a table to
    // one and not the other silently corrupts that table's bullets.
    for (const table of THREE) {
        assert.ok(js.includes(`'${table}'`),
            `app.js no longer names ${table} as a three-segment table`);
    }
});

test('the flag strip is rendered outside the bullet row label', async (t) => {
    const { js } = await lifted(t);
    // The bullet row is a <label> wrapping the enable checkbox. A flag
    // checkbox nested inside it would toggle the enable box instead of
    // itself, which is why the strip is appended as a sibling.
    assert.match(js, /const flags = renderBulletFlags\(table, bullet\);/);
    assert.match(js, /if \(flags\) elTables\.bulletList\.appendChild\(flags\);/);
});

test('a flag write stores the new text the server returns', async (t) => {
    const { js } = await lifted(t);
    // A bullet's text is its id everywhere else in this tab, and a flag edit
    // changes it. Keeping the stale string would break the same row's enable
    // checkbox and weight box on their next use.
    assert.match(js, /bullet\.text = text;/);
});

test('a table with no flag vocabulary gets no strip', async (t) => {
    const { js } = await lifted(t);
    assert.match(js, /const vocabulary = tablesState\.flags\[table\.name\];\s*\n\s*if \(!vocabulary\) return null;/);
    // Eyes, Skin and the rest carry no '||' at all - their text goes into the
    // prompt verbatim, so a flag written there would ship literally.
    for (const table of ['Eyes', 'Skin', 'Demeanor', 'Glow colour', 'Height']) {
        assert.equal(TABLE_FLAGS[table], undefined, table);
    }
});

test('the flag strip ships the CSS that makes it readable', async (t) => {
    const { css } = await lifted(t);
    assert.match(css, /\.table-bullet-flags\s*\{/);
    // A set flag has to be distinguishable from eight unset ones at a glance.
    assert.match(css, /\.flag-toggle:has\(input:checked\)/);
    // Theme tags are shown but not offered as checkboxes.
    assert.match(css, /\.table-bullet-flags \.flag-theme/);
});
