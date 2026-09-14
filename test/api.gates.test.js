const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

// The gate editor's API: the effective gate maps ride along with
// /api/table-bullets, and /api/gates writes the sidecar the generator's
// load_gates() reads. Unique port, as every file in this suite must claim.
const PORT = 5265;

const TABLES_FIXTURE = [
    '## Role',
    '- a mech pilot || mil',
    '- a dockworker',
    '- a pirate',
    '- a colonial administrator',
    '',
    '## Gear',
    '- a lacquered cane of office || hands admin',
    '- a battered data-slate',
    '',
    '## Backdrop',
    '- A character portrait || {Subject} {is_are} at a flight station || cockpit',
    '',
].join('\n');

// The gate maps as the generator declares them, in the Node stub the test
// server writes as the "generator script". Never executed here - only read.
const GENERATOR_SOURCE = [
    '// stub',
    'ROLE_CATEGORIES = {',
    '    "a mech pilot": "Pilots",',
    '    "a dockworker": "Laborers",',
    '    "a pirate": "Criminals",',
    '    "a colonial administrator": "Officials",',
    '}',
    'ROLE_LOCKS = {',
    '    "admin": ("a colonial administrator",),',
    '}',
    'UNAFFILIATED_ROLES = frozenset({',
    '    "a dockworker",',
    '})',
    'WEAPON_ROLES = {',
    '}',
    'BACKDROP_ROLES = {',
    '    "cockpit": ("Pilots",),',
    '}',
    '',
].join('\n');

async function getGates(server, kind = 'npc') {
    const res = await fetch(`${server.baseUrl}/api/table-bullets?kind=${kind}`);
    assert.equal(res.status, 200);
    return (await res.json()).gates;
}

async function postGates(server, body) {
    return fetch(`${server.baseUrl}/api/gates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function sidecarOf(server) {
    return path.join(path.dirname(server.tablesPath), 'npc-generator-tables.gates.json');
}

test('GET /api/table-bullets ships the gate maps, roles and buckets beside the tables', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: GENERATOR_SOURCE,
    });
    t.after(() => server.stop());

    const gates = await getGates(server);
    assert.deepEqual(gates.maps.roleLocks, { admin: ['a colonial administrator'] });
    assert.deepEqual(gates.maps.backdropRoles, { cockpit: ['Pilots'] });
    assert.deepEqual(gates.maps.roleCategories['a pirate'], 'Criminals');
    assert.deepEqual(gates.maps.unaffiliatedRoles, ['a dockworker']);
    assert.deepEqual(gates.overridden, []);
    // The Role bullets, flag-stripped, so the panel can offer checkboxes and
    // the server can refuse a name that admits nobody.
    assert.deepEqual(gates.roles, ['a mech pilot', 'a dockworker', 'a pirate', 'a colonial administrator']);
    assert.deepEqual(gates.buckets, ['Pilots', 'Laborers', 'Criminals', 'Officials']);
    assert.equal(gates.tables.Gear, 'roleLocks');
    assert.equal(gates.tables.Backdrop, 'backdropRoles');
});

test('POST /api/gates writes the sidecar and the next GET reads it as overridden', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: GENERATOR_SOURCE,
    });
    t.after(() => server.stop());

    const before = await getGates(server);
    const maps = {
        ...before.maps,
        roleLocks: { admin: ['Officials'], badge: ['a pirate'] },
    };
    const res = await postGates(server, { kind: 'npc', gates: maps });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.gates.maps.roleLocks, { admin: ['Officials'], badge: ['a pirate'] });

    const written = JSON.parse(fs.readFileSync(sidecarOf(server), 'utf8'));
    assert.deepEqual(written.roleLocks, { admin: ['Officials'], badge: ['a pirate'] });
    assert.deepEqual(written.backdropRoles, { cockpit: ['Pilots'] }, 'every map is written, so the generator sees one whole picture');

    const after = await getGates(server);
    assert.deepEqual(after.maps.roleLocks, { admin: ['Officials'], badge: ['a pirate'] });
    assert.ok(after.overridden.includes('roleLocks'));
});

test('a new gate flag written through /api/gates appears in the flag vocabulary', async (t) => {
    // The point of the editor: a flag defined here is immediately offered as a
    // checkbox on the gated table's bullets, so the two halves of a gate -
    // which bullets carry it, and who it admits - are edited from one tab.
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: GENERATOR_SOURCE,
    });
    t.after(() => server.stop());

    const before = await getGates(server);
    await postGates(server, {
        kind: 'npc',
        gates: { ...before.maps, roleLocks: { ...before.maps.roleLocks, badge: ['a pirate'] } },
    });
    const { flags } = await (await fetch(`${server.baseUrl}/api/table-bullets?kind=npc`)).json();
    assert.ok(flags.Gear.badge, 'Gear should offer the new lock flag');
    assert.match(flags.Gear.badge, /a pirate/);
    assert.ok(flags.Gear.admin, 'the existing lock flag is still offered');
});

test('POST /api/gates refuses a name that admits nobody, and writes nothing', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: GENERATOR_SOURCE,
    });
    t.after(() => server.stop());

    const before = await getGates(server);
    const res = await postGates(server, {
        kind: 'npc',
        gates: { ...before.maps, roleLocks: { admin: ['a colonial administratr'] } },
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /a colonial administratr/);
    assert.ok(Array.isArray(body.errors));
    assert.ok(!fs.existsSync(sidecarOf(server)), 'a refused write must leave no sidecar');
});

test('a stale name in a map the edit did not touch does not block the edit', async (t) => {
    // The generator's own defaults can name a Role the tables have since
    // reworded (its test_backdrop_role.py exists to catch that). Validating
    // the whole file would then refuse every edit to every other map, with a
    // message about a table the user never opened. Only what changed is
    // checked; the stale map is written through as it was.
    const STALE_SOURCE = GENERATOR_SOURCE.replace(
        '    "cockpit": ("Pilots",),',
        '    "cockpit": ("Pilots",),\n    "clergy": ("a scavenger-priest",),',
    );
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STALE_SOURCE,
    });
    t.after(() => server.stop());

    const before = await getGates(server);
    assert.deepEqual(before.maps.backdropRoles.clergy, ['a scavenger-priest']);
    const res = await postGates(server, {
        kind: 'npc',
        gates: { ...before.maps, roleLocks: { admin: ['Officials'] } },
    });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const after = await getGates(server);
    assert.deepEqual(after.maps.roleLocks, { admin: ['Officials'] });
    assert.deepEqual(after.maps.backdropRoles.clergy, ['a scavenger-priest'], 'passed through untouched');

    // Another gate in the SAME map as the stale one can be edited too: the
    // check is per entry, not per map, or Backdrop's fourteen other gates
    // would be frozen by one reworded Role.
    const sibling = await postGates(server, {
        kind: 'npc',
        gates: { ...after.maps, backdropRoles: { ...after.maps.backdropRoles, cockpit: ['Pilots', 'Laborers'] } },
    });
    assert.equal(sibling.status, 200, JSON.stringify(await sibling.clone().json()));

    // Even the stale entry itself can be added to: only the names an edit
    // ADDS are checked, so the priest rides along until someone unticks it,
    // and the user is never told off for a name they did not type.
    const stale = await postGates(server, {
        kind: 'npc',
        gates: { ...after.maps, backdropRoles: { ...after.maps.backdropRoles, clergy: ['a scavenger-priest', 'Pilots'] } },
    });
    assert.equal(stale.status, 200, JSON.stringify(await stale.clone().json()));
    assert.deepEqual((await getGates(server)).maps.backdropRoles.clergy, ['a scavenger-priest', 'Pilots']);

    // A bad name that IS newly written is still refused.
    const touched = await postGates(server, {
        kind: 'npc',
        gates: { ...after.maps, backdropRoles: { ...after.maps.backdropRoles, cockpit: ['Pilotz'] } },
    });
    assert.equal(touched.status, 400);
    assert.match((await touched.json()).error, /Pilotz/);
});

test('POST /api/gates refuses a malformed body', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: GENERATOR_SOURCE,
    });
    t.after(() => server.stop());

    for (const body of [{}, { kind: 'npc' }, { kind: 'npc', gates: [] }, { kind: 'npc', gates: 'x' }]) {
        const res = await postGates(server, body);
        assert.equal(res.status, 400, JSON.stringify(body));
    }
});

test('POST /api/gates/reset removes the sidecar and the defaults come back', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: GENERATOR_SOURCE,
    });
    t.after(() => server.stop());

    const before = await getGates(server);
    await postGates(server, { kind: 'npc', gates: { ...before.maps, roleLocks: {} } });
    assert.ok(fs.existsSync(sidecarOf(server)));

    const res = await fetch(`${server.baseUrl}/api/gates/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'npc' }),
    });
    assert.equal(res.status, 200);
    assert.ok(!fs.existsSync(sidecarOf(server)));
    const after = await getGates(server);
    assert.deepEqual(after.maps.roleLocks, { admin: ['a colonial administrator'] });
    assert.deepEqual(after.overridden, []);
});

test('a corrupt sidecar is reported with the defaults rather than hiding the panel', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: GENERATOR_SOURCE,
    });
    t.after(() => server.stop());

    fs.writeFileSync(sidecarOf(server), '{broken');
    const gates = await getGates(server);
    assert.match(gates.error, /gates\.json/);
    assert.deepEqual(gates.maps.roleLocks, { admin: ['a colonial administrator'] });
});

test('a kind whose script declares no gate maps gets gates: null', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: '// a stub with no gate maps\n',
        expressionTablesText: '## Neutral\n- a level gaze\n',
    });
    t.after(() => server.stop());

    assert.equal(await getGates(server, 'npc'), null);
    assert.equal(await getGates(server, 'expression'), null);
    const res = await postGates(server, { kind: 'expression', gates: {} });
    assert.equal(res.status, 400);
});
