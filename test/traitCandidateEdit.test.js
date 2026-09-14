const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCandidateEdit, normaliseBullet } = require('../lib/traitCandidateEdit');

const TABLES = ['Build', 'Build (she)', 'Hair', 'Hair (she) +', 'Hair (he) +'];

const staged = (over = {}) => ({
    id: 'e1', table: 'Build (she)', bullet: 'a lean, wiry frame', imported: false, ...over,
});

test('moves a candidate to another table and remembers what the skill staged', () => {
    const entry = staged();
    const result = applyCandidateEdit(entry, { table: 'Build' }, TABLES);
    assert.deepEqual(result, { ok: true, changed: true });
    assert.equal(entry.table, 'Build');
    assert.equal(entry.bullet, 'a lean, wiry frame');
    assert.equal(entry.original_table, 'Build (she)');
    assert.equal(entry.original_bullet, 'a lean, wiry frame');
});

test('a second edit keeps the first original rather than the intermediate value', () => {
    const entry = staged();
    applyCandidateEdit(entry, { table: 'Build' }, TABLES);
    applyCandidateEdit(entry, { bullet: 'a broad, heavy frame' }, TABLES);
    assert.equal(entry.original_table, 'Build (she)');
    assert.equal(entry.original_bullet, 'a lean, wiry frame');
});

test('editing back to the staged values clears the edited marker', () => {
    const entry = staged();
    applyCandidateEdit(entry, { table: 'Build' }, TABLES);
    applyCandidateEdit(entry, { table: 'Build (she)' }, TABLES);
    assert.equal('original_table' in entry, false);
    assert.equal('original_bullet' in entry, false);
});

test('reset restores the staged table and bullet', () => {
    const entry = staged();
    applyCandidateEdit(entry, { table: 'Build', bullet: 'something else' }, TABLES);
    const result = applyCandidateEdit(entry, { reset: true }, TABLES);
    assert.equal(result.ok, true);
    assert.equal(entry.table, 'Build (she)');
    assert.equal(entry.bullet, 'a lean, wiry frame');
    assert.equal('original_table' in entry, false);
});

test('refuses an imported candidate, an unknown table and an empty bullet', () => {
    assert.equal(applyCandidateEdit(staged({ imported: true }), { table: 'Build' }, TABLES).status, 409);
    assert.equal(applyCandidateEdit(staged(), { table: 'Nope' }, TABLES).status, 400);
    assert.equal(applyCandidateEdit(staged(), { bullet: '   ' }, TABLES).status, 400);
});

test('the staged table is allowed back even if the tables file lost it', () => {
    const entry = staged({ table: 'Old heading' });
    applyCandidateEdit(entry, { table: 'Build' }, TABLES);
    assert.equal(applyCandidateEdit(entry, { table: 'Old heading' }, TABLES).ok, true);
});

test('bullets are flattened to one line with no leading list marker', () => {
    assert.equal(normaliseBullet('- a wiry frame'), 'a wiry frame');
    assert.equal(normaliseBullet('a wiry\n  frame || civ\r\n'), 'a wiry frame || civ');
});
