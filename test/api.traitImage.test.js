const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

// Both fixtures carry a '## Backdrop'. That collision is the reason table
// identity is (kind, table) on the wire and the reason the two staging
// directories are siblings rather than nested: a staged candidate's table
// name only means something paired with the file it came from.
const TABLES_FIXTURE = [
    '## Outfit',
    '- a heavy work jacket || civ',
    '',
    '## Backdrop',
    '- a rain-slick loading dock',
    '',
].join('\n');

const SHIP_TABLES_FIXTURE = [
    '## Hull',
    '- a blunt slab of ablative plate || bulk',
    '',
    '## Backdrop',
    '- a shattered orbital ring',
    '',
].join('\n');

// A real 1x1 PNG rather than a text file with a .png name: the endpoint reads
// the extension to pick a Content-Type, and a test that never sends bytes a
// browser would accept as an image proves less than it looks like it does.
const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

// One server and one fixture for the whole file, rather than the server-per-
// test the older files here use. Every case below is a GET against staged data
// that nothing mutates, so they can share - and `node --test` runs test FILES
// as concurrent processes, which makes a file that starts seven servers a
// meaningful share of a loaded machine rather than a free convenience.
// Unique to this file, as startTestServer's docstring requires: 5193-5203 are
// spoken for, and two files sharing a port fail as a silent hang rather than
// as a collision.
const PORT = 5204;

const WITH_COPIES = '2026-09-02-221633.json';
const TRAVERSING = '2026-09-03-090000.json';
const JPEG_RUN = '2026-09-03-100000.json';
const SHIP_RUN = '2026-09-06-120000.json';

let server;

/**
 * Writes one staged-imports run, plus whichever of its reference images the
 * npc-trait-import skill would have copied beside it.
 *
 * `entries` are the candidate objects in the skill's own on-disk shape;
 * `copied` names the source images that exist under refs/<run>/, which is
 * deliberately a separate argument - an entry naming an image nobody copied
 * is the ordinary case for a run staged before this feature existed.
 */
function stageRun({ file, entries, copied = [], kind = 'npc' }) {
    // Siblings, not nested - lib/paths.js derives the ship directory beside
    // the NPC one for exactly the reason listStagedFiles reads *.json at the
    // top level of whichever it is given.
    const stagedDir = path.join(
        server.dir, kind === 'spaceship' ? 'staged-imports-spaceship' : 'staged-imports');
    fs.mkdirSync(stagedDir, { recursive: true });
    fs.writeFileSync(path.join(stagedDir, file), JSON.stringify({
        generated_at: '2026-09-02T22:16:33-04:00',
        source_images: entries.map((e) => e.source_image).filter(Boolean),
        entries,
    }, null, 2));

    const refsDir = path.join(stagedDir, 'refs', path.basename(file, '.json'));
    fs.mkdirSync(refsDir, { recursive: true });
    for (const name of copied) fs.writeFileSync(path.join(refsDir, name), PNG_1X1);
}

/**
 * fetch(), with the response body always drained.
 *
 * An unread body keeps its socket open, which keeps the event loop alive,
 * which stops the process exiting - and a test file that never exits stalls
 * the whole concurrent run behind it. The other files here drain by accident
 * when they read .json(); this one asserts on statuses and headers, so it has
 * to drain on purpose.
 */
async function get(url) {
    const res = await fetch(url);
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get('content-type'), body };
}

const imageUrl = (file, id) =>
    `${server.baseUrl}/api/trait-image?file=${encodeURIComponent(file)}&id=${encodeURIComponent(id)}`;

const ENTRIES = [
    {
        id: 'c1-e1',
        table: 'Outfit',
        bullet: 'a quilted longcoat over a pressure liner || civ',
        source_image: 'gold-mech-cathedral.png',
        placement_hint: null,
        bookkeeping_note: null,
        notes: null,
    },
    {
        id: 'c1-e2',
        table: 'Outfit',
        bullet: 'a service tunic with a torn shoulder board || mil',
        source_image: 'never-copied.png',
        placement_hint: null,
        bookkeeping_note: null,
        notes: null,
    },
];

// A ship run, staged in the ship's own directory. Its Backdrop entry is the
// point: the name collides with the NPC file's heading, so nothing but the
// directory the run came from says which file the bullet belongs in.
const SHIP_ENTRIES = [
    {
        id: 's1-e1',
        table: 'Hull',
        bullet: 'a scarred prow of layered ablative plate || bulk',
        source_image: 'drydock.png',
        placement_hint: null,
        bookkeeping_note: null,
        notes: null,
    },
    {
        id: 's1-e2',
        table: 'Backdrop',
        bullet: 'a breaker yard of half-cut hulls',
        source_image: null,
        placement_hint: null,
        bookkeeping_note: null,
        notes: null,
    },
];

test.before(async () => {
    server = await startTestServer({
        tablesText: TABLES_FIXTURE, spaceshipTablesText: SHIP_TABLES_FIXTURE, port: PORT,
    });
    stageRun({ file: WITH_COPIES, entries: ENTRIES, copied: ['gold-mech-cathedral.png'] });
    stageRun({ file: SHIP_RUN, entries: SHIP_ENTRIES, copied: ['drydock.png'], kind: 'spaceship' });
    // The staged JSON is written by a skill, not by the browser - but it is
    // still a file on disk that something else could have produced, so a
    // traversing source_image has to be refused rather than trusted.
    stageRun({
        file: TRAVERSING,
        entries: [{ ...ENTRIES[0], id: 't1', source_image: '../../outside.png' }],
    });
    stageRun({
        file: JPEG_RUN,
        entries: [{ ...ENTRIES[0], id: 'j1', source_image: '1116511.jpg' }],
        copied: ['1116511.jpg'],
    });
    fs.writeFileSync(path.join(server.dir, 'outside.png'), PNG_1X1);
});

test.after(() => server.stop());

test('serves the reference image a staged candidate was read from', async () => {
    const res = await get(imageUrl(WITH_COPIES, 'c1-e1'));
    assert.equal(res.status, 200);
    assert.equal(res.type, 'image/png');
    assert.deepEqual(res.body, PNG_1X1);
});

test('a candidate reports whether its reference image was copied beside the run', async () => {
    const { candidates } = await (await fetch(`${server.baseUrl}/api/trait-candidates`)).json();
    const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));
    assert.equal(byId['c1-e1'].hasSourceImage, true);
    assert.equal(byId['c1-e2'].hasSourceImage, false);
    // The filename is still reported either way - the detail sheet says where a
    // bullet came from even when it cannot show it.
    assert.equal(byId['c1-e2'].sourceImage, 'never-copied.png');
    // A traversing name is not a preview, however the JSON got written.
    assert.equal(byId['t1'].hasSourceImage, false);
});

test("404s when the run kept no copy of that candidate's image", async () => {
    const res = await get(imageUrl(WITH_COPIES, 'c1-e2'));
    assert.equal(res.status, 404);
});

test('404s for a candidate id that is in no staged run', async () => {
    const res = await get(imageUrl(WITH_COPIES, 'nope'));
    assert.equal(res.status, 404);
});

test('refuses a staged filename that climbs out of the staging directory', async () => {
    for (const file of ['../outside.json', '..%2Foutside.json', 'refs/../../outside.json']) {
        const res = await get(imageUrl(file, 'c1-e1'));
        assert.ok(
            res.status === 400 || res.status === 404,
            `${file} must not be served (got ${res.status})`,
        );
    }
});

test("refuses a source_image that climbs out of the run's refs folder", async () => {
    const res = await get(imageUrl(TRAVERSING, 't1'));
    assert.ok(res.status === 400 || res.status === 404, `expected a refusal, got ${res.status}`);
});

test('serves a jpeg with a jpeg content type', async () => {
    const res = await get(imageUrl(JPEG_RUN, 'j1'));
    assert.equal(res.status, 200);
    assert.equal(res.type, 'image/jpeg');
});

/* ------------------------------------------------------------------ */
/* The same three routes, per kind                                     */
/* ------------------------------------------------------------------ */

const candidatesUrl = (kind) =>
    `${server.baseUrl}/api/trait-candidates${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`;

async function candidates(kind) {
    const res = await fetch(candidatesUrl(kind));
    assert.equal(res.status, 200, `?kind=${kind} should list`);
    return (await res.json()).candidates;
}

test('each kind lists only its own staged runs', async () => {
    const npc = await candidates('npc');
    const ship = await candidates('spaceship');

    assert.ok(npc.some((c) => c.id === 'c1-e1'), 'the NPC listing lost its own runs');
    assert.ok(!npc.some((c) => c.file === SHIP_RUN),
        'a ship run reached the NPC listing, so the two staging directories are being read as one');
    assert.deepEqual(ship.map((c) => c.id).sort(), ['s1-e1', 's1-e2']);
    // The reference image is found under the SHIP refs directory, which is
    // the half of this that refImagePath had wrong when it read one constant.
    assert.equal(ship.find((c) => c.id === 's1-e1').hasSourceImage, true);
});

test('no kind on the query is the NPC listing, exactly as before', async () => {
    assert.deepEqual(
        (await candidates()).map((c) => c.id).sort(),
        (await candidates('npc')).map((c) => c.id).sort());
});

test('a kind the registry does not know is refused rather than served as NPC', async () => {
    for (const path_ of ['/api/trait-candidates?kind=spacehip',
        `/api/trait-image?kind=spacehip&file=${SHIP_RUN}&id=s1-e1`]) {
        const res = await get(`${server.baseUrl}${path_}`);
        assert.equal(res.status, 400, `${path_} folded an unknown kind onto npc`);
    }
    const res = await fetch(`${server.baseUrl}/api/trait-candidates/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'spacehip', items: [] }),
    });
    await res.arrayBuffer();
    assert.equal(res.status, 400, 'the import route folded an unknown kind onto npc');
});

test("a run's image is served under its own kind and nobody else's", async () => {
    const ok = await get(`${server.baseUrl}/api/trait-image?kind=spaceship`
        + `&file=${encodeURIComponent(SHIP_RUN)}&id=s1-e1`);
    assert.equal(ok.status, 200);
    assert.equal(ok.type, 'image/png');
    assert.deepEqual(ok.body, PNG_1X1);

    // Same file and id, asked of the NPC kind: that run is not in the NPC
    // staging directory, so it is as unknown as a candidate that never
    // existed rather than a path the server goes looking for.
    const wrong = await get(imageUrl(SHIP_RUN, 's1-e1'));
    assert.equal(wrong.status, 404);
});

test("an imported ship bullet lands in the ship's tables file, not the NPC's", async () => {
    const res = await fetch(`${server.baseUrl}/api/trait-candidates/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 'Backdrop' on purpose: the heading exists in both files, so a route
        // that resolved the tables path from anything but the kind would
        // append this to npc-generator-tables.md and report success.
        body: JSON.stringify({ kind: 'spaceship', items: [{ file: SHIP_RUN, id: 's1-e2' }] }),
    });
    assert.equal(res.status, 200);
    const { results } = await res.json();
    assert.deepEqual(results, [{ file: SHIP_RUN, id: 's1-e2', imported: true }]);

    const shipTables = fs.readFileSync(server.spaceshipTablesPath, 'utf8');
    assert.match(shipTables, /- a breaker yard of half-cut hulls/);
    assert.match(fs.readFileSync(server.tablesPath, 'utf8'), /- a rain-slick loading dock/);
    assert.doesNotMatch(fs.readFileSync(server.tablesPath, 'utf8'), /breaker yard/,
        'the ship bullet was appended to the NPC tables file');

    // And the run itself is marked imported in the ship staging directory,
    // rather than a same-named file being looked for under the NPC one.
    const staged = JSON.parse(fs.readFileSync(
        path.join(server.dir, 'staged-imports-spaceship', SHIP_RUN), 'utf8'));
    assert.equal(staged.entries.find((e) => e.id === 's1-e2').imported, true);
});
