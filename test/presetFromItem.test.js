const test = require('node:test');
const assert = require('node:assert/strict');
const { settingsFromItem, IDENTITY_TABLES } = require('../lib/presetFromItem');
const { normaliseSettings } = require('../lib/createPresets');

const TABLES = ['Given names', 'Family names', 'Callsigns', 'Theme', 'Role', 'Outfit', 'Gear'];

function vela(extra) {
    return {
        id: 'npc-Vela-1',
        kind: 'npc',
        name: 'Vela Ostrom',
        seed: 12345,
        traits: {
            'Given names': 'Vela',
            'Family names': 'Ostrom',
            Callsigns: 'Wren',
            Pronouns: 'she/her/her/woman',
            Theme: 'rust and neon',
            Role: 'a field medic',
            Outfit: 'a heavy work jacket',
        },
        rawTraits: {
            Pronouns: 'she/her/her/woman',
            Theme: 'rust and neon @theme',
            Role: 'a field medic || mil',
            Outfit: 'a heavy work jacket || civ notac',
        },
        ...(extra || {}),
    };
}

const OPTIONS = {
    Role: [{ value: 'a field medic || mil' }, { value: 'a pilot || mil' }],
    Outfit: [{ value: 'a heavy work jacket || civ notac' }],
};

test('an NPC becomes a one-NPC recipe with its traits pinned in table order', () => {
    const settings = settingsFromItem(vela(), { tables: TABLES, options: OPTIONS });
    assert.deepEqual(settings, {
        count: 1,
        seed: 12345,
        pronouns: 'she',
        server: '',
        portrait: true,
        token: true,
        keepRawToken: false,
        unarmed: false,
        overrides: [
            { table: 'Theme', value: 'rust and neon @theme', custom: true },
            { table: 'Role', value: 'a field medic || mil', custom: false },
            { table: 'Outfit', value: 'a heavy work jacket || civ notac', custom: false },
        ],
    });
});

test('the result is exactly what normaliseSettings accepts, unchanged', () => {
    const settings = settingsFromItem(vela(), { tables: TABLES, options: OPTIONS });
    const result = normaliseSettings(settings);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.settings, settings);
});

test('the raw bullet is preferred, because --set-trait wants the flags', () => {
    const settings = settingsFromItem(vela(), { tables: TABLES, options: OPTIONS });
    const role = settings.overrides.find((o) => o.table === 'Role');
    assert.equal(role.value, 'a field medic || mil');
});

test('a trait with no raw bullet falls back to the stripped value', () => {
    const item = vela({ rawTraits: { Pronouns: 'she/her/her/woman', Role: 'a field medic || mil' } });
    const settings = settingsFromItem(item, { tables: TABLES, options: OPTIONS });
    const outfit = settings.overrides.find((o) => o.table === 'Outfit');
    assert.equal(outfit.value, 'a heavy work jacket');
    // Not in the current tables file's options verbatim, so the form reopens
    // it as free text rather than a dropdown that cannot show it.
    assert.equal(outfit.custom, true);
});

test('an entry without rawTraits - or with an empty one - uses its traits throughout', () => {
    for (const rawTraits of [undefined, {}]) {
        const settings = settingsFromItem(vela({ rawTraits }), { tables: TABLES, options: OPTIONS });
        assert.deepEqual(settings.overrides.map((o) => o.value),
            ['rust and neon', 'a field medic', 'a heavy work jacket']);
    }
});

test('the name halves, the callsign and Pronouns are never overrides', () => {
    assert.deepEqual(IDENTITY_TABLES, ['Given names', 'Family names', 'Callsigns']);
    const settings = settingsFromItem(vela(), { tables: [...TABLES, 'Pronouns'], options: OPTIONS });
    const tables = settings.overrides.map((o) => o.table);
    assert.ok(!tables.includes('Given names'));
    assert.ok(!tables.includes('Family names'));
    assert.ok(!tables.includes('Callsigns'));
    assert.ok(!tables.includes('Pronouns'));
});

test('a trait the generator no longer has a table for is dropped', () => {
    const item = vela({ traits: { ...vela().traits, Accent: 'clipped', name: 'Vela Ostrom' } });
    const settings = settingsFromItem(item, { tables: TABLES, options: OPTIONS });
    assert.ok(!settings.overrides.some((o) => o.table === 'Accent' || o.table === 'name'));
});

test('a table the NPC never rolled is simply absent', () => {
    const settings = settingsFromItem(vela(), { tables: TABLES, options: OPTIONS });
    assert.ok(!settings.overrides.some((o) => o.table === 'Gear'));
});

test('an entry with no seed, no pronouns and no traits is still a valid recipe', () => {
    const settings = settingsFromItem({ id: 'x', kind: 'npc', name: 'Blank' }, { tables: TABLES });
    assert.equal(settings.seed, null);
    assert.equal(settings.pronouns, '');
    assert.deepEqual(settings.overrides, []);
    assert.equal(normaliseSettings(settings).ok, true);
});

test('a non-integer or negative seed is not carried', () => {
    assert.equal(settingsFromItem(vela({ seed: 12.5 }), { tables: TABLES }).seed, null);
    assert.equal(settingsFromItem(vela({ seed: -1 }), { tables: TABLES }).seed, null);
    assert.equal(settingsFromItem(vela({ seed: '7' }), { tables: TABLES }).seed, null);
});

test('a blank or whitespace trait value is not pinned', () => {
    const item = vela({ traits: { ...vela().traits, Gear: '   ' }, rawTraits: undefined });
    const settings = settingsFromItem(item, { tables: TABLES });
    assert.ok(!settings.overrides.some((o) => o.table === 'Gear'));
});

test('a ship carries neither pronouns nor unarmed, and passes the ship schema', () => {
    const ship = {
        id: 'ship-1', kind: 'spaceship', name: 'Kestrel', seed: 9,
        traits: { 'Ship type': 'corvette', Size: 'small', Theme: 'salvage' },
    };
    const settings = settingsFromItem(ship, { tables: ['Ship type', 'Size', 'Theme'], ship: true });
    assert.ok(!('pronouns' in settings));
    assert.ok(!('unarmed' in settings));
    assert.deepEqual(settings.overrides.map((o) => o.table), ['Ship type', 'Size', 'Theme']);
    const result = normaliseSettings(settings, { ship: true });
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.settings, settings);
});
