const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listSecretTables, isSecretTablesFileName, validateSelection } = require('../lib/secretTables');
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

test('markdown categories group values without changing table counts or fixed values', (t) => {
    const dir = folder(t, { 'poses.md': [
        '### Before any table', '## Poses', '- x2 standing',
        '### Kneeling', '- x3 kneeling upright', '- kneeling upright', '- x0 excluded',
        '### Lying down', '- reclining', '### Empty',
        '## Other', '- neutral', '## Poses', '- standing again',
    ].join('\r\n') });
    assert.deepEqual(listSecretTables(dir).files[0].tables, [
        { name: 'Poses', count: 5, values: ['standing', 'kneeling upright', 'reclining', 'standing again'],
            groups: [{ name: '', values: ['standing', 'standing again'] },
                { name: 'Kneeling', values: ['kneeling upright'] },
                { name: 'Lying down', values: ['reclining'] }] },
        { name: 'Other', count: 1, values: ['neutral'] },
    ]);
});

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

const GATED_MD = [
    '## Styles', '- x2 Rugged dockworker #man', '- Sharp-suited broker #Man', '- x2 Elegant courtesan #woman #noble',
    '', "## Men's Attributes (when: man)", '- heavy stubble #scarred', '- broad shoulders',
    '', '## Jewellery (when: woman, noble)', '- a thin gold circlet',
].join('\n');

test('markdown tags and gates are parsed off values and headings', (t) => {
    const dir = folder(t, { 'styles.md': GATED_MD });
    assert.deepEqual(listSecretTables(dir).files[0].tables, [
        { name: 'Styles', count: 3, values: ['Rugged dockworker', 'Sharp-suited broker', 'Elegant courtesan'],
            tags: { 'Rugged dockworker': ['man'], 'Sharp-suited broker': ['man'], 'Elegant courtesan': ['woman', 'noble'] } },
        { name: "Men's Attributes", count: 2, values: ['heavy stubble', 'broad shoulders'], when: ['man'],
            tags: { 'heavy stubble': ['scarred'] } },
        { name: 'Jewellery', count: 1, values: ['a thin gold circlet'], when: ['woman', 'noble'] },
    ]);
});

test('json rows carry tags and object tables carry gates', (t) => {
    const dir = folder(t, { 'set.json': JSON.stringify({
        Styles: [{ value: 'Rugged dockworker', tags: ['Man'] }],
        "Men's Attributes": { when: ['man'], rows: [{ value: 'heavy stubble' }] },
    }) });
    assert.deepEqual(listSecretTables(dir).files[0].tables, [
        { name: 'Styles', count: 1, values: ['Rugged dockworker'], tags: { 'Rugged dockworker': ['man'] } },
        { name: "Men's Attributes", count: 1, values: ['heavy stubble'], when: ['man'] },
    ]);
});

test('gate errors are reported against the file that holds the gate', (t) => {
    const dir = folder(t, {
        'a.md': '## G (when: m)\n- b\n',
        'b.md': '## S\n- a #m\n',
        'c.md': '## T (when:)\n- a\n',
        'd.md': '## U\n- a #x\n\n## H (when: x)\n- b\n\n## H\n- c\n',
        'e.json': JSON.stringify({ T: [{ value: 'a', tags: ['no spaces'] }] }),
        'f.md': '## Lonely (when: nobody)\n- x\n',
    });
    const errors = Object.fromEntries(listSecretTables(dir).files.map(file => [file.file, file.error]));
    assert.equal(errors['a.md'], "gated table 'G' comes before 'S', the table that opens it (when: m)");
    assert.equal(errors['b.md'], undefined);
    assert.equal(errors['c.md'], "table 'T' has an empty (when:)");
    assert.equal(errors['d.md'], "table 'H' is repeated with a different (when:)");
    assert.match(errors['e.json'], /tags that are not a list of letters, digits, - and _/);
    // e.json is unreadable, so nothing in the folder can be said for sure to
    // carry no tag at all (F4) - Lonely's own "nothing carries #nobody" is
    // suppressed rather than blaming it while a sibling file is broken.
    assert.equal(errors['f.md'], undefined);
});

test('a heading that is only a (when:) clause is refused, not silently blank-named', (t) => {
    const dir = folder(t, { 'g.md': '## (when: m)\n- x\n' });
    assert.equal(listSecretTables(dir).files[0].error, 'a table name must be non-blank text');
});

test('validateSelection refuses impossible gate selections with the generator texts', (t) => {
    const dir = folder(t, { 'styles.md': GATED_MD });
    const listing = listSecretTables(dir);
    const pick = (values, tables) => ({ extraTables: [{ file: 'styles.md', ...(tables ? { tables } : {}), values }] });
    assert.throws(() => validateSelection(pick({ Styles: 'Elegant courtesan', "Men's Attributes": 'broad shoulders' }), listing, []),
        { message: "extra table 'Men's Attributes' has a fixed value but 'Styles' is fixed to 'Elegant courtesan', which is not #man" });
    assert.throws(() => validateSelection(pick({ "Men's Attributes": 'broad shoulders' }, ["Men's Attributes"]), listing, []),
        { message: "extra table 'Men's Attributes' has a fixed value but nothing selected can open it (when: man)" });
    const ok = validateSelection(pick({ "Men's Attributes": 'broad shoulders' }), listing, []);
    assert.deepEqual(ok.extraValues, [{ table: "Men's Attributes", value: 'broad shoulders' }]);
});
