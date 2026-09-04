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

test('a variant whose base table is absent still appears, not nested', () => {
    // Defensive: a tables file could disable every bullet of a base table,
    // and readTables drops a table with no bullets. The variant must not
    // vanish with it.
    const grouped = groupTables([t('Hair (she) +')]);
    const appearance = grouped.find((g) => g.group === 'Appearance');
    assert.deepEqual(appearance.rows.map((r) => r.table.name), ['Hair (she) +']);
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
