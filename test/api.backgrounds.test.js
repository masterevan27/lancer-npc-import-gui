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
function makeFixture({
    withArt = true, withAnimate = true, withCatalogue = true,
    artSource = GENERATE_ART_STUB, listTimeoutMs,
} = {}) {
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
    if (withArt) fs.writeFileSync(artScript, artSource);
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
            ...(listTimeoutMs ? { backgroundListTimeoutMs: listTimeoutMs } : {}),
        },
    };
}

// Stands in for a --list that hangs forever - a blocking import, a Python
// waiting on something. Never exits on its own; the server's own timeout is
// what has to end it.
const GENERATE_ART_HANG_STUB = [
    "const args = process.argv.slice(2);",
    "if (args.includes('--list')) {",
    "    process.stderr.write('warming up the model\\n');",
    '    setInterval(() => {}, 1000);',
    '} else {',
    '    process.exit(0);',
    '}',
].join('\n');

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

test('GET /api/backgrounds does not hang when --list hangs, and still resolves to an empty entry list',
    async (t) => {
        const { server } = await startWithFixture(t, { artSource: GENERATE_ART_HANG_STUB, listTimeoutMs: 300 });
        const started = Date.now();
        const { status, body } = await getJson(server, '/api/backgrounds');
        assert.equal(status, 200);
        assert.ok(Date.now() - started < 10000,
            'a hung --list must not hang the whole request - the server has to kill the child itself');
        assert.equal(body.catalogues.length, 1);
        assert.deepEqual(body.catalogues[0].entries, [],
            'every failure resolves to an empty entry list, the module-wide contract');
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

test('GET /api/backgrounds/image 404s a directory instead of crashing the server', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    // A directory whose name ends in an image extension - existsSync is true
    // for it too, and createReadStream on a directory emits EISDIR, which an
    // unforwarded pipe() error would otherwise take down the whole process.
    fs.mkdirSync(path.join(fixture.backgroundsDir, 'Weird.png'), { recursive: true });

    const res = await getJson(server, '/api/backgrounds/image?rel=Weird.png');
    assert.equal(res.status, 404);

    // The server must still be alive afterward - the real regression here
    // is the process dying, not just this one response.
    const { status } = await getJson(server, '/api/backgrounds');
    assert.equal(status, 200);
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

/* ---- animating ---- */

function readAnimateRuns(fixture) {
    // The stub writes one line per run into backgroundsDir, as a dotfile the
    // gallery walk skips - which is exactly what makes it safe to leave there.
    const file = path.join(fixture.backgroundsDir, '.animate-argv.jsonl');
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('POST /api/backgrounds/animate refuses a traversal in rel', async (t) => {
    const { server } = await startWithFixture(t);
    const { status, body } = await postJson(server, '/api/backgrounds/animate',
        { rel: '../../secrets.txt', description: 'smoke drifts' });
    assert.equal(status, 400);
    assert.match(body.error, /inside the backgrounds folder/);
});

test('POST /api/backgrounds/animate 404s a still that is not there', async (t) => {
    const { server } = await startWithFixture(t);
    const { status } = await postJson(server, '/api/backgrounds/animate',
        { rel: 'nope.png', description: 'smoke drifts' });
    assert.equal(status, 404);
});

test('POST /api/backgrounds/animate 404s a directory rather than spawning on it', async (t) => {
    const { server } = await startWithFixture(t);
    // LancerBackgrounds is a real directory the fixture creates - existsSync
    // is true for it, which is exactly what let this through before.
    const { status } = await postJson(server, '/api/backgrounds/animate',
        { rel: 'LancerBackgrounds', description: 'smoke drifts' });
    assert.equal(status, 404);
});

test("POST /api/backgrounds/animate 404s rel: '.', which resolveInside returns as the root", async (t) => {
    const { server } = await startWithFixture(t);
    const { status } = await postJson(server, '/api/backgrounds/animate',
        { rel: '.', description: 'smoke drifts' });
    assert.equal(status, 404);
});

test('POST /api/backgrounds/animate refuses a missing description without blaming the tables file', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    const { status, body } = await postJson(server, '/api/backgrounds/animate',
        { rel: 'LancerBackgrounds/Canyon-Skirmish_00001_.png' });
    assert.equal(status, 400);
    assert.match(body.error, /description/i);
    assert.ok(!/Background Animation/.test(body.error),
        'a caller that simply omitted description was never told about the tables file');
    assert.ok(!/scene-and-spaceship-tables/.test(body.error));
});

test('POST /api/backgrounds/render refuses a seed above the 32-bit cap animate already enforces', async (t) => {
    const { server } = await startWithFixture(t);
    const { status, body } = await postJson(server, '/api/backgrounds/render', {
        catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish', seed: 2 ** 32,
    });
    assert.equal(status, 400);
    assert.match(body.error, /seed/);
});

test('POST /api/backgrounds/animate says where the script should have been', async (t) => {
    const { server, fixture } = await startWithFixture(t, { withAnimate: false });
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    const { status, body } = await postJson(server, '/api/backgrounds/animate', {
        rel: 'LancerBackgrounds/Canyon-Skirmish_00001_.png', description: 'smoke drifts',
    });
    assert.equal(status, 400);
    assert.match(body.error, /animate-portrait\.py not found at /);
});

test('POST /api/backgrounds/animate refuses a malformed specific seed', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    const { status, body } = await postJson(server, '/api/backgrounds/animate', {
        rel: 'LancerBackgrounds/Canyon-Skirmish_00001_.png',
        description: 'smoke drifts', seedMode: 'specific', seed: -3,
    });
    assert.equal(status, 400);
    assert.match(body.error, /seed/);
});

test('an animate run writes the loop, the sidecar and --background', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    const { status, body } = await postJson(server, '/api/backgrounds/animate', {
        rel: 'LancerBackgrounds/Canyon-Skirmish_00001_.png',
        description: 'smoke drifts slowly', seedMode: 'specific', seed: 99, pingpong: false,
    });
    assert.equal(status, 202);
    const job = await waitForJob(server, body.jobId);
    assert.equal(job.status, 'done');

    const [argv] = readAnimateRuns(fixture);
    assert.ok(argv.includes('--background'));
    assert.ok(argv.includes('--no-pingpong'));
    assert.equal(argv[argv.indexOf('-d') + 1], 'smoke drifts slowly');
    assert.equal(argv[argv.indexOf('--seed') + 1], '99');

    const sidecar = JSON.parse(fs.readFileSync(path.join(fixture.backgroundsDir,
        'LancerBackgrounds', 'Canyon-Skirmish_00001_ Animated.json'), 'utf8'));
    assert.equal(sidecar.description, 'smoke drifts slowly');
    assert.equal(sidecar.seed, 99);
    assert.equal(typeof sidecar.portraitVersion, 'number');
});

test("seedMode 'same' reuses the seed in the existing sidecar", async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    fs.writeFileSync(path.join(fixture.backgroundsDir, 'LancerBackgrounds',
        'Canyon-Skirmish_00001_ Animated.json'),
        JSON.stringify({ description: 'old', seed: 1234, portraitVersion: 1 }));

    const { body } = await postJson(server, '/api/backgrounds/animate', {
        rel: 'LancerBackgrounds/Canyon-Skirmish_00001_.png',
        description: 'rain falls', seedMode: 'same',
    });
    await waitForJob(server, body.jobId);
    const [argv] = readAnimateRuns(fixture);
    assert.equal(argv[argv.indexOf('--seed') + 1], '1234');
});

test('the loop reaches the gallery on the still it was made from', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    const { body } = await postJson(server, '/api/backgrounds/animate', {
        rel: 'LancerBackgrounds/Canyon-Skirmish_00001_.png', description: 'smoke drifts',
    });
    await waitForJob(server, body.jobId);

    const { body: listing } = await getJson(server, '/api/backgrounds');
    const item = listing.items.find((i) => i.rel === 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    assert.ok(item.animation, 'the still should now carry its loop');
    assert.equal(item.animation.description, 'smoke drifts');
    assert.equal(listing.items.length, 1, 'the loop must not become a card of its own');
});

/* ---- the opt-in chain ---- */

test('animateWhenDone starts one loop per new still, each with its own prompt', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    const { body } = await postJson(server, '/api/backgrounds/render', {
        catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish',
        variants: 2, animateWhenDone: true,
    });
    const render = await waitForJob(server, body.jobId);
    assert.equal(render.status, 'done');
    assert.equal(render.produced, 2);
    assert.equal(render.chain.length, 2, 'one animate job per still that landed');

    for (const link of render.chain) {
        const loop = await waitForJob(server, link.jobId);
        assert.equal(loop.status, 'done', `chained loop for ${link.rel} failed: ${loop.error}`);
        assert.equal(loop.rel, link.rel);
    }

    // The pool holds two enabled bullets and pickMotionPrompt avoids the one
    // just used, so two variants must get two different prompts rather than
    // sharing the one the panel happened to be showing.
    const runs = readAnimateRuns(fixture);
    assert.equal(runs.length, 2);
    const prompts = runs.map((argv) => argv[argv.indexOf('-d') + 1]);
    assert.notEqual(prompts[0], prompts[1]);
    const seeds = runs.map((argv) => argv[argv.indexOf('--seed') + 1]);
    assert.notEqual(seeds[0], seeds[1], 'each still gets its own seed');
});

test('a render without animateWhenDone chains nothing', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    const { body } = await postJson(server, '/api/backgrounds/render',
        { catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish' });
    const render = await waitForJob(server, body.jobId);
    assert.deepEqual(render.chain, []);
    assert.equal(readAnimateRuns(fixture).length, 0);
});

/* ---- the Import tab's Backgrounds category ---- */

const STILL = 'LancerBackgrounds/Canyon-Skirmish_00001_.png';
const STILL_ID = `bg:${STILL}`;

test('GET /api/categories lists Backgrounds after the manifest rows, with a count', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, STILL);
    writeStill(fixture, 'LancerBackgrounds/Dropship-Yard_00001_.png');
    const { body } = await getJson(server, '/api/categories');
    assert.deepEqual(body.categories.at(-1), { id: 'background', count: 2, label: 'Backgrounds' });
    // Still a feature, not a kind: nothing generates a background through
    // /api/create, so `kinds` must not grow.
    assert.ok(!body.kinds.includes('background'));
});

test('GET /api/categories lists an empty Backgrounds row only while the tab is on offer', async (t) => {
    const { server } = await startWithFixture(t);
    const { body: withTab } = await getJson(server, '/api/categories');
    assert.deepEqual(withTab.categories.at(-1), { id: 'background', count: 0, label: 'Backgrounds' });

    // A second server on its own port: no script, and an empty folder.
    const bareFixture = makeFixture({ withArt: false });
    const bare = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT + 60, extraConfig: bareFixture.extraConfig,
    });
    t.after(() => {
        bare.stop();
        fs.rmSync(bareFixture.dir, { recursive: true, force: true });
    });
    const { body: without } = await getJson(bare, '/api/categories');
    assert.ok(!without.categories.some((c) => c.id === 'background'),
        'no script and no stills means no row at all');
    // ...but stills the user already has stay listed even without the script.
    writeStill(bareFixture, STILL);
    const { body: content } = await getJson(bare, '/api/categories');
    assert.deepEqual(content.categories.at(-1), { id: 'background', count: 1, label: 'Backgrounds' });
});

test('GET /api/items?category=background returns grid rows shaped like the manifest kinds', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, STILL);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_ Animated.webp', 'WEBP');
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_ Animated.json',
        JSON.stringify({ description: 'smoke drifts', seed: 9 }));
    const { status, body } = await getJson(server, '/api/items?category=background');
    assert.equal(status, 200);
    assert.equal(body.items.length, 1);
    const [item] = body.items;
    assert.equal(item.id, STILL_ID);
    assert.equal(item.kind, 'background');
    assert.equal(item.name, 'Canyon Skirmish', 'the gallery display name, not the filename');
    // The fields the grid and the sheet read off every row, answered for a
    // file that is only a file.
    assert.deepEqual(item.traits, {});
    assert.equal(item.seed, null);
    assert.equal(item.importable, false);
    assert.equal(item.imported, false);
    assert.equal(item.isNew, true);
    assert.deepEqual(item.supports, {});
    assert.equal(item.tokenUrl, null);
    assert.match(item.portraitUrl,
        /^\/api\/backgrounds\/image\?rel=LancerBackgrounds%2FCanyon-Skirmish_00001_\.png&v=\d+$/);
    assert.equal(item.hasAnimation, true);
    assert.match(item.animationUrl, /Animated\.webp&v=\d+$/);
    assert.equal(item.animationStatus, null);
    assert.equal(item.folderPath, path.join(fixture.backgroundsDir, 'LancerBackgrounds'));
    assert.equal(item.portraitFile, 'Canyon-Skirmish_00001_.png');
    assert.equal(item.tokenFile, 'Canyon-Skirmish_00001_ Animated.webp');
    assert.equal(item.background.rel, STILL);
    assert.equal(item.background.animation.description, 'smoke drifts');
    assert.equal(item.background.animation.seed, 9);
});

test("POST /api/seen clears a background's New tag, and /api/unseen counts it", async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, STILL);
    const { body: before } = await getJson(server, '/api/unseen');
    assert.ok(before.ids.includes(STILL_ID));

    const { status } = await postJson(server, '/api/seen', { ids: [STILL_ID] });
    assert.equal(status, 200);
    const { body } = await getJson(server, '/api/items?category=background');
    assert.equal(body.items[0].isNew, false);
    // An id for a still that is not on disk is dropped, as a stale manifest
    // id is, rather than stored against whatever lands there later.
    await postJson(server, '/api/seen', { ids: ['bg:LancerBackgrounds/nope.png'] });
    writeStill(fixture, 'LancerBackgrounds/nope.png');
    const { body: later } = await getJson(server, '/api/items?category=background');
    assert.equal(later.items.find((i) => i.id === 'bg:LancerBackgrounds/nope.png').isNew, true);
});

test('POST /api/delete removes a background, its loop and its record through the bg: id', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    const still = writeStill(fixture, STILL);
    const webp = writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_ Animated.webp', 'WEBP');
    const sidecar = writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_ Animated.json', '{}');
    const keep = writeStill(fixture, 'LancerBackgrounds/Dropship-Yard_00001_.png');
    await postJson(server, '/api/seen', { ids: [STILL_ID] });

    const { status, body } = await postJson(server, '/api/delete', {
        ids: [STILL_ID, 'bg:../outside.png', 'bg:LancerBackgrounds', 'bg:LancerBackgrounds/missing.png'],
    });
    assert.equal(status, 200);
    assert.deepEqual(body.results, [
        { id: STILL_ID, deleted: true },
        { id: 'bg:../outside.png', deleted: false, reason: 'unknown item' },
        { id: 'bg:LancerBackgrounds', deleted: false, reason: 'unknown item' },
        { id: 'bg:LancerBackgrounds/missing.png', deleted: false, reason: 'unknown item' },
    ]);
    for (const gone of [still, webp, sidecar]) assert.ok(!fs.existsSync(gone), `${gone} should be gone`);
    assert.ok(fs.existsSync(keep), 'the neighbour must survive');
    const { body: listing } = await getJson(server, '/api/items?category=background');
    assert.deepEqual(listing.items.map((i) => i.id), ['bg:LancerBackgrounds/Dropship-Yard_00001_.png']);
    // The seen entry went with it, so a re-render at the same path is new.
    writeStill(fixture, STILL);
    const { body: again } = await getJson(server, '/api/items?category=background');
    assert.equal(again.items.find((i) => i.id === STILL_ID).isNew, true);
});

test('POST /api/delete refuses a background while a loop is being made from it', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    // An animate stub slow enough that the job is still running when the
    // delete arrives, but one that does exit: its cwd is the fixture folder,
    // and a child still alive at t.after would hold that folder open on
    // Windows and fail the cleanup with EPERM.
    fs.writeFileSync(fixture.extraConfig.animatePortraitScript, 'setTimeout(() => process.exit(0), 400);');
    writeStill(fixture, STILL);
    const { status } = await postJson(server, '/api/backgrounds/animate',
        { rel: STILL, description: 'smoke drifts', seedMode: 'specific', seed: 1 });
    assert.equal(status, 202);
    const { body } = await postJson(server, '/api/delete', { ids: [STILL_ID] });
    assert.equal(body.results[0].deleted, false);
    assert.match(body.results[0].reason, /loop is being made/);
    assert.ok(fs.existsSync(path.join(fixture.backgroundsDir, ...STILL.split('/'))));
    // Let the stub exit before the fixture is removed.
    const deadline = Date.now() + 5000;
    for (;;) {
        const { body: listing } = await getJson(server, '/api/backgrounds');
        if (listing.items.find((i) => i.rel === STILL)?.status !== 'running') break;
        if (Date.now() > deadline) throw new Error('the animate stub never exited');
        await new Promise((r) => setTimeout(r, 50));
    }
});

test('a finished render reports the Import tab ids of what it produced, and un-sees them', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    // A still already seen at the path the stub is about to write over: the
    // run's own output must come back New all the same.
    writeStill(fixture, STILL);
    await postJson(server, '/api/seen', { ids: [STILL_ID] });
    fs.rmSync(path.join(fixture.backgroundsDir, ...STILL.split('/')));

    const { body } = await postJson(server, '/api/backgrounds/render',
        { catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish', variants: 2 });
    const job = await waitForJob(server, body.jobId);
    assert.equal(job.produced, 2);
    assert.deepEqual(job.producedIds, [
        'bg:LancerBackgrounds/Canyon-Skirmish_00001_.png',
        'bg:LancerBackgrounds/Canyon-Skirmish_00002_.png',
    ]);
    const { body: listing } = await getJson(server, '/api/items?category=background');
    assert.ok(listing.items.every((i) => i.isNew), "a run's own output is new by definition");
});
