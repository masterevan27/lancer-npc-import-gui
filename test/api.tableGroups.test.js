const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

    // The response body alone is the write's own echo - it would look the
    // same for a handler that validated the flag and then no-opped. Read the
    // file back and diff it against the fixture line-by-line so the only
    // change is the target bullet gaining its flag, which is what actually
    // proves setBulletFlagOnDisk resolved "Flight suits" through Outfit's
    // vocabulary and rewrote the right line in place.
    const written = fs.readFileSync(server.tablesPath, 'utf8').split('\n');
    const expectedLines = TABLES_FIXTURE.split('\n');
    const target = expectedLines.indexOf('- a flight suit');
    expectedLines[target] = '- a flight suit || mil';
    assert.deepEqual(written, expectedLines);

    // And the read side agrees - the flag shows on the wire for that bullet
    // on the next fetch, not just in the write's own response.
    const { groups } = await (await fetch(`${server.baseUrl}/api/table-bullets?kind=npc`)).json();
    const flightSuits = groups.flatMap((g) => g.rows).find((r) => r.table.name === 'Flight suits').table;
    assert.ok(flightSuits.bullets.some((b) => b.text === 'a flight suit || mil'));
});
