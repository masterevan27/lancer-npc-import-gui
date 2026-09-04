const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '',
    '## Gear',
    '- a battered data-slate',
    '',
].join('\n');

// A stub standing in for generate-npc.py: it echoes its own argv so the test
// can assert on the command line the server built, without needing Python,
// a ComfyUI server, or any interpreter beyond the Node binary already
// running this test (startTestServer runs it via process.execPath).
const STUB = 'console.log(process.argv.slice(2).join(" "));\n';

async function runCreate(server, body) {
    const res = await fetch(`${server.baseUrl}/api/create-npc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const { jobId } = await res.json();
    // Poll until the stub exits and its output is captured.
    for (let i = 0; i < 50; i++) {
        const status = await fetch(`${server.baseUrl}/api/create-status?jobId=${jobId}`);
        const job = await status.json();
        if (job.status !== 'running') return job.log;
        await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error('create job never finished');
}

test('the unarmed checkbox adds --unarmed', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: 5193, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const log = await runCreate(server, { count: 1, unarmed: true, dryRun: true });
    assert.match(log, /--unarmed/);
});

test('an unchecked box adds nothing', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: 5193, generatorSource: STUB,
    });
    t.after(() => server.stop());

    const log = await runCreate(server, { count: 1, dryRun: true });
    assert.doesNotMatch(log, /--unarmed/);
});
