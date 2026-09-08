const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    TABLE_FLAGS, THREE_SEGMENT_TABLES,
    proseSegments, knownFlags, hasFlags,
    splitBulletFlags, joinBulletFlags, setBulletFlag,
} = require('../lib/tableFlags');
const { NON_TABLE_SECTIONS } = require('../lib/tableBullets');

/*
 * The two things this module has to get right, and the two ways a flag editor
 * corrupts npc-generator-tables.md if it gets them wrong:
 *
 *   1. Writing flags into the wrong `||` segment. Backdrop, Hair colour and
 *      Faction carry two segments of PROSE and a third of flags. Treating the
 *      second as flags overwrites a scene sentence, a colour tail or a
 *      faction's visual - all of which reach the image prompt.
 *   2. Writing a flag the generator does not read. It matches literally and
 *      ignores an unknown flag rather than reporting it, so a typo fails
 *      quietly in the render rather than loudly at the console.
 */

/* ---------------------------------------------------------------- */
/* Segment arity                                                     */
/* ---------------------------------------------------------------- */

test('two-segment tables keep their flags in the second segment', () => {
    assert.equal(proseSegments('Hair'), 1);
    assert.equal(proseSegments('Headgear'), 1);
    assert.equal(proseSegments('Weapon'), 1);
});

test('Backdrop, Hair colour and Faction keep theirs in the third', () => {
    for (const table of ['Backdrop', 'Hair colour', 'Faction']) {
        assert.equal(proseSegments(table), 2, table);
        assert.ok(THREE_SEGMENT_TABLES.has(table), table);
    }
});

test('splitBulletFlags reads a plain two-segment bullet', () => {
    const got = splitBulletFlags('Hair', 'a high, tight {colour} topknot || updo');
    assert.deepEqual(got, {
        body: 'a high, tight {colour} topknot',
        flags: ['updo'],
        themes: [],
    });
});

test('splitBulletFlags reads a bullet with no flag segment at all', () => {
    const got = splitBulletFlags('Hair', 'a short {colour} crop');
    assert.deepEqual(got, { body: 'a short {colour} crop', flags: [], themes: [] });
});

test('splitBulletFlags keeps BOTH prose segments of a Backdrop bullet', () => {
    // The corruption case. A naive last-segment read would call the scene
    // sentence a flag list and a naive second-segment write would replace it.
    const text = 'A character portrait || {Subject} {is_are} on a rooftop at dusk || nogear weather';
    const got = splitBulletFlags('Backdrop', text);
    assert.equal(got.body, 'A character portrait || {Subject} {is_are} on a rooftop at dusk');
    assert.deepEqual(got.flags, ['nogear', 'weather']);
});

test('a two-segment Backdrop bullet has a scene and NO flags', () => {
    // Arity is not inferable from segment count, which is why the table list
    // is a literal. This bullet's second segment is prose, not a flag.
    const text = 'A character portrait || {Subject} {is_are} standing in a blurred alley';
    const got = splitBulletFlags('Backdrop', text);
    assert.equal(got.body, text.split('||').map((p) => p.trim()).join(' || '));
    assert.deepEqual(got.flags, []);
});

test('a Hair colour bullet with an empty tail keeps the empty segment', () => {
    // 'greying || || older' is a real shape in the live file: no tail, but a
    // flag, so the separator has to survive a round trip.
    const got = splitBulletFlags('Hair colour', 'greying || || older');
    assert.deepEqual(got.flags, ['older']);
    const back = joinBulletFlags('Hair colour', got.body, got.flags, got.themes);
    assert.deepEqual(splitBulletFlags('Hair colour', back).flags, ['older']);
});

/* ---------------------------------------------------------------- */
/* Theme tags                                                        */
/* ---------------------------------------------------------------- */

test('theme tags are split out from behavioural flags', () => {
    const got = splitBulletFlags('Weapon', 'a curved blade raised overhead || hands weapon blade @grimdark');
    assert.deepEqual(got.flags, ['hands', 'weapon', 'blade']);
    assert.deepEqual(got.themes, ['@grimdark']);
});

test('a theme tag survives a flag edit, and stays last', () => {
    const before = 'a curved blade raised overhead || hands weapon @grimdark';
    const { text } = setBulletFlag('Weapon', before, 'blade', true);
    assert.match(text, /@grimdark$/);
    const got = splitBulletFlags('Weapon', text);
    assert.deepEqual(got.themes, ['@grimdark']);
    assert.ok(got.flags.includes('blade'));
});

test('a bullet whose only token is a theme tag is not read as a flag', () => {
    const got = splitBulletFlags('Headgear', '{Subject} {wear} a woven hat. || @neosamurai');
    assert.deepEqual(got.flags, []);
    assert.deepEqual(got.themes, ['@neosamurai']);
});

/* ---------------------------------------------------------------- */
/* Setting and clearing                                              */
/* ---------------------------------------------------------------- */

test('setBulletFlag adds a flag to a bullet that had none', () => {
    const { ok, text } = setBulletFlag(
        'Headgear', '{Subject} {wear} a wide woven sedge hat.', 'crown', true);
    assert.equal(ok, true);
    assert.equal(text, '{Subject} {wear} a wide woven sedge hat. || crown');
});

test('clearing the last flag restores the plain line with no dangling ||', () => {
    const { text } = setBulletFlag(
        'Headgear', '{Subject} {wear} a wide woven sedge hat. || crown', 'crown', false);
    assert.equal(text, '{Subject} {wear} a wide woven sedge hat.');
    assert.ok(!text.includes('||'));
});

test('setting a flag that is already set is a no-op, not a duplicate', () => {
    const before = 'a high, tight {colour} topknot || updo';
    const { text } = setBulletFlag('Hair', before, 'updo', true);
    assert.equal(text, before);
});

test('clearing a flag that is not set is a no-op', () => {
    const before = 'a short {colour} crop';
    const { text } = setBulletFlag('Hair', before, 'updo', false);
    assert.equal(text, before);
});

test('flags are written in the vocabulary order however they were clicked', () => {
    let text = '{Subject} {wear} a sealed flight helmet.';
    ({ text } = setBulletFlag('Headgear', text, 'helmet', true));
    ({ text } = setBulletFlag('Headgear', text, 'hardtech', true));
    // hardtech precedes helmet in the vocabulary, so it leads regardless of
    // click order. The generator reads flags as an unordered set; this is for
    // the file's legibility, and to keep diffs stable.
    assert.equal(text, '{Subject} {wear} a sealed flight helmet. || hardtech helmet');
});

test('setBulletFlag refuses a flag the table does not read', () => {
    // The whole argument for checkboxes over a free-text box: the generator
    // ignores an unrecognized flag silently, so this is the only place the
    // mistake can be caught at all.
    const { ok, error } = setBulletFlag('Eyes', 'grey eyes', 'updo', true);
    assert.equal(ok, false);
    assert.match(error, /not a flag the Eyes table reads/);
});

test('setBulletFlag refuses a misspelled flag on a table that has a vocabulary', () => {
    const { ok } = setBulletFlag('Hair', 'a short {colour} crop', 'updoo', true);
    assert.equal(ok, false);
});

test('a flag added by hand outside the vocabulary is preserved, not dropped', () => {
    // This editor is not the only thing that writes the file. Silently
    // deleting a flag someone added ahead of this vocabulary would be worse
    // than showing no checkbox for it.
    const before = 'a short {colour} crop || somethingnew';
    const { text } = setBulletFlag('Hair', before, 'updo', true);
    assert.ok(text.includes('somethingnew'), text);
    assert.ok(text.includes('updo'), text);
});

test('adding a flag to a Backdrop bullet does not touch its scene sentence', () => {
    const before = 'A character portrait || {Subject} {is_are} on a rooftop at dusk || weather';
    const { text } = setBulletFlag('Backdrop', before, 'nogear', true);
    assert.ok(text.startsWith('A character portrait || {Subject} {is_are} on a rooftop at dusk || '), text);
    const got = splitBulletFlags('Backdrop', text);
    assert.deepEqual(got.flags.sort(), ['nogear', 'weather']);
});

test('adding a flag to a two-segment Backdrop bullet appends a THIRD segment', () => {
    const before = 'A character portrait || {Subject} {is_are} in a blurred alley';
    const { text } = setBulletFlag('Backdrop', before, 'weather', true);
    assert.equal(text, `${before} || weather`);
    assert.equal(text.split('||').length, 3);
});

/* ---------------------------------------------------------------- */
/* The vocabulary itself                                             */
/* ---------------------------------------------------------------- */

test('tables with no flag vocabulary get no checkboxes', () => {
    // Skin, Eyes, Demeanor, Glow colour, Height and the name tables carry no
    // '||' segment at all - their text is dropped into the prompt verbatim,
    // so a flag written there would ship literally to the image model.
    for (const table of ['Eyes', 'Skin', 'Demeanor', 'Glow colour', 'Height']) {
        assert.equal(hasFlags(table), false, table);
        assert.deepEqual(knownFlags(table), [], table);
    }
});

/*
 * The drift check at the bottom of this file is the real guard, but it runs
 * only where a generator sits beside the repo - so it is silent in CI and on
 * any checkout without one. These two name the flags that check caught, so a
 * regression that drops them again fails everywhere rather than nowhere.
 *
 * Both sets are read by generate-npc.py against the live tables: the five Glow
 * placement prop gates through PLACEMENT_REQUIRES/PLACEMENT_FORBIDS in
 * filter_by_placement_prop(), and Faction's 'unaffiliated' through
 * filter_by_affiliation(). A flag the generator reads but this module does not
 * document gets no checkbox, which leaves it invisible in the Tables tab and
 * refused by setBulletFlag() - the quiet failure the vocabulary exists to
 * prevent.
 */
test("Glow placement's prop gates each have a checkbox", () => {
    for (const flag of ['scene', 'ground', 'wall', 'air', 'screens', 'signage']) {
        assert.ok(knownFlags('Glow placement').includes(flag), flag);
    }
});

test("Faction's 'unaffiliated' marker has a checkbox", () => {
    // A marker rather than a preference, the same shape 'none' has on Weapon
    // and 'bare' on Headgear: nothing is dropped FOR it. It is what
    // filter_by_affiliation() matches on to cut a work-for-nobody Role's
    // Faction pool down to the two non-affiliations.
    assert.ok(knownFlags('Faction').includes('unaffiliated'));
});

test('every documented flag has a non-empty gloss', () => {
    for (const [table, flags] of Object.entries(TABLE_FLAGS)) {
        for (const [flag, gloss] of Object.entries(flags)) {
            assert.equal(typeof gloss, 'string', `${table}.${flag}`);
            assert.ok(gloss.trim().length > 10, `${table}.${flag} gloss is too thin`);
        }
    }
});

test('a pronoun variant carries its base table vocabulary', () => {
    // '<Table> (she) +' is ADDED to the shared pool rather than replacing it,
    // so its bullets are drawn from the same roll and read by the same
    // filters - a flag readable on one is readable on the other.
    //
    // Derived rather than listed, because listing them is exactly what went
    // wrong: the first version of this module spelled out Hair, Outfit and
    // Stance variants and forgot 'Headgear (she) +' - which is where the wide
    // woven hat that prompted the whole 'crown' flag actually lives, so the
    // one bullet the feature was built for would have had no checkboxes.
    for (const [variant, base] of [
        ['Hair (she) +', 'Hair'],
        ['Outfit (she) +', 'Outfit'],
        ['Stance (she) +', 'Stance'],
        ['Headgear (she) +', 'Headgear'],
        ['Weapon (she) +', 'Weapon'],
        ['Hair colour (she) +', 'Hair colour'],
        ['Build (she)', 'Build (she)'],
    ]) {
        assert.deepEqual(knownFlags(variant), knownFlags(base), variant);
    }
});

test('the hat that prompted the crown flag gets a crown checkbox', () => {
    // It lives under 'Headgear (she) +', not 'Headgear'. Regression pin.
    assert.ok(knownFlags('Headgear (she) +').includes('crown'));
});

test('segment arity follows the base heading for a variant too', () => {
    assert.equal(proseSegments('Hair colour (she) +'), 2);
    assert.equal(proseSegments('Backdrop (she) +'), 2);
    assert.equal(proseSegments('Headgear (she) +'), 1);
    const got = splitBulletFlags('Hair colour (she) +', 'greying || || older');
    assert.deepEqual(got.flags, ['older']);
});

test('a variant bullet can be flagged, and keeps its prose', () => {
    const before = '{Subject} {wear} a wide woven hat, thin red-framed glasses.';
    const { ok, text } = setBulletFlag('Headgear (she) +', before, 'crown', true);
    assert.equal(ok, true);
    assert.equal(text, `${before} || crown`);
});

/* ---------------------------------------------------------------- */
/* Drift against the real generator, when one is checked out         */
/* ---------------------------------------------------------------- */

/*
 * The vocabulary lives in THIS repo and the flags live in the generator's, so
 * they can drift silently - a flag added there gets no checkbox here, which is
 * the same quiet failure the checkboxes exist to prevent.
 *
 * Checked in one direction only, and only when a generator is actually
 * checked out beside this repo: the suite's whole point is that it runs
 * against synthetic fixtures and never the user's real tables, and CI has no
 * generator at all. So this SKIPS rather than fails when the file is absent.
 * A flag this module documents ahead of the table that will use it is fine.
 */
/*
 * Found by walking up rather than by a fixed number of '..' segments: this
 * file sits at <repo>/test in a normal checkout and at
 * <repo>/.claude/worktrees/<name>/test in a worktree, so any hardcoded depth
 * is right in one and silently skips in the other - which is the worst
 * outcome, since a skipped drift check looks exactly like a passing one.
 */
function findSiblingTables(from) {
    let dir = from;
    for (let i = 0; i < 8; i++) {
        const candidate = path.join(
            dir, 'lancer-art-generator', 'prompts', 'npc-generator-tables.md');
        if (fs.existsSync(candidate)) return candidate;
        const up = path.dirname(dir);
        if (up === dir) break;
        dir = up;
    }
    return null;
}

const SIBLING_TABLES = findSiblingTables(__dirname);

test('every flag the live tables use has a checkbox', { skip: !SIBLING_TABLES && 'no generator checked out beside this repo' }, () => {
    const text = fs.readFileSync(SIBLING_TABLES, 'utf8');
    const missing = [];
    let table = null;
    for (const line of text.split('\n')) {
        const heading = line.match(/^##\s+(?!#)\s*(.*?)\s*$/);
        if (heading) { table = heading[1]; continue; }
        if (NON_TABLE_SECTIONS.includes(table)) continue;
        const bullet = line.match(/^(?:<!--\s*)?-\s+(.*?)(?:\s*-->)?\s*$/);
        if (!bullet || !table) continue;
        const { flags } = splitBulletFlags(table, bullet[1]);
        for (const flag of flags) {
            if (!knownFlags(table).includes(flag)) missing.push(`${table}: ${flag}`);
        }
    }
    assert.deepEqual([...new Set(missing)], [],
        'lib/tableFlags.js is missing flags the live tables use');
});
