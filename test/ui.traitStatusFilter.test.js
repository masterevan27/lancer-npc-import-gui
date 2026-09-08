const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// The Trait Imports tab could search its candidates and filter them by table,
// but it had no way to say "only the ones I have not dealt with yet" - the one
// question anyone actually has when coming back to a staged run half imported.
// Every already-appended bullet stayed in the list, greyed out but still taking
// up a row, and on a run of any size the not-yet-imported handful were needles.
//
// The fix is the "Filter by" dropdown: one axis of mutually exclusive answers
// (import status, plus the with/without reference image pair), ANDed with the
// search box and the table dropdown that were already there, with a live count
// beside each option so an option that would select nothing says so before it
// is picked.
//
// There is no DOM harness in this repo - see ui.rerollConfirm.test.js for why -
// so what is pinned here is the shipped markup and the shipped predicates,
// lifted out of app.js and run against synthetic candidates. That is where a
// regression would land: a dropdown option whose value no longer has a
// predicate behind it silently filters to nothing, and a status filter that
// replaced rather than joined the table filter would widen the list instead of
// narrowing it.
const PORT = 5233;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

/**
 * Lift the whole "Filter by" block out of app.js in one piece.
 *
 * The other UI tests lift a single function each (liftFunction in
 * ui.traitColumns.test.js), but these four pieces are a unit: the predicates
 * close over the TRAIT_STATUS_TESTS map that the dropdown's option values key
 * into, and testing them apart from it would test a copy of the map rather than
 * the shipped one. Sliced from the map's declaration to the end of
 * renderTraitStatusFilter, with the two globals it reads passed in.
 */
function liftStatusFilter(js, { traitState, elTraits }) {
    const start = js.indexOf('const TRAIT_STATUS_TESTS = {');
    assert.notEqual(start, -1, 'app.js no longer defines TRAIT_STATUS_TESTS');
    const fnStart = js.indexOf('function renderTraitStatusFilter(', start);
    assert.notEqual(fnStart, -1, 'app.js no longer defines renderTraitStatusFilter');
    let depth = 0;
    let end = -1;
    for (let i = js.indexOf('{', fnStart); i < js.length; i += 1) {
        if (js[i] === '{') depth += 1;
        if (js[i] === '}') {
            depth -= 1;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    assert.notEqual(end, -1, 'could not find the end of renderTraitStatusFilter');
    // eslint-disable-next-line no-new-func
    return new Function('traitState', 'elTraits', `${js.slice(start, end)}
        return { TRAIT_STATUS_TESTS, traitMatchesStatus, traitMatchesOtherFilters,
                 traitMatchesFilters, renderTraitStatusFilter };`)(traitState, elTraits);
}

/** A candidate as /api/trait-candidates hands one over, with test overrides. */
function candidate(over = {}) {
    return {
        file: 'run.json',
        id: 'a',
        table: 'Hair',
        bullet: 'a shaved head',
        sourceImage: 'ref.png',
        hasSourceImage: true,
        notes: '',
        imported: false,
        importedAt: null,
        generatedAt: '2026-01-01T00:00:00Z',
        ...over,
    };
}

/** Stand-in for the <select>'s live HTMLOptionsCollection. */
function fakeSelect(values) {
    return { options: values.map(([value, textContent]) => ({ value, textContent, dataset: {} })) };
}

async function setup(t) {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    return {
        html: await fetchText(server, '/index.html'),
        js: await fetchText(server, '/app.js'),
    };
}

test('the Filter by dropdown is in the Trait Imports bar', async (t) => {
    const { html } = await setup(t);
    const bar = html.slice(html.indexOf('id="trait-filters"'), html.indexOf('id="trait-list"'));
    assert.match(bar, /id="trait-status-filter"/, 'the Filter by select ships in the trait filter bar');
    assert.match(bar, /Filter by/, 'and is labelled');
    for (const value of ['', 'pending', 'imported', 'with-image', 'without-image']) {
        assert.match(bar, new RegExp(`<option value="${value}"`), `option ${value || '(any)'} ships`);
    }
    // Any status is what an untouched page shows: a filter that hid rows before
    // anyone asked it to would look like a page that failed to load them.
    assert.match(bar, /<option value="" selected>/, 'Any status is the default');
});

test('every dropdown option has a predicate behind it, and vice versa', async (t) => {
    const { html, js } = await setup(t);
    const { TRAIT_STATUS_TESTS } = liftStatusFilter(js, { traitState: {}, elTraits: {} });
    const bar = html.slice(html.indexOf('id="trait-status-filter"'), html.indexOf('id="trait-sort-select"'));
    const shipped = [...bar.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    assert.deepEqual(shipped.sort(), Object.keys(TRAIT_STATUS_TESTS).sort(),
        'the markup and TRAIT_STATUS_TESTS name the same statuses');
});

test('each status keeps the candidates it names', async (t) => {
    const { js } = await setup(t);
    const { traitMatchesStatus } = liftStatusFilter(js, { traitState: {}, elTraits: {} });

    const pending = candidate({ imported: false });
    const done = candidate({ imported: true, importedAt: '2026-02-02T00:00:00Z' });
    const pictureless = candidate({ hasSourceImage: false });

    assert.equal(traitMatchesStatus(pending, 'pending'), true);
    assert.equal(traitMatchesStatus(done, 'pending'), false);
    assert.equal(traitMatchesStatus(done, 'imported'), true);
    assert.equal(traitMatchesStatus(pending, 'imported'), false);
    assert.equal(traitMatchesStatus(pending, 'with-image'), true);
    assert.equal(traitMatchesStatus(pictureless, 'with-image'), false);
    assert.equal(traitMatchesStatus(pictureless, 'without-image'), true);

    // Any status, and - the reason this is a lookup rather than a switch - an
    // option value no predicate answers to. Both pass everything: a dropdown
    // left holding a stale value should show the list, not empty it.
    assert.equal(traitMatchesStatus(done, ''), true);
    assert.equal(traitMatchesStatus(done, 'no-such-status'), true);
});

test('the status filter narrows the table and search filters rather than replacing them', async (t) => {
    const { js } = await setup(t);
    const traitState = { search: '', tableFilter: '', status: '' };
    const { traitMatchesFilters } = liftStatusFilter(js, { traitState, elTraits: {} });

    const hairPending = candidate({ id: 'a', table: 'Hair', bullet: 'a shaved head' });
    const hairDone = candidate({ id: 'b', table: 'Hair', bullet: 'a shaved head', imported: true });
    const eyesPending = candidate({ id: 'c', table: 'Eyes', bullet: 'a shaved head' });
    const all = [hairPending, hairDone, eyesPending];

    traitState.tableFilter = 'Hair';
    traitState.status = 'pending';
    assert.deepEqual(all.filter(traitMatchesFilters).map((c) => c.id), ['a'],
        'table AND status, not either');

    traitState.tableFilter = '';
    traitState.search = 'shaved';
    assert.deepEqual(all.filter(traitMatchesFilters).map((c) => c.id), ['a', 'c'],
        'search AND status');

    traitState.search = 'nothing matches this';
    assert.deepEqual(all.filter(traitMatchesFilters), [],
        'a search that matches nothing still matches nothing with a status set');
});

test('each option carries a count of what it would leave, and counting twice does not double the label', async (t) => {
    const { js } = await setup(t);
    const traitState = {
        search: '',
        tableFilter: '',
        status: '',
        candidates: [
            candidate({ id: 'a', table: 'Hair', imported: false, hasSourceImage: true }),
            candidate({ id: 'b', table: 'Hair', imported: true, hasSourceImage: false }),
            candidate({ id: 'c', table: 'Eyes', imported: false, hasSourceImage: false }),
        ],
    };
    const elTraits = {
        statusFilter: fakeSelect([
            ['', 'Any status'],
            ['pending', 'Not yet imported'],
            ['imported', 'Imported'],
            ['with-image', 'Has reference image'],
            ['without-image', 'No reference image'],
        ]),
    };
    const { renderTraitStatusFilter } = liftStatusFilter(js, { traitState, elTraits });

    renderTraitStatusFilter();
    assert.deepEqual(elTraits.statusFilter.options.map((o) => o.textContent), [
        'Any status (3)',
        'Not yet imported (2)',
        'Imported (1)',
        'Has reference image (1)',
        'No reference image (2)',
    ]);

    // The counts describe what is on screen, so the table filter moves them.
    traitState.tableFilter = 'Hair';
    renderTraitStatusFilter();
    assert.deepEqual(elTraits.statusFilter.options.map((o) => o.textContent), [
        'Any status (2)',
        'Not yet imported (1)',
        'Imported (1)',
        'Has reference image (1)',
        'No reference image (1)',
    ], 'a second run recounts against the filtered pool and does not stack "(n) (n)"');
});
