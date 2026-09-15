const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { startTestServer } = require('./helpers/testServer');

/*
 * Secret mode's own tables end to end: the authenticated listing the form is
 * built from, the argv the private create path builds from a selection, and
 * the refusals - on the public path, for a file or table the folder does not
 * hold, and for a default table the generator will not switch off.
 *
 * The generator is a stub that echoes its argv (see api.createArgs.test.js)
 * and carries the two constants lib/overrideTables.js scrapes in a comment,
 * so the disableable list comes from the same parse production uses.
 */

const PORT = 5401;
const STUB = [
    '/*',
    'REROLLABLE_TRAITS = ("Gear",)',
    'DISABLEABLE_TABLES = (',
    '    "Stance", "Weapon",',
    ')',
    '*/',
    'console.log(process.argv.slice(2).join(" "));',
].join('\n');

async function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-tables-api-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const privateDir = path.join(root, 'private'); fs.mkdirSync(privateDir);
    const tablesDir = path.join(root, 'secret-tables'); fs.mkdirSync(tablesDir);
    fs.writeFileSync(path.join(tablesDir, 'a.json'), JSON.stringify({
        one: [{ value: 'first', weight: 1 }], two: [{ value: 'second' }],
    }));
    fs.writeFileSync(path.join(tablesDir, 'b.md'), '## mood\n\n- x2 harsh light\n- soft light\n');
    fs.writeFileSync(path.join(tablesDir, 'bad.json'), '{');
    const salt = '0123456789abcdef0123456789abcdef';
    const passwordHash = `scrypt$${salt}$${crypto.scryptSync('test-password', salt, 64).toString('hex')}`;
    const server = await startTestServer({ tablesText: '## Gear\n- a tool\n', port: PORT, generatorSource: STUB,
        extraConfig: { secretImagesDir: privateDir, secretTablesDir: tablesDir, secretMode: { username: 'tester', passwordHash } } });
    t.after(() => server.stop());
    let cookie = '';
    const call = (route, body, authenticated = false) => fetch(server.baseUrl + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const login = await call('/api/secret/login', { username: 'tester', password: 'test-password' });
    assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0];
    async function createLog(body) {
        const res = await call('/api/secret/create', { dryRun: true, count: 1, ...body }, true);
        const text = await res.text();
        assert.equal(res.status, 202, text);
        const { jobId } = JSON.parse(text);
        let job;
        for (let i = 0; i < 50; i++) {
            job = await (await call('/api/secret/create-status?jobId=' + jobId, undefined, true)).json();
            if (job.status !== 'running') return job.log;
            await new Promise((r) => setTimeout(r, 40));
        }
        throw new Error('create job never finished');
    }
    return { call, createLog, tablesDir };
}

test('the listing needs a session and reports files, tables, counts, errors and the disableable set', async (t) => {
    const { call, tablesDir } = await setup(t);
    assert.equal((await call('/api/secret/tables')).status, 401);
    const res = await call('/api/secret/tables', undefined, true);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const data = await res.json();
    assert.equal(data.dir, tablesDir);
    assert.equal(data.exists, true);
    assert.deepEqual(data.disableable, ['Stance', 'Weapon']);
    assert.deepEqual(data.files.map((f) => f.file), ['a.json', 'b.md', 'bad.json']);
    assert.deepEqual(data.files[0].tables, [{ name: 'one', count: 1 }, { name: 'two', count: 1 }]);
    assert.deepEqual(data.files[1].tables, [{ name: 'mood', count: 2 }]);
    assert.match(data.files[2].error, /not valid JSON/);
});

test('a selection becomes --extra-tables, --extra-table and --disable-table on the private create', async (t) => {
    const { createLog, tablesDir } = await setup(t);
    const whole = await createLog({ extraTables: [{ file: 'a.json' }, { file: 'b.md', tables: ['mood'] }], disabledTables: ['Stance'] });
    assert.ok(whole.includes(`--extra-tables ${path.join(tablesDir, 'a.json')} --extra-tables ${path.join(tablesDir, 'b.md')}`), whole);
    // Every table of every file was wanted, so nothing is narrowed.
    assert.doesNotMatch(whole, /--extra-table /);
    assert.match(whole, /--disable-table Stance/);
    assert.match(whole, /--secret --secret-config/);

    // One file narrowed means every wanted table is named, from every file:
    // the generator's --extra-table filters across all loaded files at once.
    const narrowed = await createLog({ extraTables: [{ file: 'a.json', tables: ['two'] }, { file: 'b.md' }] });
    assert.match(narrowed, /--extra-table two --extra-table mood/);
    assert.doesNotMatch(narrowed, /--disable-table/);

    // Nothing ticked is an ordinary private roll.
    const plain = await createLog({ extraTables: [], disabledTables: [] });
    assert.doesNotMatch(plain, /--extra-table|--disable-table/);
});

test('the public path, an unknown file, a bad file, an unknown table and a structural table are refused', async (t) => {
    const { call } = await setup(t);
    const publicRes = await call('/api/create-npc', { dryRun: true, count: 1, extraTables: [{ file: 'a.json' }] });
    assert.equal(publicRes.status, 400);
    assert.match((await publicRes.json()).error, /Secret mode only/);
    const publicDisable = await call('/api/create-npc', { dryRun: true, count: 1, disabledTables: ['Stance'] });
    assert.equal(publicDisable.status, 400);
    for (const [body, pattern] of [
        [{ extraTables: [{ file: '../a.json' }] }, /unknown secret tables file/],
        [{ extraTables: [{ file: 'missing.json' }] }, /unknown secret tables file "missing.json"/],
        [{ extraTables: [{ file: 'bad.json' }] }, /bad.json: not valid JSON/],
        [{ extraTables: [{ file: 'a.json', tables: ['nope'] }] }, /a.json has no table "nope"/],
        [{ extraTables: [{ file: 'a.json', tables: [] }] }, /no tables selected/],
        [{ disabledTables: ['Role'] }, /cannot disable table "Role"/],
        [{ kind: 'spaceship', extraTables: [{ file: 'a.json' }] }, /not a spaceship field|isn't supported/],
    ]) {
        const res = await call('/api/secret/create', { dryRun: true, count: 1, ...body }, true);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.match((await res.json()).error, pattern, JSON.stringify(body));
    }
});
