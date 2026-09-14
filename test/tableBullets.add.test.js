const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseTableFile, addBulletInText, addBulletOnDisk } = require('../lib/tableBullets');

const SAMPLE = [
    '# Random NPC Generator Tables',
    '',
    '## Outfit',
    '',
    '- a heavy work jacket over a stained undersuit || civ',
    '- x4 nondescript grey work coveralls',
    '<!-- - a graffiti-tagged cropped t-shirt and cut-off shorts || civ -->',
    '',
    '## Eyes',
    '',
    '- pale grey eyes',
    '',
    '## Backdrop',
    '',
    '- A character portrait || {Subject} {is_are} on a rooftop at dusk || weather',
    '',
    '## Empty',
    '',
    '## Gear',
    '',
    '- nothing at all, hands loose and empty',
    '',
].join('\n');

function bulletsOf(text, table) {
    return parseTableFile(text).find((t) => t.name === table).bullets;
}

test('addBulletInText appends an enabled bullet after the table\'s last bullet', () => {
    const result = addBulletInText(SAMPLE, 'Outfit', 'a patched flight jacket', 1);
    assert.equal(result.ok, true);
    assert.equal(result.bullet.text, 'a patched flight jacket');
    const lines = result.text.split('\n');
    const at = lines.indexOf('- a patched flight jacket');
    // After the disabled bullet, before the blank line that closes the table.
    assert.equal(lines[at - 1], '<!-- - a graffiti-tagged cropped t-shirt and cut-off shorts || civ -->');
    assert.equal(lines[at + 1], '');
    assert.equal(lines[at + 2], '## Eyes');
    assert.deepEqual(bulletsOf(result.text, 'Outfit').at(-1),
        { text: 'a patched flight jacket', weight: 1, enabled: true });
    // Every other table is untouched.
    assert.deepEqual(bulletsOf(result.text, 'Gear'), bulletsOf(SAMPLE, 'Gear'));
});

test('addBulletInText writes a weight prefix only for weights above 1', () => {
    const result = addBulletInText(SAMPLE, 'Eyes', 'amber eyes', 3);
    assert.equal(result.ok, true);
    assert.match(result.text, /^- x3 amber eyes$/m);
    assert.deepEqual(bulletsOf(result.text, 'Eyes').at(-1), { text: 'amber eyes', weight: 3, enabled: true });
});

test('addBulletInText trims the text and defaults the weight to 1', () => {
    const result = addBulletInText(SAMPLE, 'Eyes', '   amber eyes  ');
    assert.equal(result.ok, true);
    assert.match(result.text, /^- amber eyes$/m);
});

test('addBulletInText places the first bullet of an empty table under its heading', () => {
    const result = addBulletInText(SAMPLE, 'Empty', 'something new', 1);
    assert.equal(result.ok, true);
    assert.deepEqual(bulletsOf(result.text, 'Empty'), [{ text: 'something new', weight: 1, enabled: true }]);
    assert.deepEqual(bulletsOf(result.text, 'Gear'), bulletsOf(SAMPLE, 'Gear'));
});

test('addBulletInText keeps CRLF line endings in a CRLF file', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n');
    const result = addBulletInText(crlf, 'Eyes', 'amber eyes', 1);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('- amber eyes\r\n'));
    assert.equal(result.text.split('\n').filter((l) => !l.endsWith('\r')).length, 1, 'only the final empty line lacks \\r');
});

test('addBulletInText accepts flags the table reads and theme tags', () => {
    const result = addBulletInText(SAMPLE, 'Outfit', 'a pressed dress uniform || mil @neosamurai', 1);
    assert.equal(result.ok, true, result.error);
});

test('addBulletInText keeps a three-segment table\'s scene sentence as prose, not flags', () => {
    const result = addBulletInText(SAMPLE, 'Backdrop', 'A character portrait || {Subject} {is_are} in a hangar bay', 1);
    assert.equal(result.ok, true, result.error);
});

test('addBulletInText stores a flag segment verbatim, whatever the vocabulary', () => {
    // The flag vocabulary is keyed on heading name alone and describes the NPC
    // file: the ship file's own '## Backdrop' reads 'dock' and 'combat', which
    // the NPC Backdrop does not. Gating an add on it would refuse real ship
    // values, so the add writes what the GM typed, as a hand edit would.
    const result = addBulletInText(SAMPLE, 'Backdrop', 'A ship || moored in a dock || dock combat', 1);
    assert.equal(result.ok, true, result.error);
    assert.match(result.text, /^- A ship \|\| moored in a dock \|\| dock combat$/m);
});

test('addBulletInText rejects a value whose prose already exists in the table', () => {
    // Presets and every writer resolve a bullet by its prose, so a second copy
    // would be unreachable - including a copy that differs only in flags, or
    // one matching a disabled bullet.
    for (const text of [
        'nondescript grey work coveralls',
        'a heavy work jacket over a stained undersuit',
        'a graffiti-tagged cropped t-shirt and cut-off shorts || civ',
    ]) {
        const result = addBulletInText(SAMPLE, 'Outfit', text, 1);
        assert.equal(result.ok, false, text);
        assert.match(result.error, /already/);
    }
});

test('addBulletInText rejects text that the file format would misread', () => {
    const cases = [
        ['', /empty/],
        ['   ', /empty/],
        ['two\nlines', /one line/],
        ['two\r\nlines', /one line/],
        ['x2 looks like a weight', /weight/],
        ['sneaky --> comment end', /comment/],
        ['<!-- comment start', /comment/],
        ['=> Flight suits', /group reference/],
    ];
    for (const [text, error] of cases) {
        const result = addBulletInText(SAMPLE, 'Outfit', text, 1);
        assert.equal(result.ok, false, JSON.stringify(text));
        assert.match(result.error, error, JSON.stringify(text));
    }
});

test('addBulletInText rejects a bad weight, an unknown table and a documentation section', () => {
    assert.equal(addBulletInText(SAMPLE, 'Outfit', 'new', 0).ok, false);
    assert.equal(addBulletInText(SAMPLE, 'Outfit', 'new', 1.5).ok, false);
    assert.match(addBulletInText(SAMPLE, 'Nope', 'new', 1).error, /no table/);
    const doc = `## How the script reads this file\n\n- explains things\n\n${SAMPLE}`;
    assert.match(addBulletInText(doc, 'How the script reads this file', 'new', 1).error, /not a roll table/);
});

test('addBulletOnDisk writes the file and returns the stored bullet', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'add-bullet-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'tables.md');
    fs.writeFileSync(file, SAMPLE);

    const result = addBulletOnDisk(file, 'Gear', 'a battered toolkit', 2);
    assert.deepEqual(result, { ok: true, bullet: { text: 'a battered toolkit', weight: 2, enabled: true } });
    assert.match(fs.readFileSync(file, 'utf8'), /^- x2 a battered toolkit$/m);

    const before = fs.statSync(file).mtimeMs;
    assert.equal(addBulletOnDisk(file, 'Gear', 'a battered toolkit', 1).ok, false);
    assert.equal(fs.statSync(file).mtimeMs, before, 'a rejected add leaves the file alone');
});
