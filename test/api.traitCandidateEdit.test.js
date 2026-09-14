const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

// A staged candidate's table is the skill's guess from a reference image, and
// the reviewer can see when it guessed wrong - 'Build (she)' for a build that
// plainly suits a man. POST /api/trait-candidates/edit corrects the staged
// entry, and the ordinary import route then writes the correction.
// Unique to this file, as startTestServer's docstring requires.
const PORT = 5263;

const TABLES_FIXTURE = [
    '## Build',
    '- a stocky, barrel-chested frame',
    '',
    '## Build (she)',
    '- an hourglass figure || figure',
    '',
].join('\n');

const RUN = '2026-09-14-120000.json';

let server;

function stagedPath() {
    return path.join(server.dir, 'staged-imports', RUN);
}

function stage() {
    fs.mkdirSync(path.dirname(stagedPath()), { recursive: true });
    fs.writeFileSync(stagedPath(), JSON.stringify({
        generated_at: '2026-09-14T12:00:00-04:00',
        entries: [
            { id: 'e1', table: 'Build (she)', bullet: 'a lean, wiry frame', source_image: null },
            { id: 'e2', table: 'Build', bullet: 'a gangly frame', source_image: null, imported: true },
        ],
    }, null, 2));
}

async function post(route, body) {
    const res = await fetch(`${server.baseUrl}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

test.before(async () => {
    server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
});

test.after(() => server.stop());

test.beforeEach(() => stage());

test('the candidate listing names the headings a candidate can move to', async () => {
    const res = await fetch(`${server.baseUrl}/api/trait-candidates`);
    const { tables, candidates } = await res.json();
    assert.deepEqual(tables, ['Build', 'Build (she)']);
    assert.equal(candidates.find((c) => c.id === 'e1').edited, false);
});

test('a corrected table is saved to the run and imported where the reviewer put it', async () => {
    const edit = await post('/api/trait-candidates/edit', { file: RUN, id: 'e1', table: 'Build' });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.candidate.table, 'Build');
    assert.equal(edit.body.candidate.originalTable, 'Build (she)');
    assert.equal(edit.body.candidate.edited, true);

    const entry = JSON.parse(fs.readFileSync(stagedPath(), 'utf8')).entries.find((e) => e.id === 'e1');
    assert.equal(entry.table, 'Build');
    assert.equal(entry.original_table, 'Build (she)');

    const imported = await post('/api/trait-candidates/import', { items: [{ file: RUN, id: 'e1' }] });
    assert.deepEqual(imported.body.results, [{ file: RUN, id: 'e1', imported: true }]);
    const tables = fs.readFileSync(server.tablesPath, 'utf8');
    assert.match(tables, /## Build\n- a stocky, barrel-chested frame\n- a lean, wiry frame\n/);
    assert.doesNotMatch(tables, /figure \|\| figure\n- a lean/);
});

test('reset puts back what the skill staged', async () => {
    await post('/api/trait-candidates/edit', { file: RUN, id: 'e1', table: 'Build', bullet: 'a broad frame' });
    const reset = await post('/api/trait-candidates/edit', { file: RUN, id: 'e1', reset: true });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.candidate.table, 'Build (she)');
    assert.equal(reset.body.candidate.bullet, 'a lean, wiry frame');
    assert.equal(reset.body.candidate.edited, false);
});

test('refuses unknown tables, imported candidates and runs outside the staging directory', async () => {
    assert.equal((await post('/api/trait-candidates/edit', { file: RUN, id: 'e1', table: 'Hair' })).status, 400);
    assert.equal((await post('/api/trait-candidates/edit', { file: RUN, id: 'e2', table: 'Build (she)' })).status, 409);
    assert.equal((await post('/api/trait-candidates/edit', { file: RUN, id: 'nope', table: 'Build' })).status, 404);
    for (const file of ['../outside.json', 'refs/../x.json', 'x.txt']) {
        assert.equal((await post('/api/trait-candidates/edit', { file, id: 'e1', table: 'Build' })).status, 404);
    }
});
