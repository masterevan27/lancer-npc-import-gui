const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listSecretTables, isSecretTablesFileName } = require('../lib/secretTables');
const { disableableTablesFrom } = require('../lib/overrideTables');

/*
 * The listing the Secret tables section of Create NPC is built from. It
 * mirrors generate-npc.py's load_extra_tables() rules - both file shapes,
 * both refusals - so a file the generator would reject shows its reason in
 * the form rather than in a failed job's log.
 */

function folder(t, files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-tables-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return dir;
}

const JSON_SET = JSON.stringify({
    partner_archetypes: [{ value: 'tall muscular bodybuilder type', weight: 1 }, { value: 'average build everyman' }],
    camera_framing: [{ value: 'low angle looking up', weight: 3 }],
});
const MD_SET = ['# Mine', '', 'Prose is ignored.', '', '## lighting_mood', '', '- x2 harsh overhead fluorescent light', '- soft window light', '', '## empty', ''].join('\n');

test('lists json and md files by name with each table and its row count', (t) => {
    const dir = folder(t, { 'b.md': MD_SET, 'a.json': JSON_SET });
    const listing = listSecretTables(dir);
    assert.equal(listing.exists, true);
    assert.equal(listing.dir, dir);
    assert.deepEqual(listing.files, [
        { file: 'a.json', tables: [{ name: 'partner_archetypes', count: 2, values: ['tall muscular bodybuilder type', 'average build everyman'] }, { name: 'camera_framing', count: 1, values: ['low angle looking up'] }] },
        { file: 'b.md', tables: [{ name: 'lighting_mood', count: 2, values: ['harsh overhead fluorescent light', 'soft window light'] }] },
    ]);
});

test('a malformed file is reported by name and does not hide the others', (t) => {
    const dir = folder(t, {
        'good.json': JSON_SET,
        'broken.json': '{not json',
        'list.json': '[1, 2]',
        'empty-table.json': '{"t": []}',
        'bad-row.json': '{"t": ["just a string"]}',
        'zero-weight.json': '{"t": [{"value": "v", "weight": 0}]}',
        'prose.md': '# Nothing\n\nJust prose.\n',
    });
    const listing = listSecretTables(dir);
    const byName = Object.fromEntries(listing.files.map((f) => [f.file, f]));
    assert.deepEqual(byName['good.json'].tables.map((x) => x.name), ['partner_archetypes', 'camera_framing']);
    assert.match(byName['broken.json'].error, /not valid JSON/);
    assert.match(byName['list.json'].error, /one JSON object/);
    assert.match(byName['empty-table.json'].error, /"t" must be a non-empty list/);
    assert.match(byName['bad-row.json'].error, /every row of "t"/);
    assert.match(byName['zero-weight.json'].error, /weight/);
    assert.match(byName['prose.md'].error, /holds no tables/);
    for (const name of Object.keys(byName)) if (name !== 'good.json') assert.deepEqual(byName[name].tables, []);
});

test('a private table that shares a default table name is refused when the defaults are given', (t) => {
    const dir = folder(t, { 'clash.md': '## Stance\n\n- x2 on all fours\n' });
    assert.equal(listSecretTables(dir).files[0].error, undefined);
    assert.match(listSecretTables(dir, { reserved: ['Stance'] }).files[0].error, /"Stance" is a default table/);
});

test('other extensions, folders and a missing folder are not files', (t) => {
    const dir = folder(t, { 'notes.txt': '## t\n- v\n', 'a.json': JSON_SET });
    fs.mkdirSync(path.join(dir, 'sub.json'));
    assert.deepEqual(listSecretTables(dir).files.map((f) => f.file), ['a.json']);
    assert.deepEqual(listSecretTables(path.join(dir, 'missing')), { dir: path.join(dir, 'missing'), exists: false, files: [] });
});

test('only a bare .json or .md name can be a secret tables file', () => {
    for (const ok of ['a.json', 'My Tables.MD', 'x.y.json']) assert.equal(isSecretTablesFileName(ok), true, ok);
    for (const bad of ['../a.json', 'sub/a.md', 'a\\b.json', 'a.txt', '.json', '', 3, null]) {
        assert.equal(isSecretTablesFileName(bad), false, String(bad));
    }
});

test('disableableTablesFrom reads the generator tuple and degrades to nothing', () => {
    const source = [
        'REQUIRED_TABLES = [',
        '    "Given names", "Stance",',
        ']',
        '',
        '# prose about DISABLEABLE_TABLES = ("not this",)',
        'DISABLEABLE_TABLES = (',
        '    "Height", "Build",',
        '    "Stance",',
        ')',
    ].join('\n');
    assert.deepEqual(disableableTablesFrom(source), ['Height', 'Build', 'Stance']);
    assert.deepEqual(disableableTablesFrom('REQUIRED_TABLES = ["Stance"]'), []);
});
