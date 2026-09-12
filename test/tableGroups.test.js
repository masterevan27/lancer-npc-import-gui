const test = require('node:test');
const assert = require('node:assert/strict');
const { groupTables, TABLE_GROUPS } = require('../lib/tableGroups');

const t = (name) => ({ name, bullets: [] });

test('groups appear in the declared order, not file order', () => {
    const grouped = groupTables([t('Stance'), t('Age'), t('Given names'), t('Outfit')]);
    assert.deepEqual(grouped.map((g) => g.group), ['Identity', 'Body', 'Kit', 'Scene']);
});

test('a group with no tables present is omitted entirely', () => {
    const grouped = groupTables([t('Age')]);
    assert.deepEqual(grouped.map((g) => g.group), ['Body']);
});

test('variants nest under the base table they extend', () => {
    // Given in file order (he before she is NOT file order in the live file);
    // the base comes first and the variants sort by name, so the list order
    // is stable across reloads rather than following whatever the file says.
    const grouped = groupTables([t('Hair'), t('Hair (she) +'), t('Hair (he) +'), t('Eyes')]);
    const appearance = grouped.find((g) => g.group === 'Appearance');
    assert.deepEqual(
        appearance.rows.map((r) => [r.table.name, r.isVariant]),
        [['Hair', false], ['Hair (he) +', true], ['Hair (she) +', true], ['Eyes', false]],
    );
});

test('a variant whose base table is absent still appears, still marked as a variant', () => {
    // Defensive: a tables file could disable every bullet of a base table,
    // and readTables drops a table with no bullets. The variant must not
    // vanish with it - and it keeps its indentation, since it is still a
    // variant of that base by name even though the base row itself isn't
    // present to nest under.
    const grouped = groupTables([t('Hair (she) +')]);
    const appearance = grouped.find((g) => g.group === 'Appearance');
    assert.deepEqual(
        appearance.rows.map((r) => [r.table.name, r.isVariant]),
        [['Hair (she) +', true]],
    );
});

test('a table named in no group lands in Other rather than disappearing', () => {
    // A table added to the generator later must stay reachable here.
    const grouped = groupTables([t('Age'), t('Something New')]);
    const other = grouped.find((g) => g.group === 'Other');
    assert.deepEqual(other.rows.map((r) => r.table.name), ['Something New']);
});

test('Other sorts last', () => {
    const grouped = groupTables([t('Something New'), t('Age')]);
    assert.equal(grouped.at(-1).group, 'Other');
});

test('every table given to it comes back exactly once', () => {
    const names = ['Given names', 'Hair', 'Hair (she) +', 'Weapon', 'Stance', 'Zzz'];
    const grouped = groupTables(names.map(t));
    const returned = grouped.flatMap((g) => g.rows.map((r) => r.table.name));
    assert.equal(returned.length, names.length);
    assert.deepEqual([...returned].sort(), [...names].sort());
});

test('Glow colour is grouped under Scene, not left in Other', () => {
    const grouped = groupTables([t('Glow colour')]);
    assert.equal(grouped[0].group, 'Scene');
});

test('TABLE_GROUPS names no table twice', () => {
    const all = TABLE_GROUPS.flatMap((g) => g.tables);
    assert.equal(new Set(all).size, all.length);
});

test('a group table nests under the table that references it, after its variants', () => {
    const outfit = { name: 'Outfit', bullets: [], references: ['Flight suits'] };
    const she = { name: 'Outfit (she) +', bullets: [], references: ['Crop tops'] };
    const suits = { name: 'Flight suits', bullets: [], references: [] };
    const suitsShe = { name: 'Flight suits (she) +', bullets: [], references: [] };
    const crop = { name: 'Crop tops', bullets: [], references: [] };
    const grouped = groupTables([crop, suitsShe, t('Headgear'), suits, she, outfit]);
    const kit = grouped.find((g) => g.group === 'Kit');
    assert.deepEqual(kit.rows.map((r) => [r.table.name, r.isVariant, r.isGroup, r.parent]), [
        ['Outfit', false, false, null],
        ['Outfit (she) +', true, false, null],
        ['Crop tops', false, true, 'Outfit'],
        ['Flight suits', false, true, 'Outfit'],
        ['Flight suits (she) +', true, true, 'Outfit'],
        ['Headgear', false, false, null],
    ]);
    assert.ok(!grouped.some((g) => g.group === 'Other'), 'a group is never an orphan');
});

test('a heading both listed in TABLE_GROUPS and referenced as another table\'s group is emitted once', () => {
    // An unusual file, but nothing stops one: 'Role' and 'Faction' are both
    // named in the SAME TABLE_GROUPS list (Identity), Role first. If Role
    // also references Faction as a group, Faction is claimed as a NESTED row
    // under Role before the root loop ever reaches Faction's own turn there -
    // and the root loop must skip an already-claimed heading rather than
    // pushing it a second time as a bare root row.
    const role = { name: 'Role', bullets: [], references: ['Faction'] };
    const faction = { name: 'Faction', bullets: [], references: [] };
    const grouped = groupTables([role, faction]);
    const identity = grouped.find((g) => g.group === 'Identity');
    assert.deepEqual(identity.rows.map((r) => [r.table.name, r.isGroup, r.parent]), [
        ['Role', false, null],
        ['Faction', true, 'Role'],
    ]);
});

test('a group referenced by a table absent from TABLE_GROUPS still nests, in Other', () => {
    const cloak = { name: 'Cloak', bullets: [], references: ['Long cloaks'] };
    const longCloaks = { name: 'Long cloaks', bullets: [], references: [] };
    const longCloaksShe = { name: 'Long cloaks (she) +', bullets: [], references: [] };
    const grouped = groupTables([longCloaksShe, longCloaks, cloak]);
    const other = grouped.find((g) => g.group === 'Other');
    assert.deepEqual(other.rows.map((r) => [r.table.name, r.isVariant, r.isGroup, r.parent]), [
        ['Cloak', false, false, null],
        ['Long cloaks', false, true, 'Cloak'],
        ['Long cloaks (she) +', true, true, 'Cloak'],
    ]);
    assert.ok(!other.rows.some((r) => r.isGroup === false && r.table.name.startsWith('Long cloaks')),
        'the referenced group never surfaces as a plain, un-nested row');
});
