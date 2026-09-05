/**
 * The pure half of the 3D panel: the command line generate-3d.py is given,
 * and the rule that tells its deliverables apart from its intermediates.
 *
 * Both are here rather than in server.js so they can be asserted on without
 * spawning Python, and because a rename on the generator side should fail a
 * test rather than quietly empty the panel.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { model3dArgs, classify3dFiles } = require('../lib/model3d');

const SCRIPT = 'G:\\GIT-REPOS\\lancer-art-generator\\generate-3d.py';
const ID = 'npc-jules-sokolova-40213';

test('the default build names one NPC by id and nothing else', () => {
    assert.deepEqual(model3dArgs(SCRIPT, { id: ID }), [SCRIPT, '--id', ID]);
});

test('rigging is opt-in, matching the CLI default', () => {
    assert.ok(!model3dArgs(SCRIPT, { id: ID, rig: false }).includes('--rig'));
    assert.ok(model3dArgs(SCRIPT, { id: ID, rig: true }).includes('--rig'));
});

test('overwrite is opt-in - without it generate-3d.py skips an NPC that has a 3d/ folder', () => {
    assert.ok(!model3dArgs(SCRIPT, { id: ID }).includes('--overwrite'));
    assert.ok(model3dArgs(SCRIPT, { id: ID, overwrite: true }).includes('--overwrite'));
});

test('both flags together, in a stable order', () => {
    assert.deepEqual(
        model3dArgs(SCRIPT, { id: ID, rig: true, overwrite: true }),
        [SCRIPT, '--id', ID, '--rig', '--overwrite'],
    );
});

test('an empty id is refused rather than becoming a batch over the whole catalogue', () => {
    // `--id` with nothing after it would make generate-3d.py error, but a
    // missing `--id` altogether selects every NPC in the manifest. A GUI
    // button must never be one typo away from a 160-NPC unattended run.
    assert.throws(() => model3dArgs(SCRIPT, { id: '' }), /id/);
    assert.throws(() => model3dArgs(SCRIPT, {}), /id/);
});

// The real folder listing from output/.../Jules Sokolova/3d, deliverables and
// intermediates together, in the order readdirSync returns them.
const REAL_FOLDER = [
    'Jules Sokolova Print.stl',
    'Jules Sokolova Shell.glb',
    'Jules Sokolova Turnaround_000.png',
    'Jules Sokolova Turnaround_090.png',
    'Jules Sokolova Turnaround_180.png',
    'Jules Sokolova Turnaround_270.png',
    '_base.glb',
    '_shell.glb',
    'apose.png',
    'apose_square.png',
];

test('picks the deliverables out of a real 3d/ folder', () => {
    const found = classify3dFiles(REAL_FOLDER, 'Jules Sokolova');
    assert.equal(found.shell, 'Jules Sokolova Shell.glb');
    assert.equal(found.print, 'Jules Sokolova Print.stl');
    assert.deepEqual(found.turnarounds, [
        'Jules Sokolova Turnaround_000.png',
        'Jules Sokolova Turnaround_090.png',
        'Jules Sokolova Turnaround_180.png',
        'Jules Sokolova Turnaround_270.png',
    ]);
});

test('the intermediates never reach the panel', () => {
    // _shell.glb and _base.glb are the raw reconstructions and apose*.png is
    // the input, all four left on disk on purpose. Listing them beside the
    // deliverables would offer a 17 MB unusable mesh as if it were the model.
    const found = classify3dFiles(REAL_FOLDER, 'Jules Sokolova');
    const listed = [found.shell, found.print, found.rigged, ...found.turnarounds];
    for (const intermediate of ['_base.glb', '_shell.glb', 'apose.png', 'apose_square.png']) {
        assert.ok(!listed.includes(intermediate), `${intermediate} is an intermediate`);
    }
});

test('a rig is reported only when --rig actually produced one', () => {
    assert.equal(classify3dFiles(REAL_FOLDER, 'Jules Sokolova').rigged, null);
    const withRig = classify3dFiles(
        [...REAL_FOLDER, 'Jules Sokolova Rigged.glb'], 'Jules Sokolova',
    );
    assert.equal(withRig.rigged, 'Jules Sokolova Rigged.glb');
});

test('turnarounds come back in angle order however the directory was listed', () => {
    const shuffled = [
        'Jules Sokolova Turnaround_180.png',
        'Jules Sokolova Turnaround_000.png',
        'Jules Sokolova Turnaround_270.png',
        'Jules Sokolova Turnaround_090.png',
    ];
    assert.deepEqual(classify3dFiles(shuffled, 'Jules Sokolova').turnarounds, [
        'Jules Sokolova Turnaround_000.png',
        'Jules Sokolova Turnaround_090.png',
        'Jules Sokolova Turnaround_180.png',
        'Jules Sokolova Turnaround_270.png',
    ]);
});

test('another NPC\'s files in the same folder are not claimed', () => {
    // generate-3d.py names deliverables from the manifest entry, so a folder
    // that was renamed or reused can hold two sets. Matching on the NPC's own
    // name keeps the panel showing the NPC it was opened for.
    const found = classify3dFiles(
        [...REAL_FOLDER, 'Lucia Vos Shell.glb', 'Lucia Vos Turnaround_000.png'],
        'Jules Sokolova',
    );
    assert.equal(found.shell, 'Jules Sokolova Shell.glb');
    assert.equal(found.turnarounds.length, 4);
});

test('an empty folder is no model rather than a crash', () => {
    const found = classify3dFiles([], 'Jules Sokolova');
    assert.equal(found.shell, null);
    assert.equal(found.print, null);
    assert.equal(found.rigged, null);
    assert.deepEqual(found.turnarounds, []);
});

test('a name with regex metacharacters is matched literally', () => {
    // Callsign-style names reach this from the manifest verbatim. Building a
    // pattern out of one unescaped would either throw or match the wrong file.
    const found = classify3dFiles(['A. "Rook" O+C Shell.glb'], 'A. "Rook" O+C');
    assert.equal(found.shell, 'A. "Rook" O+C Shell.glb');
    assert.equal(classify3dFiles(['AX"Rook" OXC Shell.glb'], 'A. "Rook" O+C').shell, null);
});
