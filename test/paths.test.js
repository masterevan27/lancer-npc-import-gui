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
    assert.strictEqual(p.presetsDir, path.join(REPO, 'prompts', 'presets'));
});

test('an explicit config key overrides the derived value', () => {
    const p = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        npcTablesPath: path.join('D:', 'elsewhere', 'tables.md'),
    });
    assert.strictEqual(p.npcTablesPath, path.join('D:', 'elsewhere', 'tables.md'));
    // staged-imports and presets follow the override, not the default layout
    assert.strictEqual(p.stagedImportsDir, path.join('D:', 'elsewhere', 'staged-imports'));
    assert.strictEqual(p.presetsDir, path.join('D:', 'elsewhere', 'presets'));
});

test('an explicit generateNpcScript relocates the whole chain', () => {
    const p = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        generateNpcScript: path.join('D:', 'tools', 'generate-npc.py'),
    });
    assert.strictEqual(p.npcTablesPath,
        path.join('D:', 'tools', 'prompts', 'npc-generator-tables.md'));
});
