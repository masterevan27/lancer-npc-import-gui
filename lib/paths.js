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

    const npcTablesPath = config.npcTablesPath
        || path.join(path.dirname(generateNpcScript), 'prompts', 'npc-generator-tables.md');

    const stagedImportsDir = config.stagedImportsDir
        || path.join(path.dirname(npcTablesPath), 'staged-imports');

    const presetsDir = config.presetsDir
        || path.join(path.dirname(npcTablesPath), 'presets');

    return { generateNpcScript, npcTablesPath, stagedImportsDir, presetsDir };
}

module.exports = { derivePaths };
