const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startTestServer } = require('./helpers/testServer');

test('startTestServer spins up a real server.js against a synthetic config and /health responds', async (t) => {
    const server = await startTestServer({ tablesText: '## Gear\n- nothing at all, hands loose and empty\n', port: 5197 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
});

test('stop() tears the process down and removes the fixture directory', async () => {
    const server = await startTestServer({ tablesText: '## Gear\n- nothing at all\n', port: 5197 });
    const { dir } = server;
    await server.stop();
    assert.equal(fs.existsSync(dir), false);
});

test('stop() still resolves when the child has already exited', async () => {
    const server = await startTestServer({ tablesText: '## Gear\n- nothing at all\n', port: 5197 });
    const { dir } = server;

    // The regression this pins: 'exit' fires exactly once. A child that had
    // already gone - crashed after readiness, OOM-killed, reaped by a CI
    // runner - never fires it a second time, so a stop() that waits only on
    // `child.once('exit')` stays pending forever inside a t.after hook and
    // stalls the runner with no output. Awaiting the real event here puts the
    // helper in exactly that state before stop() is ever called.
    server.child.kill();
    await new Promise((resolve) => server.child.once('exit', resolve));

    const outcome = await Promise.race([
        server.stop().then(() => 'stopped'),
        new Promise((resolve) => {
            const t = setTimeout(() => resolve('hung'), 3000);
            if (t.unref) t.unref();
        }),
    ]);
    assert.equal(outcome, 'stopped', 'stop() did not resolve for an already-exited child');
    assert.equal(fs.existsSync(dir), false, 'stop() resolved but left the fixture directory behind');
});
