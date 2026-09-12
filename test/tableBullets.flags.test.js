const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseTableFile, setBulletFlagInText,
} = require('../lib/tableBullets');
const { diffPresetAgainstTables } = require('../lib/presets');

const SAMPLE = [
    '# Random NPC Generator Tables',
    '',
    '## Hair',
    '',
    '- a high, tight {colour} topknot || updo',
    '- x4 a short {colour} crop',
    '<!-- - a {colour} bob swept low across one eye -->',
    '',
    '## Headgear',
    '',
    '- {Subject} {wear} a wide woven sedge hat.',
    '- {Subject} {wear} a sealed flight helmet. || hardtech helmet',
    '',
    '## Backdrop',
    '',
    '- A character portrait || {Subject} {is_are} on a rooftop at dusk || weather',
    '',
    '## How the script reads this file',
    '',
    '- this is documentation, not a roll option',
    '',
].join('\n');

function bulletsOf(text, tableName) {
    return parseTableFile(text).find((t) => t.name === tableName).bullets;
}

/* ---------------------------------------------------------------- */
/* Writing a flag into the file                                      */
/* ---------------------------------------------------------------- */

test('setBulletFlagInText adds a flag to a bullet that had none', () => {
    const result = setBulletFlagInText(
        SAMPLE, 'Headgear', '{Subject} {wear} a wide woven sedge hat.', 'crown', true);
    assert.equal(result.ok, true);
    assert.match(result.text, /- \{Subject\} \{wear\} a wide woven sedge hat\. \|\| crown/);
});

test('setBulletFlagInText clears a flag, leaving no dangling separator', () => {
    const result = setBulletFlagInText(
        SAMPLE, 'Hair', 'a high, tight {colour} topknot || updo', 'updo', false);
    assert.equal(result.ok, true);
    const bullets = bulletsOf(result.text, 'Hair');
    assert.ok(bullets.some((b) => b.text === 'a high, tight {colour} topknot'), result.text);
    assert.ok(!result.text.includes('topknot ||'), result.text);
});

test('a flag edit preserves the bullet weight prefix', () => {
    const result = setBulletFlagInText(SAMPLE, 'Hair', 'a short {colour} crop', 'updo', true);
    assert.equal(result.ok, true);
    const bullet = bulletsOf(result.text, 'Hair').find((b) => b.text.startsWith('a short'));
    assert.equal(bullet.weight, 4, 'the x4 prefix was lost');
    assert.equal(bullet.text, 'a short {colour} crop || updo');
});

test('a flag edit keeps a disabled bullet disabled', () => {
    const result = setBulletFlagInText(
        SAMPLE, 'Hair', 'a {colour} bob swept low across one eye', 'updo', true);
    assert.equal(result.ok, true);
    const bullet = bulletsOf(result.text, 'Hair').find((b) => b.text.startsWith('a {colour} bob'));
    assert.equal(bullet.enabled, false, 'a flag edit re-enabled a disabled bullet');
    assert.equal(bullet.text, 'a {colour} bob swept low across one eye || updo');
    assert.match(result.text, /<!-- - a \{colour\} bob swept low across one eye \|\| updo -->/);
});

test('a Backdrop flag edit leaves the scene sentence intact', () => {
    // The corruption case this module's segment arity exists to prevent.
    const result = setBulletFlagInText(
        SAMPLE, 'Backdrop',
        'A character portrait || {Subject} {is_are} on a rooftop at dusk || weather',
        'nogear', true);
    assert.equal(result.ok, true);
    assert.match(result.text, /\{Subject\} \{is_are\} on a rooftop at dusk/);
    const bullet = bulletsOf(result.text, 'Backdrop')[0];
    assert.equal(bullet.text.split('||').length, 3);
});

test('setBulletFlagInText refuses a flag the table does not read', () => {
    const result = setBulletFlagInText(
        SAMPLE, 'Hair', 'a short {colour} crop', 'helmet', true);
    assert.equal(result.ok, false);
    assert.match(result.error, /not a flag the Hair table reads/);
});

test('setBulletFlagInText refuses a documentation section', () => {
    const result = setBulletFlagInText(
        SAMPLE, 'How the script reads this file',
        'this is documentation, not a roll option', 'updo', true);
    assert.equal(result.ok, false);
    assert.match(result.error, /not a roll table/);
});

test('setBulletFlagInText reports a bullet it cannot find', () => {
    const result = setBulletFlagInText(SAMPLE, 'Hair', 'no such bullet', 'updo', true);
    assert.equal(result.ok, false);
    assert.match(result.error, /no bullet matching that text/);
});

test('setting a flag that is already set rewrites nothing', () => {
    const result = setBulletFlagInText(
        SAMPLE, 'Hair', 'a high, tight {colour} topknot || updo', 'updo', true);
    assert.equal(result.ok, true);
    assert.equal(result.text, SAMPLE, 'the file was rewritten for a no-op edit');
});

/* ---------------------------------------------------------------- */
/* Presets survive a flag edit                                       */
/* ---------------------------------------------------------------- */

/*
 * The consequence that made this more than a UI change. A preset stores each
 * enabled bullet's full text, flags included, and apply is a WHITELIST -
 * anything the preset does not list gets disabled. So before presets learned
 * to match on the flag-stripped body, flagging a bullet renamed it out from
 * under every saved preset, which would then have switched it off.
 */

test('a preset saved before a flag edit still matches the bullet after it', () => {
    const preset = {
        Headgear: [
            { text: '{Subject} {wear} a wide woven sedge hat.', weight: 1 },
            { text: '{Subject} {wear} a sealed flight helmet. || hardtech helmet', weight: 1 },
        ],
    };
    const edited = setBulletFlagInText(
        SAMPLE, 'Headgear', '{Subject} {wear} a wide woven sedge hat.', 'crown', true);
    const diff = diffPresetAgainstTables(preset, parseTableFile(edited.text));

    assert.deepEqual(diff.notFound, [], 'the flagged bullet was orphaned by the preset');
    assert.deepEqual(diff.willDisable, [], 'the preset would have switched the flagged bullet off');
    assert.equal(diff.alreadyMatching.length, 2);
});

test('the diff names the bullet by its CURRENT text, which the writers match on', () => {
    // Resolving on the stripped body must not leak the stripped body into the
    // diff: lib/tableBullets.js matches on the full text, so an entry carrying
    // the flagless version would fail to apply.
    const preset = { Hair: [{ text: 'a short {colour} crop', weight: 1 }] };
    const edited = setBulletFlagInText(SAMPLE, 'Hair', 'a short {colour} crop', 'updo', true);
    const diff = diffPresetAgainstTables(preset, parseTableFile(edited.text));
    const entry = [...diff.willReweight, ...diff.alreadyMatching, ...diff.willEnable]
        .find((e) => e.text.startsWith('a short'));
    assert.equal(entry.text, 'a short {colour} crop || updo');
});

test('a preset still disables a bullet it genuinely does not list', () => {
    // The other half: flag-insensitive matching must not make apply
    // permissive. A bullet absent from the preset is still switched off.
    const preset = { Hair: [{ text: 'a short {colour} crop', weight: 4 }] };
    const diff = diffPresetAgainstTables(preset, parseTableFile(SAMPLE));
    assert.ok(diff.willDisable.some((e) => e.text.includes('topknot')),
        'the topknot should have been disabled');
});

test('a preset naming a bullet that no longer exists is still reported', () => {
    const preset = { Hair: [{ text: 'a cut nobody wrote || updo', weight: 1 }] };
    const diff = diffPresetAgainstTables(preset, parseTableFile(SAMPLE));
    assert.equal(diff.notFound.length, 1);
    assert.equal(diff.notFound[0].text, 'a cut nobody wrote || updo');
});

test('a flag edit inside a group table resolves the vocabulary through the reference', () => {
    const file = ['## Outfit', '- => Flight suits', '## Flight suits', '- a flight suit', ''].join('\n');
    const out = setBulletFlagInText(file, 'Flight suits', 'a flight suit', 'mil', true);
    assert.equal(out.ok, true, out.error);
    assert.equal(out.text, ['## Outfit', '- => Flight suits', '## Flight suits', '- a flight suit || mil', ''].join('\n'));
});
