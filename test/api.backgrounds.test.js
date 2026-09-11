const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

// Unique to this file: node --test runs test files as concurrent processes
// and every server in this suite binds a fixed port.
const PORT = 5237;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

// The catalogue the stub's --list output describes. The prompt blocks sit at
// lines 5 and 11 so attachHeadings finds the '##' headings at 3 and 9.
const CATALOGUE_TEXT = [
    '# Scene & Background Art Prompts',                                   // 1
    '',                                                                   // 2
    '## Canyon Skirmish — A Night Raid',                                  // 3
    '',                                                                   // 4
    '> A wide cinematic establishing shot of a scorched canyon at night.', // 5
    '> Bold black linework throughout.',                                  // 6
    '',                                                                   // 7
    '',                                                                   // 8
    '## Dropship Yard',                                                   // 9
    '',                                                                   // 10
    '> A dropship yard at dusk under low cloud.',                         // 11
    '',                                                                   // 12
].join('\n');

// Both tables from the real file's shape: Backdrop hard-wrapped (and so
// silently truncated by the bullet regex, which has never been parseable) and
// Background Animation one physical line per bullet. Reading the good table
// out of a file holding a bad one is the thing being pinned.
const BACKGROUND_TABLES_TEXT = [
    '## Backdrop',
    '',
    '- a ruined hab block under low cloud, its upper floors sheared away',
    '  and rebar hanging loose over the street below',
    '',
    '## Background Animation',
    '',
    '- smoke drifts slowly across the scene. the camera is locked off.',
    '<!-- - rain falls steadily and runs off every hard edge. the camera is locked off. -->',
    '- snow falls gently over the wreckage. the camera is locked off.',
    '',
].join('\n');

// A Node stub standing in for generate-art.py, run through
// pythonExecutable: process.execPath - the trick api.createArgs.test.js uses,
// so asserting on the argv never needs a Python interpreter on PATH. --list
// reproduces the real "  %-58s %-20s line %-5d (%d chars)" columns, including
// an entry whose role column is empty.
const GENERATE_ART_STUB = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    "const valueOf = (flag) => { const i = args.indexOf(flag); return i === -1 ? '' : args[i + 1]; };",
    "const pad = (s, n) => String(s) + ' '.repeat(Math.max(1, n - String(s).length));",
    "if (args.includes('--list')) {",
    "    console.log(path.basename(valueOf('--prompts')) + ': 2 prompts found, 2 selected');",
    "    console.log('  ' + pad('Canyon-Skirmish', 58) + pad('A Night Raid', 20) + 'line ' + pad(5, 5) + '(120 chars)');",
    "    console.log('  ' + pad('Dropship-Yard', 58) + pad('', 20) + 'line ' + pad(11, 5) + '(140 chars)');",
    '    process.exit(0);',
    '}',
    "const root = valueOf('--download-to');",
    'fs.mkdirSync(root, { recursive: true });',
    "fs.writeFileSync(path.join(root, '.render-argv.json'), JSON.stringify(args));",
    "const dest = path.join(root, 'LancerBackgrounds');",
    'fs.mkdirSync(dest, { recursive: true });',
    "const variants = Number(valueOf('--variants') || 1);",
    'for (let n = 1; n <= variants; n += 1) {',
    "    fs.writeFileSync(path.join(dest, 'Canyon-Skirmish_0000' + n + '_.png'), 'PNG');",
    '}',
    "console.log('wrote ' + variants + ' still(s)');",
].join('\n');

// The animate stub: writes the .webp where --out says and appends its own
// argv to a dotfile the gallery walk skips, one line per run, so the chain
// test can count runs and read back what each was told to do.
const ANIMATE_STUB = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    "const valueOf = (flag) => { const i = args.indexOf(flag); return i === -1 ? '' : args[i + 1]; };",
    "const out = valueOf('--out');",
    "fs.writeFileSync(out, 'WEBP');",
    "fs.appendFileSync(path.join(path.dirname(out), '..', '.animate-argv.jsonl'), JSON.stringify(args) + '\\n');",
    "console.log('animated');",
].join('\n');

/**
 * The fixture tree, built before the server starts because extraConfig has to
 * name absolute paths. Independent of startTestServer's own tmp dir, and
 * removed by the caller's t.after.
 */
function makeFixture({ withArt = true, withAnimate = true, withCatalogue = true } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-gui-bg-'));
    const promptsDir = path.join(dir, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    if (withCatalogue) {
        fs.writeFileSync(path.join(promptsDir, 'scene-background-art-prompts.md'), CATALOGUE_TEXT);
    }
    const tablesPath = path.join(dir, 'scene-and-spaceship-tables.md');
    fs.writeFileSync(tablesPath, BACKGROUND_TABLES_TEXT);
    const backgroundsDir = path.join(dir, 'output', 'backgrounds');
    fs.mkdirSync(path.join(backgroundsDir, 'LancerBackgrounds'), { recursive: true });
    const artScript = path.join(dir, 'generate-art.js');
    if (withArt) fs.writeFileSync(artScript, GENERATE_ART_STUB);
    const animateScript = path.join(dir, 'animate-portrait.js');
    if (withAnimate) fs.writeFileSync(animateScript, ANIMATE_STUB);
    return {
        dir,
        promptsDir,
        tablesPath,
        backgroundsDir,
        extraConfig: {
            pythonExecutable: process.execPath,
            generateArtScript: artScript,
            animatePortraitScript: animateScript,
            backgroundsDir,
            backgroundPromptsDir: promptsDir,
            backgroundTablesPath: tablesPath,
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

/* ---- the read side ---- */

test('GET /api/backgrounds walks nested stills and skips loops and dotfiles', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    writeStill(fixture, 'Loose.png');
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_ Animated.webp', 'WEBP');
    fs.writeFileSync(path.join(fixture.backgroundsDir, '.backgrounds-manifest.json'), '{}');

    const { body } = await getJson(server, '/api/backgrounds');
    assert.equal(body.available, true);
    const rels = body.items.map((i) => i.rel).sort();
    assert.deepEqual(rels, ['LancerBackgrounds/Canyon-Skirmish_00001_.png', 'Loose.png']);
});

test('GET /api/backgrounds pairs a still with its sidecar and names it', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    const still = writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_ Animated.webp', 'WEBP');
    fs.writeFileSync(
        path.join(fixture.backgroundsDir, 'LancerBackgrounds', 'Canyon-Skirmish_00001_ Animated.json'),
        JSON.stringify({
            description: 'smoke drifts slowly across the scene. the camera is locked off.',
            seed: 42,
            portraitVersion: Math.round(fs.statSync(still).mtimeMs),
        }));

    const { body } = await getJson(server, '/api/backgrounds');
    const item = body.items.find((i) => i.rel.endsWith('Canyon-Skirmish_00001_.png'));
    assert.equal(item.name, 'Canyon Skirmish');
    assert.equal(item.animation.seed, 42);
    assert.match(item.animation.description, /^smoke drifts/);
    assert.equal(item.animation.stale, false);
});

test('GET /api/backgrounds flags a loop whose still has been re-rendered', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_ Animated.webp', 'WEBP');
    fs.writeFileSync(
        path.join(fixture.backgroundsDir, 'LancerBackgrounds', 'Canyon-Skirmish_00001_ Animated.json'),
        JSON.stringify({ description: 'smoke drifts', seed: 42, portraitVersion: 1 }));

    const { body } = await getJson(server, '/api/backgrounds');
    const item = body.items.find((i) => i.rel.endsWith('Canyon-Skirmish_00001_.png'));
    assert.equal(item.animation.stale, true);
});

test('GET /api/backgrounds reports the catalogue, its label and its entries', async (t) => {
    const { server } = await startWithFixture(t);
    const { body } = await getJson(server, '/api/backgrounds');
    assert.equal(body.catalogues.length, 1);
    const [catalogue] = body.catalogues;
    assert.equal(catalogue.file, 'scene-background-art-prompts.md');
    assert.equal(catalogue.label, 'Scene');
    assert.deepEqual(catalogue.entries.map((e) => e.prefix), ['Canyon-Skirmish', 'Dropship-Yard']);
    assert.equal(catalogue.entries[0].name, 'Canyon Skirmish — A Night Raid');
    assert.equal(catalogue.entries[0].role, 'A Night Raid');
    assert.match(catalogue.entries[0].excerpt, /^A wide cinematic establishing shot/);
    assert.equal(catalogue.entries[1].role, '', 'the empty role column must stay empty');
});

test('GET /api/backgrounds ships the enabled Background Animation bullets only', async (t) => {
    const { server } = await startWithFixture(t);
    const { body } = await getJson(server, '/api/backgrounds');
    assert.deepEqual(body.motionPrompts, [
        'smoke drifts slowly across the scene. the camera is locked off.',
        'snow falls gently over the wreckage. the camera is locked off.',
    ]);
});

test('GET /api/backgrounds answers available:false and names what is missing', async (t) => {
    const { server } = await startWithFixture(t, { withArt: false });
    const { status, body } = await getJson(server, '/api/backgrounds');
    assert.equal(status, 200, 'the route answers rather than 404s');
    assert.equal(body.available, false);
    assert.equal(body.items.length, 0);
    assert.ok(body.missing.some((m) => /generate-art\.py not found at /.test(m)));
});

test('GET /api/backgrounds is unavailable with no catalogue to pick from', async (t) => {
    const { server } = await startWithFixture(t, { withCatalogue: false });
    const { body } = await getJson(server, '/api/backgrounds');
    assert.equal(body.available, false);
    assert.ok(body.missing.some((m) => /background-art-prompts\.md/.test(m)));
});

test('GET /api/categories carries the backgrounds feature when it is installed', async (t) => {
    const { server } = await startWithFixture(t);
    const { body } = await getJson(server, '/api/categories');
    assert.deepEqual(body.features, ['backgrounds']);
});

test('GET /api/categories reports no features when the script is absent', async (t) => {
    const { server } = await startWithFixture(t, { withArt: false });
    const { body } = await getJson(server, '/api/categories');
    assert.deepEqual(body.features, []);
});

/* ---- the image route ---- */

test('GET /api/backgrounds/image serves a still with the right type', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    const res = await fetch(
        `${server.baseUrl}/api/backgrounds/image?rel=${encodeURIComponent('LancerBackgrounds/Canyon-Skirmish_00001_.png')}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(await res.text(), 'PNG');
});

test('GET /api/backgrounds/image refuses a traversal and an unknown file', async (t) => {
    const { server } = await startWithFixture(t);
    const up = await getJson(server,
        `/api/backgrounds/image?rel=${encodeURIComponent('../../secrets.txt')}`);
    assert.equal(up.status, 400);
    const gone = await getJson(server, '/api/backgrounds/image?rel=nope.png');
    assert.equal(gone.status, 404);
});

/* ---- rendering ---- */

async function postJson(server, p, body) {
    const res = await fetch(`${server.baseUrl}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

/** Polls a background job to a terminal state, the way the client does. */
async function waitForJob(server, jobId, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const { body } = await getJson(server,
            `/api/backgrounds/status?jobId=${encodeURIComponent(jobId)}`);
        if (body.status !== 'running') return body;
        if (Date.now() > deadline) throw new Error(`job never finished: ${JSON.stringify(body)}`);
        await new Promise((r) => setTimeout(r, 50));
    }
}

test('POST /api/backgrounds/render refuses an unknown catalogue', async (t) => {
    const { server } = await startWithFixture(t);
    const { status, body } = await postJson(server, '/api/backgrounds/render',
        { catalogue: 'nope.md', prefix: 'Canyon-Skirmish' });
    assert.equal(status, 400);
    assert.match(body.error, /unknown catalogue "nope\.md"/);
});

test('POST /api/backgrounds/render refuses an unknown prefix', async (t) => {
    const { server } = await startWithFixture(t);
    const { status, body } = await postJson(server, '/api/backgrounds/render',
        { catalogue: 'scene-background-art-prompts.md', prefix: 'Not-An-Entry' });
    assert.equal(status, 400);
    assert.match(body.error, /unknown entry "Not-An-Entry"/);
});

test('POST /api/backgrounds/render refuses variants outside 1-8', async (t) => {
    const { server } = await startWithFixture(t);
    const { status, body } = await postJson(server, '/api/backgrounds/render',
        { catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish', variants: 12 });
    assert.equal(status, 400);
    assert.match(body.error, /variants/);
});

test('POST /api/backgrounds/render says where the script should have been', async (t) => {
    const { server } = await startWithFixture(t, { withArt: false });
    const { status, body } = await postJson(server, '/api/backgrounds/render',
        { catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish' });
    assert.equal(status, 400);
    assert.match(body.error, /generate-art\.py not found at /);
});

test('a render spawns the anchored filter and a manifest inside backgroundsDir', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    const { status, body } = await postJson(server, '/api/backgrounds/render', {
        catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish', seed: 11,
    });
    assert.equal(status, 202);
    const job = await waitForJob(server, body.jobId);
    assert.equal(job.status, 'done');
    assert.equal(job.produced, 1);

    const argv = JSON.parse(
        fs.readFileSync(path.join(fixture.backgroundsDir, '.render-argv.json'), 'utf8'));
    // A hyphen is not regex syntax outside a character class, so escapeRegExp
    // leaves it alone and the anchors are the only addition.
    assert.equal(argv[argv.indexOf('--filter') + 1], '^Canyon-Skirmish$');
    assert.equal(argv[argv.indexOf('--manifest') + 1],
        path.join(fixture.backgroundsDir, '.backgrounds-manifest.json'));
    assert.equal(argv[argv.indexOf('--download-to') + 1], fixture.backgroundsDir);
    assert.equal(argv[argv.indexOf('--seed') + 1], '11');
});

test('a render with a null seed omits --seed and lets the script roll one', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    const { body } = await postJson(server, '/api/backgrounds/render', {
        catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish', seed: null,
    });
    await waitForJob(server, body.jobId);
    const argv = JSON.parse(
        fs.readFileSync(path.join(fixture.backgroundsDir, '.render-argv.json'), 'utf8'));
    assert.ok(!argv.includes('--seed'));
});

test('a finished render shows up in the gallery', async (t) => {
    const { server } = await startWithFixture(t);
    const { body } = await postJson(server, '/api/backgrounds/render',
        { catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish' });
    await waitForJob(server, body.jobId);
    const { body: listing } = await getJson(server, '/api/backgrounds');
    assert.ok(listing.items.some((i) => i.rel === 'LancerBackgrounds/Canyon-Skirmish_00001_.png'));
});

test('GET /api/backgrounds/status 404s an unknown job', async (t) => {
    const { server } = await startWithFixture(t);
    const { status } = await getJson(server, '/api/backgrounds/status?jobId=nope');
    assert.equal(status, 404);
});
