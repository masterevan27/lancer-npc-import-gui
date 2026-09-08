/**
 * Derives the generator-relative paths the GUI reads, from npcManifestPath.
 *
 * generate-npc.py's own DEFAULT_MANIFEST sits beside the script, so the
 * manifest's directory is the generator repo root. Since the art generator
 * was split out of the GM Hub its layout is flat: the script at the root,
 * its prompt tables under prompts/, and the staging and preset folders
 * alongside those tables. Any key set in config.json wins over the value
 * derived here, and later paths follow the override rather than the
 * default layout.
 *
 * The two preset flavours share one presets/ root, with the Create NPC ones
 * in a subfolder of it. They are different file shapes that a user will drop
 * on the wrong tab's Import button, so they cannot live in the same folder -
 * but giving the second flavour its own top-level directory beside the tables
 * file would mean a GM who moved or backed up presets/ silently left half
 * their presets behind. One folder to move, one folder to sync, two
 * subfolders inside it.
 */

const path = require('node:path');

function derivePaths(config) {
    const generateNpcScript = config.generateNpcScript
        || path.join(path.dirname(config.npcManifestPath), 'generate-npc.py');

    // generate-3d.py sits beside generate-npc.py in the generator repo, so it
    // follows a relocated generateNpcScript rather than the manifest - moving
    // the generator moves both scripts together.
    const generate3dScript = config.generate3dScript
        || path.join(path.dirname(generateNpcScript), 'generate-3d.py');

    // animate-portrait.py sits beside the other two and follows them for the
    // same reason.
    const animatePortraitScript = config.animatePortraitScript
        || path.join(path.dirname(generateNpcScript), 'animate-portrait.py');

    const npcTablesPath = config.npcTablesPath
        || path.join(path.dirname(generateNpcScript), 'prompts', 'npc-generator-tables.md');

    const stagedImportsDir = config.stagedImportsDir
        || path.join(path.dirname(npcTablesPath), 'staged-imports');

    const presetsDir = config.presetsDir
        || path.join(path.dirname(npcTablesPath), 'presets');

    // Create NPC form presets, under presetsDir rather than beside it so a
    // relocated presetsDir carries them along - the rule this whole file
    // follows. Deriving it from npcTablesPath instead would have left a GM who
    // pointed presetsDir at a synced drive with their Create presets still
    // being written into the generator repo, which is precisely the split this
    // subfolder exists to avoid.
    const createPresetsDir = config.createPresetsDir
        || path.join(presetsDir, 'create');

    // Where npc-trait-import copies the reference image each staged candidate
    // was read from, one subfolder per run. Inside staged-imports rather than
    // beside it, so a run and its images are one thing to find, move or delete
    // - and safely, because listStagedFiles() only ever picks up *.json, which
    // makes a sibling directory there invisible to it the way examples/ is.
    const stagedRefsDir = config.stagedRefsDir
        || path.join(stagedImportsDir, 'refs');

    // The ship generator sits beside generate-npc.py, and its tables follow it
    // rather than the manifest - the same "later paths follow the override"
    // rule the rest of this file obeys.
    const generateSpaceshipScript = config.generateSpaceshipScript
        || path.join(path.dirname(generateNpcScript), 'generate-spaceship.py');

    // spaceship-generator-tables.md, not scene-and-spaceship-tables.md. The
    // second file exists and was mined for vocabulary, but it has never been
    // parseable: all 41 of its bullets are hard-wrapped at ~72 columns and
    // parse_tables' bullet regex silently truncates each at its first physical
    // line, losing the whole flag segment.
    const spaceshipTablesPath = config.spaceshipTablesPath
        || path.join(path.dirname(generateSpaceshipScript), 'prompts',
                     'spaceship-generator-tables.md');

    // Under presetsDir, for the reason createPresetsDir is: one folder to move,
    // one to sync. listPresets filters on .endsWith('.json'), so a subdirectory
    // is invisible to the NPC listing.
    const spaceshipPresetsDir = config.spaceshipPresetsDir
        || path.join(presetsDir, 'spaceship');
    const spaceshipCreatePresetsDir = config.spaceshipCreatePresetsDir
        || path.join(spaceshipPresetsDir, 'create');

    // A SIBLING of stagedImportsDir, not a child: listStagedFiles reads *.json
    // at the top level of its own directory and would never see a child, and
    // both tables files carry a '## Backdrop', so a staged candidate's table
    // name is only meaningful paired with the file it came from.
    const spaceshipStagedImportsDir = config.spaceshipStagedImportsDir
        || path.join(path.dirname(spaceshipTablesPath), 'staged-imports-spaceship');
    const spaceshipStagedRefsDir = config.spaceshipStagedRefsDir
        || path.join(spaceshipStagedImportsDir, 'refs');

    return {
        generateNpcScript, generate3dScript, animatePortraitScript, npcTablesPath,
        stagedImportsDir, stagedRefsDir, presetsDir, createPresetsDir,
        generateSpaceshipScript, spaceshipTablesPath,
        spaceshipPresetsDir, spaceshipCreatePresetsDir,
        spaceshipStagedImportsDir, spaceshipStagedRefsDir,
    };
}

module.exports = { derivePaths };
