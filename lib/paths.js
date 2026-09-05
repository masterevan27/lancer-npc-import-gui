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

    const npcTablesPath = config.npcTablesPath
        || path.join(path.dirname(generateNpcScript), 'prompts', 'npc-generator-tables.md');

    const stagedImportsDir = config.stagedImportsDir
        || path.join(path.dirname(npcTablesPath), 'staged-imports');

    const presetsDir = config.presetsDir
        || path.join(path.dirname(npcTablesPath), 'presets');

    // Where npc-trait-import copies the reference image each staged candidate
    // was read from, one subfolder per run. Inside staged-imports rather than
    // beside it, so a run and its images are one thing to find, move or delete
    // - and safely, because listStagedFiles() only ever picks up *.json, which
    // makes a sibling directory there invisible to it the way examples/ is.
    const stagedRefsDir = config.stagedRefsDir
        || path.join(stagedImportsDir, 'refs');

    return {
        generateNpcScript, generate3dScript, npcTablesPath,
        stagedImportsDir, stagedRefsDir, presetsDir,
    };
}

module.exports = { derivePaths };
