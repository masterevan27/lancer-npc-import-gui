const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

const TABLES_FIXTURE = [
    '## Outfit',
    '- a heavy work jacket over a stained undersuit || civ',
    '- x4 nondescript grey work coveralls',
    '<!-- - a graffiti-tagged cropped t-shirt || civ -->',
    '',
    '## Outfit (she) +',
    '- a fitted flight suit knotted at the waist',
    '',
    '## Role',
    '- a dockworker',
    '- a mech pilot || mil',
    '',
    '## How the script reads this file',
    '- this is documentation, not a roll option',
    '',
].join('\n');

test('GET /api/trait-options keys options by base table, variants folded in', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5201 });
    t.after(() => server.stop());

    const { options } = await (await fetch(`${server.baseUrl}/api/trait-options`)).json();
    assert.deepEqual(Object.keys(options).sort(), ['Outfit', 'Role']);
    assert.equal(options.Outfit.length, 4);
    assert.ok(options.Outfit.some((o) => o.heading === 'Outfit (she) +' && o.isVariant));
});

test('an option value keeps the bullet flags --set-trait needs', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5201 });
    t.after(() => server.stop());

    const { options } = await (await fetch(`${server.baseUrl}/api/trait-options`)).json();
    const pilot = options.Role.find((o) => o.value.startsWith('a mech pilot'));
    assert.equal(pilot.value, 'a mech pilot || mil');
    assert.equal(pilot.label, 'a mech pilot · mil');
});

test('disabled bullets are offered and flagged, not dropped', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5201 });
    t.after(() => server.stop());

    const { options } = await (await fetch(`${server.baseUrl}/api/trait-options`)).json();
    const tee = options.Outfit.find((o) => o.value.includes('graffiti-tagged'));
    assert.ok(tee, 'a disabled bullet must still be offered');
    assert.equal(tee.enabled, false);
});

test('the generator documentation section is not offered as a trait', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5201 });
    t.after(() => server.stop());

    const { options } = await (await fetch(`${server.baseUrl}/api/trait-options`)).json();
    assert.equal(options['How the script reads this file'], undefined);
});

test('every table the override dropdown offers can be looked up by its own name', async (t) => {
    // The two lists come from different places - the dropdown from
    // generate-npc.py's REQUIRED_TABLES, these options from the tables file -
    // so a drift between them would leave an override row with no values and
    // no explanation. Any table in both must agree on its key.
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5201 });
    t.after(() => server.stop());

    const { tables } = await (await fetch(`${server.baseUrl}/api/npc-tables`)).json();
    const { options } = await (await fetch(`${server.baseUrl}/api/trait-options`)).json();
    for (const key of Object.keys(options)) {
        assert.ok(tables.includes(key),
            `"${key}" has options but is not an override table - the two lists have drifted`);
    }
});
