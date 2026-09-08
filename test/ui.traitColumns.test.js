const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// The trait table's gutter held Re-roll and Set... inside ONE cell, and an HTML
// table gives a column one width for every row of it. Backdrop's value runs to
// a couple of hundred characters, so auto table layout squeezed the gutter down
// to the narrowest thing it could still fit - a single button - and the pair
// broke onto two lines. Not just on Backdrop's row: on every row in the table,
// because the column that got squeezed is shared. What the user sees is
// "Re-roll" stacked over "Set...", the two controls reading as one smeared
// column rather than two.
//
// The fix is to stop asking one column to hold two controls. Each button gets a
// column of its own that cannot be squeezed (its cell refuses to wrap, so its
// narrowest possible width is the whole button), and the value column is told
// to absorb every bit of slack instead, wrapping its text as it should have
// been doing all along.
//
// There is no DOM harness in this repo - see ui.rerollConfirm.test.js for why -
// so what is pinned here is the shipped markup and the shipped rule that make
// the layout hold, which is where a regression would actually land.
const PORT = 5218;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

/** Enough of app.js's escapeHtml for an attribute, without a document. */
const escapeHtml = (text) => String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

/** Lift one top-level function out of app.js. Copied from ui.setTraitPicker. */
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

/** The cells the row emits, as a list of `class="..."` values in order. */
function cellClasses(html) {
    return [...html.matchAll(/<td class="([^"]*)"/g)].map((m) => m[1]);
}

test('each control gets a cell of its own rather than sharing one', async (t) => {
    const { fn: traitControlCells } = await lift(t, 'traitControlCells', {
        createState: { rawRerollableTraits: ['Hair', 'Theme'] },
        escapeHtml,
    });

    const offered = traitControlCells('Hair', ['Hair']);
    assert.deepEqual(cellClasses(offered), ['reroll-cell', 'set-cell'],
        'the two controls are back in one cell, which is what stacks them');
    // Which button landed in which cell, since two cells in the right order
    // holding the wrong controls would look identical to the assertion above.
    const [rerollCell, setCell] = offered.split('</td>');
    assert.match(rerollCell, /class="reroll-btn"/);
    assert.doesNotMatch(rerollCell, /set-trait-btn/);
    assert.match(setCell, /class="set-trait-btn"/);
});

test('a row with no controls still holds both columns open', async (t) => {
    // A table column is as wide as its widest cell, and the names line up only
    // because every row contributes a cell to every column. Pronouns and the
    // two halves of the name are refused whatever the entry recorded (see
    // traitControlCells in app.js), and dropping their cells rather than
    // emptying them would slide the rest of that row two columns left.
    const { fn: traitControlCells } = await lift(t, 'traitControlCells', {
        createState: { rawRerollableTraits: ['Hair', 'Theme'] },
        escapeHtml,
    });

    for (const trait of ['Pronouns', 'Given names', 'Family names']) {
        const cells = traitControlCells(trait, []);
        assert.deepEqual(cellClasses(cells), ['reroll-cell', 'set-cell'],
            `${trait} drops a cell, so its row no longer lines up with the others`);
        assert.doesNotMatch(cells, /<button/, `${trait} must not show a control`);
    }
});

test('the explained-but-disabled variant leaves its Set... cell empty', async (t) => {
    // An entry written before rawTraits existed gets a disabled Re-roll
    // carrying the sentence that says how to turn it on, and no Set... at all.
    // The cell still has to be there to hold the column open.
    const { fn: traitControlCells } = await lift(t, 'traitControlCells', {
        createState: { rawRerollableTraits: ['Hair', 'Theme'] },
        escapeHtml,
    });

    const explained = traitControlCells('Theme', []);
    assert.deepEqual(cellClasses(explained), ['reroll-cell', 'set-cell']);
    assert.match(explained, /reroll-unavailable/, 'the explanatory variant');
    assert.doesNotMatch(explained, /set-trait-btn/);
    assert.match(explained, /<td class="set-cell"><\/td>/, 'the empty cell was dropped');
});

test('the row builder emits the cells rather than wrapping them again', async (t) => {
    // The regression this guards is a future edit re-wrapping the pair in one
    // <td>, which is exactly the arrangement that stacked them. The row builder
    // lives inside openDetail and touches the document, so it cannot be lifted
    // and run - the shipped source is what gets read.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');

    // The row carries a scope class and the name cell a pill now (see
    // traitScopeOf in app.js); what this guards is unchanged - the two cells
    // land in the row as traitControlCells emitted them, not wrapped in one.
    assert.match(js, /<tr class="scope-\$\{scope\}">\$\{cells\}<td>\$\{escapeHtml\(k\)\}\$\{scopePill\(scope\)\}<\/td>`\s*\+ `<td>\$\{escapeHtml\(v\)\}<\/td><\/tr>/,
        'the row no longer drops traitControlCells\' two cells in unwrapped');
    // One place in the whole file writes that cell, and it is traitControlCells.
    // A second is the call site wrapping the pair back up, which is the
    // arrangement that stacked them.
    const gutterCells = js.match(/<td class="reroll-cell">/g) || [];
    assert.equal(gutterCells.length, 1,
        'the gutter cell is opened somewhere besides traitControlCells');
});

test('neither control column can be squeezed, and the value column takes the slack', async (t) => {
    // The whole bug in two rules. Without nowrap on the control cells, auto
    // table layout is free to shrink them to their narrowest line-broken width
    // whenever another column wants the room - which a 250-character Backdrop
    // always does. Without the value column claiming the slack, the browser
    // hands the leftovers out by its own arithmetic instead.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const css = await fetchText(server, '/style.css');

    assert.match(
        css, /td\.reroll-cell,\s*#detail-traits td\.set-cell\s*\{[^}]*white-space:\s*nowrap/,
        'the control cells can wrap again, so a long trait value stacks the buttons');
    assert.match(
        css, /#detail-traits td:last-child\s*\{[^}]*width:\s*100%/,
        'the value column no longer absorbs the slack, so the gutters get squeezed for it');
    assert.match(
        css, /#detail-traits td:last-child\s*\{[^}]*overflow-wrap:/,
        'a single unbroken 200-character value can push the table past its container again');
    // The trait name moved from the second cell to the third when Set... took a
    // column, and a stale nth-child would paint a button column grey and let
    // the name wrap.
    assert.match(css, /#detail-traits td:nth-child\(3\)\s*\{[^}]*white-space:\s*nowrap/,
        'the trait-name rule still points at the cell Set... now occupies');
    assert.doesNotMatch(css, /#detail-traits td:nth-child\(2\)\s*\{/,
        'the old trait-name selector is still there, styling a control column');
});

/*
 * The one thing every other test in this repo assumes and none of them checks.
 *
 * Both control buttons interpolate the trait name into a title="..." attribute,
 * and every test file that exercises them - here, ui.rerollConfirm,
 * ui.setTraitPicker, ui.kindVocab, ui.detailRepaint - substitutes its own
 * escapeHtml, each of which escapes the double quote. The shipped one did not,
 * for as long as it was only `div.textContent = text; return div.innerHTML`:
 * the text-node serializer escapes & < > and leaves " alone, so a value
 * carrying one closed the attribute early and everything after it became
 * markup. So the stubs asserted a property the real function lacked, and
 * removing the fix would leave all five files green.
 *
 * The DOM half genuinely cannot run here, so it is stubbed - but stubbed as the
 * serializer actually behaves, quote deliberately untouched, which puts the
 * whole assertion on the shipped `.replace` rather than on the substitute.
 */
const serializerDocument = {
    createElement: () => ({
        textContent: '',
        // What a text node serializes to: & < > escaped, " left as written.
        get innerHTML() {
            return String(this.textContent)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },
    }),
};

test('the shipped escapeHtml closes the quote hole its stubs assume is closed', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    const shipped = liftFunction(js, 'escapeHtml', { document: serializerDocument });

    assert.equal(shipped('a "quoted" name'), 'a &quot;quoted&quot; name',
        'a double quote survives into the attribute and terminates it early');
    // The three the serializer already handles, so the added replace cannot
    // have been written in a way that drops them.
    assert.equal(shipped('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
    assert.equal(shipped(null), '', 'the nullish guard');
});

test('a trait name carrying a quote cannot break out of the title attribute', async (t) => {
    // The reachable end of the same hole: traitControlCells is the only place
    // that writes these titles, and it takes its name from the tables.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    const shipped = liftFunction(js, 'escapeHtml', { document: serializerDocument });
    const traitControlCells = liftFunction(js, 'traitControlCells', {
        createState: { rawRerollableTraits: [] },
        escapeHtml: shipped,
    });

    const hostile = 'Hair" onmouseover="x';
    const html = traitControlCells(hostile, [hostile]);

    // Every title the row emits still runs to its own closing quote. With the
    // quote unescaped the first one ends inside the trait name instead, and the
    // rest of the sentence parses as attributes.
    const titles = [...html.matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
    assert.equal(titles.length, 2, 'both controls should carry a title');
    for (const title of titles) {
        assert.match(title, /re-render this NPC$/,
            'the title ended early, so the trait name broke out of the attribute');
    }
    // `onmouseover=` is still in there and that is fine - inside a quoted value
    // it is text, not an attribute. What must not survive is the raw quote that
    // would end the value and hand the rest of the string to the parser.
    assert.ok(!html.includes(hostile),
        'the trait name reached the markup with its quote unescaped');
    assert.match(html, /&quot;/, 'the quote was escaped by something else entirely');
});
