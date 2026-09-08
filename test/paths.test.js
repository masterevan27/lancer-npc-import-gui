const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { derivePaths } = require('../lib/paths');

const REPO = path.join('G:', 'GIT-REPOS', 'lancer-art-generator');

test('derives every generator path from npcManifestPath alone', () => {
    const p = derivePaths({ npcManifestPath: path.join(REPO, '.generated-npcs.json') });
    assert.strictEqual(p.generateNpcScript, path.join(REPO, 'generate-npc.py'));
    assert.strictEqual(p.npcTablesPath, path.join(REPO, 'prompts', 'npc-generator-tables.md'));
    assert.strictEqual(p.stagedImportsDir, path.join(REPO, 'prompts', 'staged-imports'));
    assert.strictEqual(p.stagedRefsDir, path.join(REPO, 'prompts', 'staged-imports', 'refs'));
    assert.strictEqual(p.presetsDir, path.join(REPO, 'prompts', 'presets'));
    assert.strictEqual(p.createPresetsDir, path.join(REPO, 'prompts', 'presets', 'create'));
});

test('an explicit config key overrides the derived value', () => {
    const p = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        npcTablesPath: path.join('D:', 'elsewhere', 'tables.md'),
    });
    assert.strictEqual(p.npcTablesPath, path.join('D:', 'elsewhere', 'tables.md'));
    // staged-imports and presets follow the override, not the default layout
    assert.strictEqual(p.stagedImportsDir, path.join('D:', 'elsewhere', 'staged-imports'));
    assert.strictEqual(p.stagedRefsDir, path.join('D:', 'elsewhere', 'staged-imports', 'refs'));
    assert.strictEqual(p.presetsDir, path.join('D:', 'elsewhere', 'presets'));
    assert.strictEqual(p.createPresetsDir, path.join('D:', 'elsewhere', 'presets', 'create'));
});

test('createPresetsDir follows presetsDir, and can be moved on its own', () => {
    // The failure this pins: a GM points presetsDir at a synced drive so their
    // table presets travel between machines, and their Create-form presets
    // keep being written into the generator repo because the second path was
    // recomputed from npcTablesPath instead of following the first.
    const moved = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        presetsDir: path.join('D:', 'synced', 'presets'),
    });
    assert.strictEqual(moved.createPresetsDir, path.join('D:', 'synced', 'presets', 'create'));

    const split = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        createPresetsDir: path.join('E:', 'create-presets'),
    });
    assert.strictEqual(split.createPresetsDir, path.join('E:', 'create-presets'));
    assert.strictEqual(split.presetsDir, path.join(REPO, 'prompts', 'presets'));
});

test('stagedRefsDir follows stagedImportsDir, and can be moved on its own', () => {
    const moved = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        stagedImportsDir: path.join('D:', 'staging'),
    });
    assert.strictEqual(moved.stagedRefsDir, path.join('D:', 'staging', 'refs'));

    // Its own key wins, for the one case the derived layout cannot serve:
    // reference images are the only thing here big enough to want a different
    // disk from the JSON that names them.
    const split = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        stagedRefsDir: path.join('E:', 'reference-images'),
    });
    assert.strictEqual(split.stagedRefsDir, path.join('E:', 'reference-images'));
    assert.strictEqual(split.stagedImportsDir, path.join(REPO, 'prompts', 'staged-imports'));
});

test('an explicit generateNpcScript relocates the whole chain', () => {
    const p = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        generateNpcScript: path.join('D:', 'tools', 'generate-npc.py'),
    });
    assert.strictEqual(p.npcTablesPath,
        path.join('D:', 'tools', 'prompts', 'npc-generator-tables.md'));
});

test('derives generate-3d.py beside generate-npc.py', () => {
    const p = derivePaths({ npcManifestPath: path.join(REPO, '.generated-npcs.json') });
    assert.strictEqual(p.generate3dScript, path.join(REPO, 'generate-3d.py'));
});

test('generate3dScript follows a relocated generateNpcScript, and its own key wins', () => {
    // The two scripts live side by side in the generator repo, so moving the
    // generator moves this one too - the same rule npcTablesPath follows.
    const moved = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        generateNpcScript: path.join('D:', 'tools', 'generate-npc.py'),
    });
    assert.strictEqual(moved.generate3dScript, path.join('D:', 'tools', 'generate-3d.py'));

    const split = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        generate3dScript: path.join('E:', 'rebuild', 'generate-3d.py'),
    });
    assert.strictEqual(split.generate3dScript, path.join('E:', 'rebuild', 'generate-3d.py'));
    assert.strictEqual(split.generateNpcScript, path.join(REPO, 'generate-npc.py'));
});

const BASE = { npcManifestPath: path.join('G:', 'gen', '.generated-npcs.json') };

test('the seven existing keys are unchanged by the ship additions', () => {
    const p = derivePaths(BASE);
    assert.equal(p.generateNpcScript, path.join('G:', 'gen', 'generate-npc.py'));
    assert.equal(p.npcTablesPath,
        path.join('G:', 'gen', 'prompts', 'npc-generator-tables.md'));
    assert.equal(p.presetsDir, path.join('G:', 'gen', 'prompts', 'presets'));
    assert.equal(p.createPresetsDir,
        path.join('G:', 'gen', 'prompts', 'presets', 'create'));
});

test('generateSpaceshipScript sits beside the manifest by default', () => {
    assert.equal(derivePaths(BASE).generateSpaceshipScript,
        path.join('G:', 'gen', 'generate-spaceship.py'));
});

test('spaceshipTablesPath is the ship tables file, beside the SHIP script', () => {
    // Not scene-and-spaceship-tables.md: that file exists but every one of its
    // 41 bullets is hard-wrapped, and parse_tables truncates a wrapped bullet
    // at its first physical line. The generator's own DEFAULT_TABLES names
    // spaceship-generator-tables.md.
    const p = derivePaths({ ...BASE,
        generateSpaceshipScript: path.join('D:', 'elsewhere', 'generate-spaceship.py') });
    assert.equal(p.spaceshipTablesPath,
        path.join('D:', 'elsewhere', 'prompts', 'spaceship-generator-tables.md'));
});

test('ship presets live under presetsDir and follow an override of it', () => {
    const p = derivePaths({ ...BASE, presetsDir: path.join('S:', 'synced') });
    assert.equal(p.spaceshipPresetsDir, path.join('S:', 'synced', 'spaceship'));
    assert.equal(p.spaceshipCreatePresetsDir,
        path.join('S:', 'synced', 'spaceship', 'create'));
});

test('the ship staged-imports dir is a SIBLING of the NPC one, not a child', () => {
    // listStagedFiles reads *.json at the top level of its dir, so a child
    // would be invisible to it - and both tables files carry a "## Backdrop",
    // so a candidate bullet's table name only means something paired with a file.
    const p = derivePaths(BASE);
    assert.notEqual(p.spaceshipStagedImportsDir, p.stagedImportsDir);
    assert.equal(path.dirname(p.spaceshipStagedImportsDir),
        path.dirname(p.stagedImportsDir));
    assert.equal(p.spaceshipStagedRefsDir,
        path.join(p.spaceshipStagedImportsDir, 'refs'));
});

test('derives animate-portrait.py beside generate-npc.py, and its own key wins', () => {
    const p = derivePaths({ npcManifestPath: path.join(REPO, '.generated-npcs.json') });
    assert.strictEqual(p.animatePortraitScript, path.join(REPO, 'animate-portrait.py'));

    const moved = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        generateNpcScript: path.join('D:', 'tools', 'generate-npc.py'),
    });
    assert.strictEqual(moved.animatePortraitScript, path.join('D:', 'tools', 'animate-portrait.py'));

    const split = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        animatePortraitScript: path.join('E:', 'wan', 'animate-portrait.py'),
    });
    assert.strictEqual(split.animatePortraitScript, path.join('E:', 'wan', 'animate-portrait.py'));
    assert.strictEqual(split.generateNpcScript, path.join(REPO, 'generate-npc.py'));
});
