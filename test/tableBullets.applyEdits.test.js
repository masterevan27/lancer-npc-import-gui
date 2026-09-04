/**
 * applyEditsInText(): many bullet edits in one pass over the file.
 *
 * Covers known-issues 1 and 3 together, because they are the same defect seen
 * from two sides. Applying a preset used to call toggleBulletOnDisk() and
 * setBulletWeightOnDisk() once per changed bullet - each of which re-read,
 * re-parsed and re-wrote the whole of npc-generator-tables.md - and then
 * discarded the {ok:false} each returned. So an apply was neither atomic nor
 * cheap, and a write that a guard rejected was reported to the caller as a
 * success.
 *
 * One primitive fixes both: the file is walked once to index its bullet
 * lines, every edit is resolved against that index, and the failures come
 * back as data rather than being dropped.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyEditsInText, parseTableFile } = require('../lib/tableBullets');

const SAMPLE = [
    '# Random NPC Generator Tables',
    '',
    '## How the script reads this file',
    '',
    '- this is documentation, not a roll option',
    '',
    '## Outfit',
    '',
    '- a heavy work jacket || civ',
    '- x4 nondescript grey work coveralls',
    '<!-- - a graffiti-tagged cropped t-shirt || civ -->',
    '',
    '## Gear',
    '',
    '- nothing at all, hands loose and empty',
    '- x2 a battered data-slate',
    '',
].join('\n');

/** A table's bullets from applyEditsInText's output, for asserting on. */
function bulletsOf(text, table) {
    return parseTableFile(text).find((t) => t.name === table).bullets;
}

test('applies a disable, an enable and a reweight in a single pass', () => {
    const { text, applied, failed } = applyEditsInText(SAMPLE, [
        { table: 'Outfit', text: 'a heavy work jacket || civ', enabled: false },
        { table: 'Outfit', text: 'a graffiti-tagged cropped t-shirt || civ', enabled: true, weight: 3 },
        { table: 'Gear', text: 'a battered data-slate', weight: 5 },
    ]);
    assert.deepEqual(failed, []);
    assert.equal(applied.length, 3);
    assert.deepEqual(bulletsOf(text, 'Outfit'), [
        { text: 'a heavy work jacket || civ', weight: 1, enabled: false },
        { text: 'nondescript grey work coveralls', weight: 4, enabled: true },
        { text: 'a graffiti-tagged cropped t-shirt || civ', weight: 3, enabled: true },
    ]);
    assert.deepEqual(bulletsOf(text, 'Gear')[1],
        { text: 'a battered data-slate', weight: 5, enabled: true });
});

test('an edit that enables and reweights at once rewrites the line only once', () => {
    const { text } = applyEditsInText(SAMPLE, [
        { table: 'Outfit', text: 'a graffiti-tagged cropped t-shirt || civ', enabled: true, weight: 2 },
    ]);
    const lines = text.split('\n').filter((l) => l.includes('graffiti-tagged'));
    assert.equal(lines.length, 1);
    assert.equal(lines[0], '- x2 a graffiti-tagged cropped t-shirt || civ');
});

test('a weight edit alone leaves the bullet enabled-or-disabled state alone', () => {
    const { text } = applyEditsInText(SAMPLE, [
        { table: 'Outfit', text: 'a graffiti-tagged cropped t-shirt || civ', weight: 7 },
    ]);
    assert.deepEqual(bulletsOf(text, 'Outfit')[2],
        { text: 'a graffiti-tagged cropped t-shirt || civ', weight: 7, enabled: false });
});

test('a rejected weight is reported rather than swallowed, and applies nothing', () => {
    const { text, applied, failed } = applyEditsInText(SAMPLE, [
        { table: 'Gear', text: 'a battered data-slate', weight: 0 },
    ]);
    assert.deepEqual(applied, []);
    assert.equal(failed.length, 1);
    assert.match(failed[0].error, /weight must be an integer >= 1/);
    assert.equal(text, SAMPLE);
});

test('a bullet that is not in the named table is reported, not silently skipped', () => {
    const { applied, failed } = applyEditsInText(SAMPLE, [
        { table: 'Gear', text: 'a bullet that was never there', enabled: false },
    ]);
    assert.deepEqual(applied, []);
    assert.equal(failed.length, 1);
    assert.match(failed[0].error, /no bullet matching that text under "## Gear"/);
});

test('a documentation section is refused the same way the single-edit writers refuse it', () => {
    const { applied, failed } = applyEditsInText(SAMPLE, [
        { table: 'How the script reads this file', text: 'this is documentation, not a roll option', enabled: false },
    ]);
    assert.deepEqual(applied, []);
    assert.match(failed[0].error, /is not a roll table/);
});

test('one bad edit does not stop the good ones in the same batch', () => {
    const { text, applied, failed } = applyEditsInText(SAMPLE, [
        { table: 'Gear', text: 'a battered data-slate', weight: 0 },
        { table: 'Outfit', text: 'a heavy work jacket || civ', enabled: false },
    ]);
    assert.equal(failed.length, 1);
    assert.equal(applied.length, 1);
    assert.equal(bulletsOf(text, 'Outfit')[0].enabled, false);
});

test('edits to the same bullet compose rather than the last one winning outright', () => {
    // The second edit reads the line the first one wrote, so a disable
    // followed by a reweight keeps the disable.
    const { text } = applyEditsInText(SAMPLE, [
        { table: 'Gear', text: 'a battered data-slate', enabled: false },
        { table: 'Gear', text: 'a battered data-slate', weight: 9 },
    ]);
    assert.deepEqual(bulletsOf(text, 'Gear')[1],
        { text: 'a battered data-slate', weight: 9, enabled: false });
});

test('an empty batch is a no-op that reports nothing', () => {
    const { text, applied, failed } = applyEditsInText(SAMPLE, []);
    assert.equal(text, SAMPLE);
    assert.deepEqual(applied, []);
    assert.deepEqual(failed, []);
});
