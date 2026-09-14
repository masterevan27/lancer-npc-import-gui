const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dynamic = require('../lib/dynamicBackgrounds');

function fixture(t, source) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-bg-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const script = path.join(root, 'generator.js');
    fs.writeFileSync(script, source);
    const tables = path.join(root, 'tables.md');
    fs.writeFileSync(tables, '## Location\n- a hangar\n');
    const jobs = new Map();
    const service = dynamic.createService({ script, tables, root, executable: process.execPath, jobs });
    return { root, script, tables, jobs, service };
}

async function settled(jobs, id) {
    for (let i = 0; i < 200; i += 1) {
        if (jobs.get(id).status !== 'running') return jobs.get(id);
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail('job never settled');
}

test('preview passes Unicode and multiline scene requests through stdin', async (t) => {
    const { service } = fixture(t, "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>console.log(JSON.stringify({plans:[JSON.parse(s)]})))");
    const request = { environment: 'indoor', notes: '灯光\nKeep $() literal', seed: 42 };
    assert.deepEqual((await service.preview(request)).plans, [request]);
});

test('reject unsafe dimensions, seeds, counts, contexts and malformed traits before spawn', () => {
    for (const bad of [{ width: 0 }, { height: 9000 }, { count: 9 }, { seed: 2 ** 32 },
        { seed: -1 }, { environment: 'wat' }, { traits: [] }, { locked: 'Location' },
        { view: 'tilted' }, { notes: 'a'.repeat(4001) }, null]) {
        assert.throws(() => dynamic.validateRequest(bad));
    }
    assert.doesNotThrow(() => dynamic.validateRequest({ environment: 'space', seed: 0, count: 8, width: 1920, height: 1080 }));
});

test('render tracks only explicitly reported files inside its root, even on partial failure', async (t) => {
    const source = `const fs=require('node:fs'),path=require('node:path');
    const args=process.argv.slice(2);const root=args[args.indexOf('--output-dir')+1];
    let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{
      const file=path.join(root,'result.png');fs.writeFileSync(file,'PNG');
      console.log('BACKGROUND_RESULT '+JSON.stringify({path:file}));
      console.log('BACKGROUND_RESULT '+JSON.stringify({path:path.join(root,'..','outside.png')}));
      console.error('second image failed');process.exitCode=1;
    });`;
    const { service, jobs } = fixture(t, source);
    const { jobId } = service.render({ plans: [{ seed: 1 }] });
    const job = await settled(jobs, jobId);
    assert.equal(job.status, 'error');
    assert.equal(job.produced, 1);
    assert.deepEqual(job.producedIds, ['bg:result.png']);
    assert.match(job.error, /second image failed/);
});

test('a successful process that writes no images is a failed render', async (t) => {
    const { service, jobs } = fixture(t, "process.stdin.resume();process.stdin.on('end',()=>console.log('nothing'));");
    const { jobId } = service.render({ plans: [] });
    assert.equal((await settled(jobs, jobId)).status, 'error');
});

test('battlemap rejects traversal and serializes requests for the same source', async (t) => {
    const { service, jobs, root } = fixture(t, "setTimeout(()=>process.exit(1),150);");
    fs.writeFileSync(path.join(root, 'source.png'), 'PNG');
    assert.throws(() => service.battlemap({ rel: '../outside.png' }), /inside|source/);
    const result = service.battlemap({ rel: 'source.png', width: 1024, height: 1024, seed: 1 });
    assert.throws(() => service.battlemap({ rel: 'source.png' }), /already/);
    assert.throws(() => service.battlemap({ rel: './source.png' }), /already/);
    assert.equal(service.mapJob('./source.png').jobId, result.jobId);
    await settled(jobs, result.jobId);
    assert.doesNotThrow(() => service.battlemap({ rel: 'source.png' }));
    await settled(jobs, service.mapJob('source.png').jobId);
});

test('malformed sidecars are ignored and battlemap lookup is tied to the actual source', (t) => {
    const { service, root } = fixture(t, '');
    const source = path.join(root, 'a.png');
    fs.writeFileSync(source, 'PNG');
    fs.writeFileSync(path.join(root, 'a.background.json'), '{broken');
    assert.equal(service.metadata('a.png'), null);
    const map = path.join(root, 'a Battlemap-1.png');
    fs.writeFileSync(map, 'PNG');
    fs.writeFileSync(dynamic.metadataPath(map), JSON.stringify({ kind: 'battlemap', source: { path: source, mtime: 0 } }));
    const maps = service.mapsFor('a.png');
    assert.equal(maps.length, 1);
    assert.equal(maps[0].stale, true);
    assert.deepEqual(service.mapsFor('b.png'), []);
});

test('gallery shares a directory scan across source images', (t) => {
    const { service, root } = fixture(t, '');
    for (const name of ['a.png', 'b.png']) fs.writeFileSync(path.join(root, name), 'PNG');
    const original = fs.readdirSync;
    let scans = 0;
    t.mock.method(fs, 'readdirSync', (...args) => { scans += 1; return original(...args); });
    const cache = new Map();
    service.mapsFor('a.png', cache); service.mapsFor('b.png', cache);
    assert.equal(scans, 1);
});
