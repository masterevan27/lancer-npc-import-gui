const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const settings = require('../lib/settings');

const DEFAULTS = {
    port: 5089, host: '127.0.0.1', secret: '', npcManifestPath: '', manifestPath: '',
    foundryDataRoot: '', pythonExecutable: 'python', foundryNpcSubdir: 'LancerNPCs',
    traitOddsSamples: 20000,
};

test('every field key is unique', () => {
    const keys = settings.SETTINGS_FIELDS.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length);
});

test('every key in config.example.json is editable, apart from the manifest alias', () => {
    const example = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.example.json'), 'utf8'));
    const keys = new Set(settings.SETTINGS_FIELDS.map((f) => f.key));
    const missing = Object.keys(example).filter((k) => k !== 'manifestPath' && !keys.has(k));
    assert.deepEqual(missing, [], 'a config key with no Settings field cannot be changed from the GUI');
});

test('the view never carries the secret, only whether one is set', () => {
    const view = settings.settingsView({ secret: 'hunter2', npcManifestPath: 'M' }, DEFAULTS, {});
    assert.equal(view.secretSet, true);
    assert.ok(!JSON.stringify(view).includes('hunter2'));
});

test('blank path fields show the path lib/paths.js derives', () => {
    const manifest = path.join('gen', '.generated-npcs.json');
    const view = settings.settingsView({ npcManifestPath: manifest }, DEFAULTS, {});
    assert.equal(view.values.npcTablesPath, '');
    assert.equal(view.placeholders.npcTablesPath, path.join('gen', 'prompts', 'npc-generator-tables.md'));
    assert.equal(view.placeholders.foundryNpcSubdir, 'LancerNPCs');
});

test('the view reports environment overrides', () => {
    const view = settings.settingsView({}, DEFAULTS, { IMPORT_GUI_PORT: '6000' });
    assert.deepEqual(view.envOverrides, { port: 'IMPORT_GUI_PORT' });
});

test('saving merges into the file, keeps unknown keys, and drops blanked fields', () => {
    const file = { npcManifestPath: 'M', foundryDataRoot: 'F', presetsDir: 'P', handKept: 1 };
    const { next, errors } = settings.applySettings(file, {
        values: { presetsDir: '  ', port: '6001', host: ' 0.0.0.0 ' },
    });
    assert.equal(errors, undefined);
    assert.deepEqual(next, { npcManifestPath: 'M', foundryDataRoot: 'F', handKept: 1, port: 6001, host: '0.0.0.0' });
});

test('the manifest field writes back to whichever name the file uses', () => {
    const { next } = settings.applySettings({ manifestPath: 'old' }, { values: { npcManifestPath: 'new' } });
    assert.deepEqual(next, { manifestPath: 'new' });
    const view = settings.settingsView({ manifestPath: 'old', npcManifestPath: 'older' }, DEFAULTS, {});
    assert.equal(view.values.npcManifestPath, 'old');
});

test('invalid values are refused per field', () => {
    const { errors, next } = settings.applySettings({}, {
        values: { npcManifestPath: '', port: '70000', traitOddsSamples: '12.5', host: 'a\nb' },
    });
    assert.equal(next, undefined);
    assert.deepEqual(Object.keys(errors).sort(), ['host', 'npcManifestPath', 'port', 'traitOddsSamples']);
});

test('the secret is kept unless replaced, and "" removes it', () => {
    assert.equal(settings.applySettings({ secret: 's' }, { values: {} }).next.secret, 's');
    assert.equal(settings.applySettings({ secret: 's' }, { values: {}, secret: 't' }).next.secret, 't');
    assert.ok(!('secret' in settings.applySettings({ secret: 's' }, { values: {}, secret: '' }).next));
});

test('writeConfigFile keeps a backup of the previous file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-write-'));
    try {
        const file = path.join(dir, 'config.json');
        fs.writeFileSync(file, '{"a":1}');
        settings.writeConfigFile(file, { a: 2 });
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 2 });
        assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), { a: 1 });
        assert.deepEqual(fs.readdirSync(dir).sort(), ['config.json', 'config.json.bak']);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('only loopback, or a caller with the secret, may save', () => {
    const allowed = settings.settingsWriteAllowed;
    assert.equal(allowed({ remoteAddress: '127.0.0.1', secret: '' }), true);
    assert.equal(allowed({ remoteAddress: '::1', secret: '' }), true);
    assert.equal(allowed({ remoteAddress: '::ffff:127.0.0.1', secret: '' }), true);
    assert.equal(allowed({ remoteAddress: '192.168.1.20', secret: '' }), false);
    assert.equal(allowed({ remoteAddress: '192.168.1.20', secret: '', providedKey: '' }), false);
    assert.equal(allowed({ remoteAddress: '192.168.1.20', secret: 'k', providedKey: 'x' }), false);
    assert.equal(allowed({ remoteAddress: '192.168.1.20', secret: 'k', providedKey: 'k' }), true);
});
