const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// The Trait Imports tab gained a way through a large staged run without the
// mouse - keyboard shortcuts, Previous/Next and "Select & next" on the detail
// sheet - and a Pictures view that tiles the reference images and opens one
// image's candidates together.
//
// No DOM harness here either (see ui.rerollConfirm.test.js), so what is pinned
// is the shipped markup and the pure pieces the views are built from: how
// candidates gather into image tiles, how a step clamps at the ends, which key
// means what, and the select-all toggle every "select all" control shares.
const PORT = 5263;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

/** The end of the brace-balanced block that opens at or after `from`. */
function blockEnd(js, from) {
    let depth = 0;
    for (let i = js.indexOf('{', from); i < js.length; i += 1) {
        if (js[i] === '{') depth += 1;
        if (js[i] === '}') {
            depth -= 1;
            if (depth === 0) return i + 1;
        }
    }
    return -1;
}

/** Lift top-level functions or consts, by name, out of app.js together. */
function lift(js, names, helpers = {}) {
    const bodies = names.map((name) => {
        let start = js.indexOf(`function ${name}(`);
        if (start === -1) start = js.indexOf(`const ${name} = {`);
        assert.notEqual(start, -1, `app.js no longer defines ${name}`);
        const end = blockEnd(js, start);
        assert.notEqual(end, -1, `could not find the end of ${name}`);
        return js.slice(start, end);
    });
    const keys = Object.keys(helpers);
    // eslint-disable-next-line no-new-func
    return new Function(...keys, `${bodies.join('\n')}\nreturn { ${names.join(', ')} };`)(
        ...keys.map((k) => helpers[k]));
}

async function setup(t) {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    return {
        html: await fetchText(server, '/index.html'),
        js: await fetchText(server, '/app.js'),
    };
}

function candidate(over = {}) {
    return {
        file: 'run.json', id: 'a', table: 'Hair', bullet: 'x',
        sourceImage: 'one.png', hasSourceImage: true, imported: false,
        ...over,
    };
}

const candidateKey = (c) => `${c.file}::${c.id}`;

test('the tab ships both views, the shortcut hint and the sheets\' navigation', async (t) => {
    const { html } = await setup(t);
    const tab = html.slice(html.indexOf('id="tab-traits"'), html.indexOf('id="tab-tables"'));
    assert.match(tab, /data-trait-view="list"/);
    assert.match(tab, /data-trait-view="pictures"/);
    assert.match(tab, /id="trait-clear-btn"/);
    assert.match(tab, /id="trait-shortcuts"/);
    assert.match(tab, /id="trait-list"/);
    assert.match(tab, /id="trait-tiles"/);
    for (const id of ['trait-detail-prev', 'trait-detail-next', 'trait-detail-select', 'trait-detail-select-next',
        'trait-image-overlay', 'trait-image-prev', 'trait-image-next', 'trait-image-select-all',
        'trait-image-select-next', 'trait-image-candidates']) {
        assert.match(html, new RegExp(`id="${id}"`), `${id} ships`);
    }
});

test('candidates gather into one tile per run and image, in list order', async (t) => {
    const { js } = await setup(t);
    const { groupTraitCandidatesByImage } = lift(js, ['groupTraitCandidatesByImage']);

    const groups = groupTraitCandidatesByImage([
        candidate({ id: 'a', sourceImage: 'two.png', hasSourceImage: false }),
        candidate({ id: 'b', sourceImage: 'one.png' }),
        candidate({ id: 'c', sourceImage: 'two.png' }),
        // Same filename, different run: a different picture.
        candidate({ id: 'd', sourceImage: 'two.png', file: 'later.json' }),
        candidate({ id: 'e', sourceImage: undefined, hasSourceImage: false }),
    ]);

    assert.deepEqual(groups.map((g) => g.key),
        ['run.json::two.png', 'run.json::one.png', 'later.json::two.png', 'run.json::']);
    assert.deepEqual(groups[0].candidates.map((c) => c.id), ['a', 'c']);
    // The picture is asked for through a candidate that has a staged copy,
    // even when the first one in the group has none.
    assert.equal(groups[0].imageCandidate.id, 'c');
    assert.equal(groups[3].imageCandidate, null, 'no copy anywhere, no picture');
});

test('stepping clamps at both ends and starts at the first entry', async (t) => {
    const { js } = await setup(t);
    const { stepTraitKey } = lift(js, ['stepTraitKey']);
    const keys = ['a', 'b', 'c', 'd', 'e'];
    assert.equal(stepTraitKey(keys, 'b', 1), 'c');
    assert.equal(stepTraitKey(keys, 'b', -1), 'a');
    assert.equal(stepTraitKey(keys, 'a', -1), 'a', 'no wrap off the start');
    assert.equal(stepTraitKey(keys, 'd', 3), 'e', 'a row-sized jump past the end lands on the last');
    assert.equal(stepTraitKey(keys, null, 1), 'a');
    assert.equal(stepTraitKey(keys, 'gone', -1), 'a');
    assert.equal(stepTraitKey([], 'a', 1), null);
});

test('each context maps its keys, case-insensitively, and not the others\'', async (t) => {
    const { js } = await setup(t);
    const { traitKeyAction } = lift(js, ['TRAIT_KEYS', 'traitKeyAction']);

    assert.equal(traitKeyAction('list', 'j'), 'next');
    assert.equal(traitKeyAction('list', 'J'), 'next', 'Shift or Caps Lock does not switch a shortcut off');
    assert.equal(traitKeyAction('list', ' '), 'toggle');
    assert.equal(traitKeyAction('list', 'Enter'), 'open');
    assert.equal(traitKeyAction('list', 'ArrowLeft'), null, 'left and right mean nothing in a one-column list');
    assert.equal(traitKeyAction('pictures', 'ArrowDown'), 'down');
    assert.equal(traitKeyAction('detail', 'Enter'), 'selectNext');
    assert.equal(traitKeyAction('detail', 'a'), null, 'select-all-shown is not reachable from inside a sheet');
    assert.equal(traitKeyAction('image', '3'), 'pick:2');
    assert.equal(traitKeyAction('image', '0'), null);
    assert.equal(traitKeyAction('list', '3'), null, 'digits only pick inside the image sheet');
    assert.equal(traitKeyAction(null, 'j'), null);
});

test('the shared select-all toggle skips imported candidates and deselects when all are on', async (t) => {
    const { js } = await setup(t);
    const traitState = { selected: new Set() };
    const { toggleTraitSelectedAll } = lift(js, ['setTraitSelected', 'toggleTraitSelectedAll'],
        { traitState, candidateKey });

    const group = [candidate({ id: 'a' }), candidate({ id: 'b', imported: true }), candidate({ id: 'c' })];
    toggleTraitSelectedAll(group);
    assert.deepEqual([...traitState.selected].sort(), ['run.json::a', 'run.json::c']);

    toggleTraitSelectedAll(group);
    assert.deepEqual([...traitState.selected], [], 'all pending already on: the toggle turns them off');

    traitState.selected.add('run.json::a');
    toggleTraitSelectedAll(group);
    assert.deepEqual([...traitState.selected].sort(), ['run.json::a', 'run.json::c'],
        'partly selected: the toggle completes the set rather than clearing it');
});
