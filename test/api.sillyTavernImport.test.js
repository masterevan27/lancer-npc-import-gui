const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

// Unique to this file - see api.backgrounds.test.js for why.
const PORT = 5241;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

// The smallest catalogue and stub that make the Create Background tab
// "available", so /api/backgrounds lists items at all. Nothing here renders:
// every still is written by hand.
const CATALOGUE_TEXT = ['# Scenes', '', '## Landing Zone', '', '> A dropship on final approach.', ''].join('\n');
const GENERATE_ART_STUB = [
    'const args = process.argv.slice(2);',
    "if (args.includes('--list')) {",
    "    console.log('  Landing-Zone' + ' '.repeat(46) + 'Final Approach      line 5     (30 chars)');",
    '}',
].join('\n');
const ANIMATE_STUB = 'process.exit(0);';

/**
 * A generator-side folder of stills and a SillyTavern-side folder for them to
 * land in, both under one tmp dir the caller's t.after removes.
 * `withSillyTavern` selects the three states the route has to tell apart:
 * configured and present, configured but missing, and not configured at all.
 */
function makeFixture({ withSillyTavern = 'present' } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-gui-st-'));
    const promptsDir = path.join(dir, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, 'scene-background-art-prompts.md'), CATALOGUE_TEXT);
    const tablesPath = path.join(dir, 'scene-and-spaceship-tables.md');
    fs.writeFileSync(tablesPath, '## Background Animation\n\n- smoke drifts. the camera is locked off.\n');
    const backgroundsDir = path.join(dir, 'output', 'backgrounds');
    fs.mkdirSync(path.join(backgroundsDir, 'LancerBackgrounds'), { recursive: true });
    const artScript = path.join(dir, 'generate-art.js');
    fs.writeFileSync(artScript, GENERATE_ART_STUB);
    const animateScript = path.join(dir, 'animate-portrait.js');
    fs.writeFileSync(animateScript, ANIMATE_STUB);
    const sillyTavernDir = path.join(dir, 'SillyTavern', 'data', 'default-user', 'backgrounds');
    if (withSillyTavern === 'present') fs.mkdirSync(sillyTavernDir, { recursive: true });
    return {
        dir,
        backgroundsDir,
        sillyTavernDir,
        extraConfig: {
            pythonExecutable: process.execPath,
            generateArtScript: artScript,
            animatePortraitScript: animateScript,
            backgroundsDir,
            backgroundPromptsDir: promptsDir,
            backgroundTablesPath: tablesPath,
            ...(withSillyTavern === 'none' ? {} : { sillyTavernBackgroundsDir: sillyTavernDir }),
        },
    };
}

async function startWithFixture(t, options) {
    const fixture = makeFixture(options);
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, extraConfig: fixture.extraConfig,
    });
    t.after(() => {
        server.stop();
        fs.rmSync(fixture.dir, { recursive: true, force: true });
    });
    return { server, fixture };
}

function writeStill(fixture, rel, body = 'PNG') {
    const file = path.join(fixture.backgroundsDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
}

async function getJson(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    return { status: res.status, body: await res.json() };
}

async function postImport(server, body) {
    const res = await fetch(`${server.baseUrl}/api/backgrounds/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

const STILL = 'LancerBackgrounds/Landing-Zone_00001_.png';
const LOOP = 'LancerBackgrounds/Landing-Zone_00001_ Animated.webp';

test('GET /api/backgrounds says whether SillyTavern is reachable and names each still there', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, STILL);

    const { body } = await getJson(server, '/api/backgrounds');
    assert.deepEqual(body.sillyTavern, { available: true, dir: fixture.sillyTavernDir });
    const item = body.items.find((i) => i.rel === STILL);
    assert.deepEqual(item.sillyTavern,
        { still: 'landing zone.png', loop: 'landing zone animated.webp', imported: false });
});

test('POST /api/backgrounds/import copies the still and its loop, and the gallery then says so', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, STILL, 'PNG-BYTES');
    writeStill(fixture, LOOP, 'WEBP-BYTES');

    const { status, body } = await postImport(server, { rel: STILL });
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(body, {
        ok: true, dir: fixture.sillyTavernDir,
        copied: ['landing zone.png', 'landing zone animated.webp'],
    });
    assert.equal(fs.readFileSync(path.join(fixture.sillyTavernDir, 'landing zone.png'), 'utf8'), 'PNG-BYTES');
    assert.equal(fs.readFileSync(path.join(fixture.sillyTavernDir, 'landing zone animated.webp'), 'utf8'), 'WEBP-BYTES');

    const after = await getJson(server, '/api/backgrounds');
    assert.equal(after.body.items.find((i) => i.rel === STILL).sillyTavern.imported, true);
});

test('a still with no loop copies just the still, and a second import overwrites', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, STILL, 'FIRST');

    const first = await postImport(server, { rel: STILL });
    assert.deepEqual(first.body.copied, ['landing zone.png']);

    // Re-rendered on this side since: the copy in SillyTavern follows.
    writeStill(fixture, STILL, 'SECOND');
    const second = await postImport(server, { rel: STILL });
    assert.equal(second.status, 200);
    assert.equal(fs.readFileSync(path.join(fixture.sillyTavernDir, 'landing zone.png'), 'utf8'), 'SECOND');
});

test('the Import tab rows carry the same SillyTavern record', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, STILL);
    fs.writeFileSync(path.join(fixture.sillyTavernDir, 'landing zone.png'), 'PNG');

    const { body } = await getJson(server, '/api/items?category=background');
    const row = body.items.find((i) => i.background.rel === STILL);
    assert.deepEqual(row.background.sillyTavern,
        { available: true, still: 'landing zone.png', loop: 'landing zone animated.webp', imported: true });
});

test('a rel outside the backgrounds folder or a missing still is refused', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, STILL);

    const outside = await postImport(server, { rel: '../config.json' });
    assert.equal(outside.status, 400);
    assert.match(outside.body.error, /inside the backgrounds folder/);

    const missing = await postImport(server, { rel: 'LancerBackgrounds/Nope_00001_.png' });
    assert.equal(missing.status, 404);

    // A loop is not a still: it rides along with its still, never on its own.
    const loop = await postImport(server, { rel: LOOP });
    assert.equal(loop.status, 404);

    assert.deepEqual(fs.readdirSync(fixture.sillyTavernDir), [], 'nothing was copied');
});

test('with no sillyTavernBackgroundsDir the button has nowhere to copy to and the route says so', async (t) => {
    const { server, fixture } = await startWithFixture(t, { withSillyTavern: 'none' });
    writeStill(fixture, STILL);

    const { body } = await getJson(server, '/api/backgrounds');
    assert.deepEqual(body.sillyTavern, { available: false, dir: '' });
    assert.equal(body.items[0].sillyTavern.imported, false);

    const { status, body: res } = await postImport(server, { rel: STILL });
    assert.equal(status, 400);
    assert.match(res.error, /sillyTavernBackgroundsDir/);
});

test('a configured folder that is not there is reported, not created', async (t) => {
    const { server, fixture } = await startWithFixture(t, { withSillyTavern: 'missing' });
    writeStill(fixture, STILL);

    const { body } = await getJson(server, '/api/backgrounds');
    assert.equal(body.sillyTavern.available, false);

    const { status, body: res } = await postImport(server, { rel: STILL });
    assert.equal(status, 400);
    assert.match(res.error, /not a folder/);
    // Creating it would put backgrounds where SillyTavern never looks - a typo
    // in the path must surface as this error, not as a silent second folder.
    assert.equal(fs.existsSync(fixture.sillyTavernDir), false);
});
