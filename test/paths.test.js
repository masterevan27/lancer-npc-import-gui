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
