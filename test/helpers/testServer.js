const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVER_JS = path.join(__dirname, '..', '..', 'server.js');

/**
 * Spins up a real server.js child process against a synthetic fixture
 * directory - never the real config.json, npc-generator-tables.md, or
 * manifest. `port` must be unique per test file (see the module docstring
 * in the plan this came from): `node --test` runs different test files
 * concurrently, and every server in this suite binds a fixed port rather
 * than an OS-assigned one, so two files sharing a port would collide.
 */
async function startTestServer({ tablesText, port, generatorSource, extraConfig, manifest }) {
    if (!port) throw new Error('startTestServer requires an explicit port');
    const host = '127.0.0.1';
    const baseUrl = `http://${host}:${port}`;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-gui-test-'));
    const tablesPath = path.join(dir, 'npc-generator-tables.md');
    fs.writeFileSync(tablesPath, tablesText);
    const presetsDir = path.join(dir, 'presets');
    const manifestPath = path.join(dir, '.generated-npcs.json');
    // Empty unless the caller says otherwise. Most tests write the manifest
    // themselves after the server is up, which is fine because the server
    // re-reads it fresh on every request - but the "new NPC" seen store is
    // seeded once at startup from whatever the manifest held *then*, so a test
    // for "an existing library arrives with nothing flagged new" has to hand
    // that library over before the child spawns. Raw JSON string or object,
    // whichever reads better at the call site.
    //
    // An explicit `null` writes no manifest at all, which is a third state
    // rather than a tidier spelling of empty: on a fresh install the file is
    // gitignored and absent until the first generate run, and a seen store that
    // deferred its seed on that would run it later against the manifest the
    // user's first NPCs had just created, marking every one already seen.
    if (manifest !== null) {
        fs.writeFileSync(manifestPath, typeof manifest === 'string' ? manifest : JSON.stringify(manifest || {}));
    }
    const foundryRoot = path.join(dir, 'FoundryData');
    fs.mkdirSync(foundryRoot, { recursive: true });

    // Several existing tests already reach startCreateJob and spawn
    // generate-npc.py - they just never assert on what it prints. When a
    // caller wants to assert on the command line the server builds,
    // generatorSource writes that source as a stub script and points the
    // config at it - see api.createArgs.test.js. The stub is plain Node
    // (not Python), and pythonExecutable is repointed at process.execPath
    // to run it, so asserting on the server's argv-building never depends
    // on a `python` interpreter being on PATH - CI's ubuntu-latest images
    // ship python3 but not reliably a bare `python`.
    let generateNpcScript;
    if (generatorSource) {
        generateNpcScript = path.join(dir, 'generate-npc.js');
        fs.writeFileSync(generateNpcScript, generatorSource);
    }

    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
        port,
        host,
        secret: '',
        npcManifestPath: manifestPath,
        foundryDataRoot: foundryRoot,
        npcTablesPath: tablesPath,
        stagedImportsDir: path.join(dir, 'staged-imports'),
        presetsDir,
        ...(generateNpcScript ? { generateNpcScript, pythonExecutable: process.execPath } : {}),
        // Last, so a test can override any of the above - written for
        // traitOddsSamples, which a test needs to see reach the generator's
        // command line, and general because the next such key would otherwise
        // add a third named parameter here.
        ...(extraConfig || {}),
    }));

    const child = spawn(process.execPath, [SERVER_JS], {
        env: { ...process.env, IMPORT_GUI_CONFIG: configPath },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Nobody read these pipes before, which cost two things. A test server that
    // crashed did so in total silence - the test saw only ECONNREFUSED and the
    // reason went in the bin. And an OS pipe buffer is finite (~64KB on
    // Windows), so a server that wrote enough would block forever mid-write:
    // a hang with no output, which is the worst shape a failure can take.
    // Keep the tail, echo it when IMPORT_GUI_TEST_VERBOSE is set, and hand it
    // back with a readiness failure.
    let log = '';
    const collect = (chunk) => {
        log = (log + chunk).slice(-8000);
        if (process.env.IMPORT_GUI_TEST_VERBOSE) process.stderr.write(`[:${port}] ${chunk}`);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    let exited = null;
    child.on('exit', (code, signal) => { exited = { code, signal }; });

    // Two details here are load-bearing under `node --test`, which runs test
    // FILES as concurrent processes:
    //
    //   - AbortSignal.timeout, because a bare `await fetch()` has no deadline
    //     of its own. The `Date.now()` guard below is only consulted between
    //     iterations, so one poll whose socket stalls hangs this loop forever
    //     - and with it every test file the runner is holding output for, not
    //     just this one. That failure looks exactly like a slow suite, and
    //     cost an afternoon to find once.
    //   - Draining the body, because an unread response keeps its socket
    //     alive, and a readiness loop is the one place that reliably makes
    //     several of them.
    //
    // The budget is generous for the same reason: a dozen servers starting at
    // once on a loaded machine are slow, and a timeout here is a confusing
    // failure in an unrelated test rather than a useful signal.
    let ready = false;
    const deadline = Date.now() + 20000;
    while (!ready && Date.now() < deadline) {
        try {
            const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
            await res.arrayBuffer();
            ready = res.ok;
        } catch { /* not listening yet, or this poll timed out */ }
        if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    if (!ready) {
        child.kill();
        fs.rmSync(dir, { recursive: true, force: true });
        throw new Error(
            `test server on port ${port} did not become ready within 20s`
            + (exited ? ` (it exited: code=${exited.code} signal=${exited.signal})` : '')
            + (log ? `\n--- server output ---\n${log}` : '\n--- server printed nothing ---'),
        );
    }

    return {
        baseUrl,
        dir,
        tablesPath,
        manifestPath,
        presetsDir,
        stop() {
            return new Promise((resolve) => {
                child.once('exit', () => {
                    fs.rmSync(dir, { recursive: true, force: true });
                    resolve();
                });
                child.kill();
            });
        },
    };
}

module.exports = { startTestServer };
