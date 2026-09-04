const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const TABLES_FIXTURE = ['## Outfit', '- a heavy work jacket || civ', ''].join('\n');

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
function stageRun({ file, entries, copied = [] }) {
    const stagedDir = path.join(server.dir, 'staged-imports');
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

test.before(async () => {
    server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    stageRun({ file: WITH_COPIES, entries: ENTRIES, copied: ['gold-mech-cathedral.png'] });
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
