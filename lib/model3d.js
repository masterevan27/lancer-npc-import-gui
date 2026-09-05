/**
 * The pure half of the detail overlay's 3D panel.
 *
 * Nothing here touches the filesystem or spawns anything: `model3dArgs`
 * builds the command line and `classify3dFiles` reads a directory listing
 * someone else made. Both exist as functions rather than inline in server.js
 * so they can be asserted on without a Python interpreter, a ComfyUI server
 * or the twenty minutes a real reconstruction takes.
 *
 * The naming rule in `classify3dFiles` mirrors the Outputs table in the
 * generator repo's docs/generate-3d.md. It is duplicated knowledge, which is
 * why it is one function with its own tests: a rename on that side should
 * fail `test/model3d.test.js` rather than quietly empty the panel.
 */

/**
 * The argv for one 3D build. Separate so a test can assert on it without
 * spawning, the same shape traitOdds.oddsArgs uses.
 *
 * `id` is required and validated. generate-3d.py with no selection flag at
 * all does not error - it selects every NPC in the manifest and starts an
 * unattended batch, which for a 160-NPC catalogue is hours of GPU time and
 * gigabytes of output. A GUI button must not be one missing field away from
 * that, so the absence is refused here rather than discovered later.
 */
function model3dArgs(scriptPath, { id, rig = false, overwrite = false } = {}) {
    if (typeof id !== 'string' || !id) {
        throw new Error('model3dArgs needs an NPC id - without one generate-3d.py rebuilds the whole manifest');
    }
    const args = [scriptPath, '--id', id];
    if (rig) args.push('--rig');
    if (overwrite) args.push('--overwrite');
    return args;
}

const TURNAROUND_INFIX = ' Turnaround_';

/**
 * A `3d/` directory listing -> the deliverables belonging to one NPC.
 *
 * Matched by exact name against the NPC's own, for two reasons. A folder can
 * hold more than one set (generate-3d.py names its output from the manifest
 * entry, and an entry can be renamed or a folder reused), and names arrive
 * from the manifest verbatim - quotes, dots and plus signs included - so
 * anything pattern-based would need escaping to avoid matching the wrong
 * file. Plain equality needs none.
 *
 * The intermediates the generator deliberately leaves behind - `_shell.glb`,
 * `_base.glb`, `apose.png`, `apose_square.png` - are excluded by having no
 * name that can match. They are worth keeping on disk and are not worth
 * offering in a panel: `_base.glb` is a 17 MB raw reconstruction that looks
 * like a finished model and is not one.
 */
function classify3dFiles(names, npcName) {
    const list = Array.isArray(names) ? names : [];
    const has = (file) => (list.includes(file) ? file : null);

    const turnarounds = list
        .filter((file) => file.startsWith(npcName + TURNAROUND_INFIX) && file.endsWith('.png'))
        .map((file) => ({
            file,
            // The angle, so 000/090/180/270 come back in orbit order whatever
            // order readdirSync handed them over in.
            angle: Number(file.slice((npcName + TURNAROUND_INFIX).length, -'.png'.length)),
        }))
        .filter(({ angle }) => Number.isInteger(angle))
        .sort((a, b) => a.angle - b.angle)
        .map(({ file }) => file);

    return {
        shell: has(`${npcName} Shell.glb`),
        print: has(`${npcName} Print.stl`),
        rigged: has(`${npcName} Rigged.glb`),
        turnarounds,
    };
}

module.exports = { model3dArgs, classify3dFiles };
