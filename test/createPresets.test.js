const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    slugify, normaliseSettings, validatePresetFile,
    listCreatePresets, createPresetExists, readCreatePreset, writeCreatePreset, deleteCreatePreset,
} = require('../lib/createPresets');

function withTempPresetsDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-presets-test-'));
    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function samplePreset(over) {
    return {
        name: 'Frontier medics',
        created: '2026-09-06T21:00:00.000Z',
        kind: 'create-form',
        settings: {
            count: 1,
            seed: null,
            pronouns: 'she',
            server: '',
            portrait: true,
            token: true,
            keepRawToken: false,
            unarmed: false,
            overrides: [{ table: 'Role', value: 'a field medic || mil', custom: false }],
            ...(over || {}),
        },
    };
}

test('slugify is the same function the Tables presets use', () => {
    assert.equal(slugify('  Frontier Medics!  '), 'frontier-medics');
    assert.equal(slugify(require('../lib/presets').slugify('Zero-G salvage crew')), 'zero-g-salvage-crew');
});

test('writeCreatePreset then readCreatePreset round-trips the same data', () => {
    withTempPresetsDir((dir) => {
        const preset = samplePreset();
        writeCreatePreset(dir, 'frontier-medics', preset);
        assert.deepEqual(readCreatePreset(dir, 'frontier-medics'), preset);
    });
});

test('writeCreatePreset stamps kind when the caller left it off', () => {
    withTempPresetsDir((dir) => {
        const preset = samplePreset();
        delete preset.kind;
        writeCreatePreset(dir, 'x', preset);
        assert.equal(readCreatePreset(dir, 'x').kind, 'create-form');
    });
});

test('createPresetExists is false before writing and true after, and delete reverses it', () => {
    withTempPresetsDir((dir) => {
        assert.equal(createPresetExists(dir, 'x'), false);
        writeCreatePreset(dir, 'x', samplePreset());
        assert.equal(createPresetExists(dir, 'x'), true);
        assert.equal(deleteCreatePreset(dir, 'x'), true);
        assert.equal(createPresetExists(dir, 'x'), false);
        assert.equal(deleteCreatePreset(dir, 'x'), false);
    });
});

test('readCreatePreset returns null for an unknown slug', () => {
    withTempPresetsDir((dir) => {
        assert.equal(readCreatePreset(dir, 'nope'), null);
    });
});

test('listCreatePresets returns an empty array when the directory does not exist yet', () => {
    assert.deepEqual(listCreatePresets(path.join(os.tmpdir(), 'create-presets-absent-dir-xyz')), []);
});

test('listCreatePresets sorts newest-created first and counts overrides', () => {
    withTempPresetsDir((dir) => {
        const older = samplePreset();
        older.name = 'Older';
        older.created = '2026-01-01T00:00:00.000Z';
        const newer = samplePreset({
            overrides: [
                { table: 'Role', value: 'a field medic', custom: false },
                { table: 'Faction', value: 'a salvage co-op', custom: true },
            ],
        });
        newer.name = 'Newer';
        newer.created = '2026-06-01T00:00:00.000Z';
        writeCreatePreset(dir, 'older', older);
        writeCreatePreset(dir, 'newer', newer);

        const list = listCreatePresets(dir);
        assert.equal(list.length, 2);
        assert.deepEqual(list[0], {
            name: 'Newer', slug: 'newer', created: '2026-06-01T00:00:00.000Z', overrideCount: 2,
        });
        assert.equal(list[1].slug, 'older');
        assert.equal(list[1].overrideCount, 1);
    });
});

test('listCreatePresets skips one unparseable file instead of throwing away the good ones', () => {
    withTempPresetsDir((dir) => {
        writeCreatePreset(dir, 'good', samplePreset());
        fs.writeFileSync(path.join(dir, 'broken.json'), '{ "name": "half a save"');
        const list = listCreatePresets(dir);
        assert.equal(list.length, 1);
        assert.equal(list[0].slug, 'good');
    });
});

test('normaliseSettings fills every default for an empty object', () => {
    const result = normaliseSettings({});
    assert.equal(result.ok, true);
    assert.deepEqual(result.settings, {
        count: 1, seed: null, pronouns: '', server: '',
        portrait: true, token: true, keepRawToken: false, unarmed: false, overrides: [],
    });
});

test('normaliseSettings coerces each field to its own type', () => {
    const result = normaliseSettings({
        count: '3', seed: '99', pronouns: '  she  ', server: ' http://gpu:7860 ',
        portrait: 'false', token: true, keepRawToken: 'true', unarmed: false,
        overrides: [{ table: ' Role ', value: ' a field medic || mil ', custom: 'true' }],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.settings, {
        count: 3, seed: 99, pronouns: 'she', server: 'http://gpu:7860',
        portrait: false, token: true, keepRawToken: true, unarmed: false,
        overrides: [{ table: 'Role', value: 'a field medic || mil', custom: true }],
    });
});

test('normaliseSettings clamps count to 1..100 rather than passing it to the generator', () => {
    assert.equal(normaliseSettings({ count: 0 }).settings.count, 1);
    assert.equal(normaliseSettings({ count: -7 }).settings.count, 1);
    assert.equal(normaliseSettings({ count: 5000 }).settings.count, 100);
    assert.equal(normaliseSettings({ count: 4.9 }).settings.count, 4);
});

test('normaliseSettings rejects values it cannot coerce, naming the field', () => {
    for (const [raw, field] of [
        [{ count: 'lots' }, 'count'],
        [{ count: [] }, 'count'],
        [{ seed: 'abc' }, 'seed'],
        [{ seed: 1.5 }, 'seed'],
        [{ pronouns: {} }, 'pronouns'],
        [{ server: 42 }, 'server'],
        [{ portrait: 'maybe' }, 'portrait'],
        [{ token: 3 }, 'token'],
        [{ keepRawToken: {} }, 'keepRawToken'],
        [{ unarmed: [] }, 'unarmed'],
    ]) {
        const result = normaliseSettings(raw);
        assert.equal(result.ok, false, `${field} should have been refused`);
        assert.match(result.error, new RegExp(field));
    }
    assert.equal(normaliseSettings(null).ok, false);
    assert.equal(normaliseSettings([]).ok, false);
});

test('normaliseSettings rejects a non-array overrides', () => {
    const result = normaliseSettings({ overrides: { Role: 'a field medic' } });
    assert.equal(result.ok, false);
    assert.match(result.error, /overrides must be an array/);
});

test('normaliseSettings drops malformed override entries but keeps the good ones', () => {
    const result = normaliseSettings({
        overrides: [
            { table: 'Role', value: 'a field medic', custom: false },
            null,
            'Role=a field medic',
            { table: 'Role' },
            { table: 'Role', value: '   ' },
            { value: 'orphaned' },
            { table: 'Faction', value: 'a salvage co-op', custom: 'nonsense' },
        ],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.settings.overrides, [
        { table: 'Role', value: 'a field medic', custom: false },
        { table: 'Faction', value: 'a salvage co-op', custom: false },
    ]);
});

test('normaliseSettings drops unknown keys instead of passing them through', () => {
    const result = normaliseSettings({ count: 1, name: 'Sgt. Vance', dryRun: true, hax: '; rm -rf /' });
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.settings).sort(), [
        'count', 'keepRawToken', 'overrides', 'portrait', 'pronouns', 'seed', 'server', 'token', 'unarmed',
    ]);
    assert.equal('name' in result.settings, false);
});

test('validatePresetFile accepts a good preset as an object or as file text', () => {
    const preset = samplePreset();
    const fromObject = validatePresetFile(preset);
    assert.equal(fromObject.ok, true);
    assert.deepEqual(fromObject.preset, preset);
    assert.deepEqual(validatePresetFile(JSON.stringify(preset)).preset, preset);
});

test('validatePresetFile refuses a Tables preset and says which is which', () => {
    const tablesPreset = {
        name: 'Grittier Frontier',
        created: '2026-09-01T00:00:00.000Z',
        selected: { Outfit: [{ text: 'a jacket', weight: 1 }] },
    };
    const result = validatePresetFile(tablesPreset);
    assert.equal(result.ok, false);
    assert.match(result.error, /Tables preset/);
    assert.match(result.error, /Create NPC preset/);

    const tagged = validatePresetFile({ ...tablesPreset, kind: 'tables' });
    assert.equal(tagged.ok, false);
    assert.match(tagged.error, /"tables"/);
});

test('validatePresetFile refuses junk, unnamed presets and bad settings', () => {
    assert.match(validatePresetFile('{ not json').error, /not valid JSON/);
    assert.match(validatePresetFile([]).error, /JSON object/);
    assert.match(validatePresetFile({ name: 'x', created: 'now' }).error, /no "settings"/);
    assert.match(validatePresetFile({ name: '  ', settings: {} }).error, /name is missing/);
    assert.match(validatePresetFile({ name: 'x', settings: { count: 'lots' } }).error, /count/);
});

test('validatePresetFile stamps a created date when the file has none', () => {
    const preset = samplePreset();
    delete preset.created;
    const result = validatePresetFile(preset);
    assert.equal(result.ok, true);
    assert.equal(Number.isNaN(Date.parse(result.preset.created)), false);
});
