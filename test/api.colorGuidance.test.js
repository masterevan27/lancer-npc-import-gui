/**
 * The colour guidance selector, end to end through the server: the catalog
 * route the two selects load from, the create and regenerate routes that
 * validate the chosen id and hand it to generate-npc.py as
 * --color-guidance / --color-guidance-catalog, and the item view that tells
 * the detail page which guidance a saved NPC was rendered with.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const PORT = 5401;
const TABLES_FIXTURE = '## Role\n- a dockworker\n';

// Records its argv beside itself, the way api.spaceshipRegenArgs.test.js's
// stub does: the create route exposes its child's stdout as a job log, but
// the regenerate route does not, and one mechanism for both reads better.
const STUB = `
const fs = require('fs'), path = require('path');
fs.appendFileSync(path.join(__dirname, 'argv.log'), JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(0);
`;

const NPC_ID = 'npc-vela-okonkwo-7';

function manifestFor(dir) {
    return {
        [path.join(dir, 'out', 'Pilots', 'Vela Okonkwo')]: {
            id: NPC_ID, kind: 'npc', name: 'Vela Okonkwo', callsign: 'Kestrel', seed: 7,
            when: '2026-09-15 09:00:00', traits: { Role: 'a dockworker' },
            color_guidance: { id: 'ochre', name: 'Ochre' },
        },
    };
}

async function startServer(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guidance-api-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const catalog = path.join(root, 'color-guidance.json');
    fs.writeFileSync(catalog, JSON.stringify({ guidance: [
        { id: 'ochre', name: 'Ochre', prompt: 'Keep the palette to ochre.' },
        { id: 'hidden', name: 'Hidden', prompt: 'private palette', hidden: true },
    ] }));
    const s = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB,
        extraConfig: { colorGuidancePath: catalog },
    });
    t.after(() => s.stop());
    fs.writeFileSync(s.manifestPath, JSON.stringify(manifestFor(s.dir)));
    return { s, catalog };
}

const post = (s, route, body) => fetch(`${s.baseUrl}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

async function lastArgv(s) {
    const log = path.join(s.dir, 'argv.log');
    for (let i = 0; i < 50; i++) {
        if (fs.existsSync(log)) {
            const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
            return JSON.parse(lines[lines.length - 1]).join(' ');
        }
        await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error('the generator stub never ran');
}

test('the catalog route lists public guidance only', async (t) => {
    const { s } = await startServer(t);
    const { guidance } = await (await fetch(`${s.baseUrl}/api/color-guidance`)).json();
    assert.deepEqual(guidance, [{ id: 'default', name: 'Default' }, { id: 'none', name: 'None (no colour guidance)' }, { id: 'ochre', name: 'Ochre' }]);
});

test('create passes the built-in none guidance through to the generator', async (t) => {
    const { s, catalog } = await startServer(t);
    const res = await post(s, '/api/create-npc', { count: 1, dryRun: true, colorGuidance: 'none' });
    assert.equal(res.status, 202, await res.text());
    const argv = await lastArgv(s);
    assert.match(argv, /--color-guidance none/);
    assert.ok(argv.includes(`--color-guidance-catalog ${catalog}`), argv);
});

test('create passes the chosen guidance to the generator and refuses unknown or hidden ids', async (t) => {
    const { s, catalog } = await startServer(t);
    let res = await post(s, '/api/create-npc', { count: 1, dryRun: true, colorGuidance: 'ochre' });
    assert.equal(res.status, 202);
    let argv = await lastArgv(s);
    assert.match(argv, /--color-guidance ochre/);
    assert.ok(argv.includes(`--color-guidance-catalog ${catalog}`), argv);

    fs.rmSync(path.join(s.dir, 'argv.log'));
    res = await post(s, '/api/create-npc', { count: 1, dryRun: true });
    assert.equal(res.status, 202);
    argv = await lastArgv(s);
    assert.doesNotMatch(argv, /--color-guidance/);

    for (const colorGuidance of ['nope', 'hidden']) {
        res = await post(s, '/api/create-npc', { count: 1, dryRun: true, colorGuidance });
        assert.equal(res.status, 400, colorGuidance);
        assert.match((await res.json()).error, /guidance/);
    }
});

test('regenerate passes the chosen guidance and the item view reports the saved one', async (t) => {
    const { s } = await startServer(t);
    const { items } = await (await fetch(`${s.baseUrl}/api/items?category=npc`)).json();
    assert.deepEqual(items.find((i) => i.id === NPC_ID).colorGuidance, { id: 'ochre', name: 'Ochre' });

    let res = await post(s, '/api/regenerate', { id: NPC_ID, which: 'both', seedMode: 'same', colorGuidance: 'ochre' });
    assert.equal(res.status, 202, await res.text());
    const argv = await lastArgv(s);
    assert.match(argv, /--regen-id npc-vela-okonkwo-7/);
    assert.match(argv, /--color-guidance ochre/);

    res = await post(s, '/api/regenerate', { id: NPC_ID, which: 'both', seedMode: 'same', colorGuidance: 'nope' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /guidance/);
});
