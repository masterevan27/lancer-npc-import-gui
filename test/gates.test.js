const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    gatesPathFor, defaultGatesFrom, readGates, validateGates, writeGates, GATE_TABLES,
} = require('../lib/gates');

// A verbatim-shaped excerpt of generate-npc.py's five gate maps, with the
// comment volume the real ones carry, so the parser has to skip prose that
// contains quoted names and colons.
const SOURCE = [
    'ROLE_CATEGORIES = {',
    '    "a mech pilot": "Pilots",',
    '    "a dockworker": "Laborers",',
    '    "a pirate": "Criminals",',
    '    "a colonial administrator": "Officials",',
    '}',
    'UNCATEGORIZED_ROLE = "Other"',
    '',
    '# Gear bullets that belong to one occupation and no other. "a walking stick"',
    '# on a dockworker: not the same object.',
    'ROLE_LOCKS = {',
    '    "admin": ("a colonial administrator",),',
    '    # A pirate\'s colours worn openly.',
    '    "outlaw": ("a pirate",',
    '               "a smuggler"),',
    '}',
    '',
    'UNAFFILIATED_ROLES = frozenset({',
    '    "a freelance salvager",',
    '})',
    '',
    'WEAPON_ROLES = {',
    '    "blade": ("a close-quarters blade specialist",),',
    '}',
    '',
    'BACKDROP_ROLES = {',
    '    # In the cockpit: "the image says they fly it".',
    '    "cockpit": ("Pilots",),',
    '    "mechwork": ("Pilots", "Technicians", "Laborers"),',
    '    "clergy": ("a scavenger-priest of a local machine cult",),',
    '}',
    '',
    'LEGACY_TRAIT_NAMES = {',
    '    "Accent": "Glow colour",',
    '}',
    '',
].join('\n');

const ROLES = ['a mech pilot', 'a dockworker', 'a pirate', 'a colonial administrator',
    'a smuggler', 'a freelance salvager', 'a close-quarters blade specialist',
    'a scavenger-priest of a local machine cult'];

test('gatesPathFor puts the sidecar beside the tables file, as the generator does', () => {
    assert.equal(gatesPathFor('/x/prompts/npc-generator-tables.md'),
        path.normalize('/x/prompts/npc-generator-tables.gates.json'));
});

test('defaultGatesFrom reads all five maps out of the Python source', () => {
    const gates = defaultGatesFrom(SOURCE);
    assert.deepEqual(gates.roleCategories, {
        'a mech pilot': 'Pilots', 'a dockworker': 'Laborers', 'a pirate': 'Criminals',
        'a colonial administrator': 'Officials',
    });
    assert.deepEqual(gates.roleLocks, {
        admin: ['a colonial administrator'], outlaw: ['a pirate', 'a smuggler'],
    });
    assert.deepEqual(gates.backdropRoles, {
        cockpit: ['Pilots'], mechwork: ['Pilots', 'Technicians', 'Laborers'],
        clergy: ['a scavenger-priest of a local machine cult'],
    });
    assert.deepEqual(gates.weaponRoles, { blade: ['a close-quarters blade specialist'] });
    assert.deepEqual(gates.unaffiliatedRoles, ['a freelance salvager']);
});

test('defaultGatesFrom ignores quoted names inside comments', () => {
    const gates = defaultGatesFrom(SOURCE);
    assert.ok(!('a walking stick' in gates.roleCategories));
    assert.ok(!Object.values(gates.roleLocks).flat().includes('a walking stick'));
    assert.ok(!Object.values(gates.backdropRoles).flat().includes('the image says they fly it'));
});

test('defaultGatesFrom returns null for a map it cannot find, not a guess', () => {
    const gates = defaultGatesFrom('TOKEN_LIMIT = 512\n');
    assert.equal(gates.roleLocks, null);
    assert.equal(gates.roleCategories, null);
    assert.equal(gates.unaffiliatedRoles, null);
});

test('readGates overlays the sidecar on the defaults, map by map', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-'));
    const tables = path.join(dir, 'npc-generator-tables.md');
    fs.writeFileSync(gatesPathFor(tables), JSON.stringify({ roleLocks: { badge: ['a pirate'] } }));
    const { gates, overridden } = readGates(tables, SOURCE);
    assert.deepEqual(gates.roleLocks, { badge: ['a pirate'] });
    assert.deepEqual(gates.backdropRoles.cockpit, ['Pilots'], 'a map the sidecar omits keeps its default');
    assert.deepEqual(overridden, ['roleLocks']);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('readGates with no sidecar is the defaults and nothing overridden', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-'));
    const { gates, overridden } = readGates(path.join(dir, 'npc-generator-tables.md'), SOURCE);
    assert.deepEqual(gates.roleLocks, defaultGatesFrom(SOURCE).roleLocks);
    assert.deepEqual(overridden, []);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('readGates reports a corrupt sidecar rather than throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-'));
    const tables = path.join(dir, 'npc-generator-tables.md');
    fs.writeFileSync(gatesPathFor(tables), '{nope');
    const { gates, error } = readGates(tables, SOURCE);
    assert.match(error, /gates\.json/);
    assert.deepEqual(gates.roleLocks, defaultGatesFrom(SOURCE).roleLocks);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('validateGates accepts buckets and exact Roles that exist', () => {
    const errors = validateGates({
        roleCategories: { 'a mech pilot': 'Pilots' },
        roleLocks: { admin: ['a colonial administrator', 'Officials'] },
        backdropRoles: { cockpit: ['Pilots'] },
        weaponRoles: { blade: ['a pirate'] },
        unaffiliatedRoles: ['a freelance salvager'],
    }, { roles: ROLES, buckets: ['Pilots', 'Officials', 'Criminals'] });
    assert.deepEqual(errors, []);
});

test('validateGates names a Role the table does not carry', () => {
    const errors = validateGates({
        roleLocks: { admin: ['a colonial administratr'] },
    }, { roles: ROLES, buckets: ['Pilots'] });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /a colonial administratr/);
    assert.match(errors[0], /roleLocks/);
});

test('validateGates names a bucket that no Role belongs to', () => {
    const errors = validateGates({
        backdropRoles: { cockpit: ['Pilotz'] },
    }, { roles: ROLES, buckets: ['Pilots'] });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Pilotz/);
});

test('validateGates refuses a flag name the tables file could not carry', () => {
    // Flags are whitespace-separated words after '||', so a space or a pipe
    // inside one would split or re-segment the bullet on write.
    for (const flag of ['two words', 'a|b', '', '@theme']) {
        const errors = validateGates({ roleLocks: { [flag]: ['a pirate'] } },
            { roles: ROLES, buckets: [] });
        assert.equal(errors.length, 1, JSON.stringify(flag));
    }
});

test('validateGates refuses a malformed shape', () => {
    for (const bad of [
        { roleLocks: ['admin'] },
        { roleLocks: { admin: 'a pirate' } },
        { roleCategories: { 'a pirate': ['Criminals'] } },
        { unaffiliatedRoles: 'a pirate' },
        { somethingElse: {} },
    ]) {
        const errors = validateGates(bad, { roles: ROLES, buckets: ['Criminals'] });
        assert.ok(errors.length >= 1, JSON.stringify(bad));
    }
});

test('writeGates writes the whole sidecar and readGates gets it back', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-'));
    const tables = path.join(dir, 'npc-generator-tables.md');
    const gates = {
        roleCategories: { 'a pirate': 'Criminals' },
        roleLocks: { outlaw: ['Criminals'] },
        backdropRoles: { cockpit: ['Pilots'] },
        weaponRoles: {},
        unaffiliatedRoles: [],
    };
    writeGates(tables, gates);
    const written = JSON.parse(fs.readFileSync(gatesPathFor(tables), 'utf8'));
    assert.deepEqual(written, gates);
    assert.deepEqual(readGates(tables, SOURCE).gates, gates);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('gateFlagVocabulary turns the maps into per-table flag glosses', () => {
    const { gateFlagVocabulary } = require('../lib/gates');
    const vocabulary = gateFlagVocabulary({
        roleLocks: { admin: ['a colonial administrator'], outlaw: ['Criminals'] },
        backdropRoles: { cockpit: ['Pilots'] },
        weaponRoles: { blade: ['a close-quarters blade specialist'] },
        roleCategories: {},
        unaffiliatedRoles: [],
    });
    assert.deepEqual(Object.keys(vocabulary).sort(), ['Backdrop', 'Gear', 'Headgear', 'Weapon']);
    assert.match(vocabulary.Gear.admin, /a colonial administrator/);
    assert.match(vocabulary.Headgear.outlaw, /Criminals/);
    assert.match(vocabulary.Backdrop.cockpit, /Pilots/);
    assert.match(vocabulary.Weapon.blade, /blade specialist/);
    assert.deepEqual(gateFlagVocabulary({ roleLocks: null, backdropRoles: null, weaponRoles: null }), {});
});

test('GATE_TABLES says which table each flag map gates, for the panel', () => {
    assert.equal(GATE_TABLES.Gear, 'roleLocks');
    assert.equal(GATE_TABLES.Headgear, 'roleLocks');
    assert.equal(GATE_TABLES.Backdrop, 'backdropRoles');
    assert.equal(GATE_TABLES.Weapon, 'weaponRoles');
    assert.equal(GATE_TABLES.Outfit, undefined);
});
