const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// /api/table-bullets against a file with a group: the group nests under its
// parent, carries the parent's flag vocabulary, and a flag edit inside it is
// accepted. The generator's own tests cover what the group ROLLS.
const PORT = 5241;

const TABLES_FIXTURE = [
    '## Pronouns', '- she/her/her/woman', '',
    '## Outfit', '- a jacket || civ', '- x2 => Flight suits', '- => Flight suits (gundam) || @gundam', '',
    '## Outfit (she) +', '- => Crop tops', '',
    '## Flight suits', '- a flight suit', '- a tan flight suit || mil', '',
    '## Flight suits (she) +', '- a tailored flight suit', '',
    '## Flight suits (gundam)', '- a crimson flight suit', '',
    '## Crop tops', '- a crop top || civ', '',
].join('\n');

test('a group nests under its parent and reads its flags', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const { groups, flags } = await (await fetch(`${server.baseUrl}/api/table-bullets?kind=npc`)).json();
    const kit = groups.find((g) => g.group === 'Kit');
    assert.deepEqual(kit.rows.map((r) => [r.table.name, r.isGroup, r.parent]), [
        ['Outfit', false, null], ['Outfit (she) +', false, null],
        ['Crop tops', true, 'Outfit'],
        ['Flight suits', true, 'Outfit'], ['Flight suits (gundam)', true, 'Outfit'], ['Flight suits (she) +', true, 'Outfit'],
    ]);
    assert.ok(!groups.some((g) => g.group === 'Other'));
    assert.deepEqual(Object.keys(flags['Flight suits']), Object.keys(flags.Outfit));
    assert.deepEqual(Object.keys(flags['Crop tops']), Object.keys(flags.Outfit));
});

test('a flag edit inside a group is accepted and written', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const res = await fetch(`${server.baseUrl}/api/table-bullets/set-flag`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'npc', table: 'Flight suits', text: 'a flight suit', flag: 'mil', on: true }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, text: 'a flight suit || mil' });
});
