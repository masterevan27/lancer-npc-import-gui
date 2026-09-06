const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

// The banner over a finished create run used to count the NPCs the form asked
// for, because that was the only number anyone had: the job record carried a
// status, a log and a dry-run flag, no measurement of any kind, and "done"
// meant nothing more than exit code 0. A run that dropped a ComfyUI job, or
// swallowed a per-NPC error, or wrote nothing at all still announced the full
// batch. So the server now takes a snapshot of the manifest's NPC entries
// either side of the child and reports how many are new, and /api/create-status
// hands that back as `produced` - null where it could not be measured, which
// the client tells apart from a measured zero. These tests drive the real route
// with a stub generator that writes manifest entries itself, the way
// generate-npc.py does.
//
// The same snapshot also names those NPCs, as `producedIds`, and the reason is
// the banner's dismiss button rather than anything the count could not say.
// That button clears the New tag, and the only tags it may clear are the ones
// the banner is announcing: a library can be holding NPCs rolled at the command
// line while this server was down, which the seed-once store deliberately keeps
// flagged across a reboot, and nothing in the UI can put a tag back once it is
// gone. So the run has to be able to name what it produced, and one of the
// tests below is the one that matters: an unrelated unseen NPC still reports
// isNew once the run's own ids have been cleared.
const PORT = 5208;

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '',
].join('\n');

/**
 * Source for a stub standing in for generate-npc.py. It merges `names` into the
 * fixture manifest - merging rather than replacing, so a test can seed a
 * pre-existing NPC and still see only the new ids counted - then exits with
 * `exitCode`. The manifest sits beside the stub in the fixture directory (see
 * startTestServer), so __dirname finds it without the config being read here.
 * Entry shape copied from api.model3d.test.js's seedNpc.
 */
function stubWriting(names, exitCode = 0) {
    return [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'const manifestPath = path.join(__dirname, ".generated-npcs.json");',
        'let manifest = {};',
        'try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch {}',
        `for (const name of ${JSON.stringify(names)}) {`,
        '  manifest[path.join(__dirname, "output", "Pilots", name)] = {',
        '    id: `npc-${name.replace(/ /g, "-")}-1`,',
        '    kind: "npc",',
        '    name,',
        '    when: "2026-09-05T01-33-00",',
        '    traits: { Role: "a dockworker" },',
        '    portrait: `${name} Portrait.png`,',
        '    files: [`${name} Portrait.png`],',
        '  };',
        '}',
        'fs.writeFileSync(manifestPath, JSON.stringify(manifest));',
        'console.log(process.argv.slice(2).join(" "));',
        `process.exit(${exitCode});`,
    ].join('\n');
}

/**
 * Source for a stub that writes one manifest entry with the folder and the id
 * spelled out separately, rather than deriving one from the other the way
 * stubWriting does. generate-npc.py keys the manifest by folder while minting
 * the id as "npc-<slug>-<seed>" from the name and the seed alone, so rolling
 * the same name and seed twice - which the Create form invites, since changing
 * one override and regenerating to compare is the obvious way to use it - gives
 * a second folder, suffixed "Name (2)" by npc_folder(), under an id that is
 * already in the manifest. The GUI never passes --overwrite, so both survive.
 */
function stubWritingEntry({ folder, id, name }) {
    return [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'const manifestPath = path.join(__dirname, ".generated-npcs.json");',
        'let manifest = {};',
        'try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch {}',
        `manifest[path.join(__dirname, "output", "Pilots", ${JSON.stringify(folder)})] = {`,
        `  id: ${JSON.stringify(id)},`,
        '  kind: "npc",',
        `  name: ${JSON.stringify(name)},`,
        '  when: "2026-09-05T02-10-00",',
        '  traits: { Role: "a dockworker" },',
        `  portrait: ${JSON.stringify(`${name} Portrait.png`)},`,
        `  files: [${JSON.stringify(`${name} Portrait.png`)}],`,
        '};',
        'fs.writeFileSync(manifestPath, JSON.stringify(manifest));',
        'console.log(process.argv.slice(2).join(" "));',
    ].join('\n');
}

/** A stub that reports the argv it was given and writes no manifest entry. */
const STUB_WRITES_NOTHING = 'console.log(process.argv.slice(2).join(" "));\n';

/** Seed an NPC into the fixture manifest, as if an earlier run had made it. */
function seedNpc(server, name) {
    fs.writeFileSync(path.join(server.dir, '.generated-npcs.json'), JSON.stringify({
        [path.join(server.dir, 'output', 'Pilots', name)]: {
            id: `npc-${name.replace(/ /g, '-')}-0`,
            kind: 'npc',
            name,
            when: '2026-09-04T09-00-00',
            traits: { Role: 'a courier' },
            portrait: `${name} Portrait.png`,
            files: [`${name} Portrait.png`],
        },
    }));
}

async function runCreate(server, body) {
    const res = await fetch(`${server.baseUrl}/api/create-npc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const { jobId } = await res.json();
    // Poll until the stub exits, exactly as api.createArgs.test.js does.
    for (let i = 0; i < 50; i++) {
        const status = await fetch(`${server.baseUrl}/api/create-status?jobId=${jobId}`);
        const job = await status.json();
        if (job.status !== 'running') return job;
        await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error('create job never finished');
}

test('a run that writes two NPCs reports two', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT,
        generatorSource: stubWriting(['Jules Sokolova', 'Rasa Mbeki']),
    });
    t.after(() => server.stop());

    const job = await runCreate(server, { count: 2 });
    assert.equal(job.status, 'done');
    assert.equal(job.produced, 2);
    assert.deepEqual(
        [...job.producedIds].sort(), ['npc-Jules-Sokolova-1', 'npc-Rasa-Mbeki-1'],
        'the run reported a count but could not say which NPCs it produced');
});

test('a run that exits clean having written nothing reports zero, not the count asked for', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB_WRITES_NOTHING,
    });
    t.after(() => server.stop());

    // The case the whole change exists for: three NPCs requested, none written,
    // exit code 0. The client raises no banner for a measured zero.
    const job = await runCreate(server, { count: 3 });
    assert.equal(job.status, 'done');
    assert.equal(job.produced, 0);
});

test('only ids new since the run started are counted', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT,
        generatorSource: stubWriting(['Rasa Mbeki']),
    });
    t.after(() => server.stop());

    seedNpc(server, 'Jules Sokolova');

    const job = await runCreate(server, { count: 1 });
    assert.equal(job.status, 'done');
    assert.equal(job.produced, 1, 'the pre-existing NPC was counted as newly produced');
    assert.deepEqual(
        job.producedIds, ['npc-Rasa-Mbeki-1'],
        'the pre-existing NPC was named among the ones this run produced');
});

test('a re-roll of the same name and seed counts, even though it reuses the id', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT,
        // Second run, same name and seed: same id, folder suffixed by
        // npc_folder() because the first one is still on disk.
        generatorSource: stubWritingEntry({
            folder: 'Vera Kade (2)', id: 'npc-vera-kade-12345', name: 'Vera Kade',
        }),
    });
    t.after(() => server.stop());

    // The first run, already in the manifest under the unsuffixed folder.
    fs.writeFileSync(server.manifestPath, JSON.stringify({
        [path.join(server.dir, 'output', 'Pilots', 'Vera Kade')]: {
            id: 'npc-vera-kade-12345',
            kind: 'npc',
            name: 'Vera Kade',
            when: '2026-09-05T01-40-00',
            traits: { Role: 'a courier' },
            portrait: 'Vera Kade Portrait.png',
            files: ['Vera Kade Portrait.png'],
        },
    }));

    const job = await runCreate(server, { count: 1, name: 'Vera Kade', seed: 12345 });
    assert.equal(job.status, 'done');
    // Counting distinct ids answers 0 here, and the client would report a run
    // that detected nothing over an NPC that is on disk with its art beside it.
    // The manifest is keyed by folder, so its keys are what the run added.
    assert.equal(job.produced, 1, 'a second folder under an existing id was not counted');
    // One id, because both folders wear it - the client posts these to
    // /api/seen, where a duplicate would be a wasted entry rather than a bug,
    // but a list that says "two NPCs" while the banner says one would be.
    assert.deepEqual(job.producedIds, ['npc-vera-kade-12345']);
});

test('a re-roll of the same name and seed is flagged new, even though the id was already seen', async (t) => {
    // The other half of the collision above. `produced` counts folders while
    // isNew asks about ids, so the second folder is counted by one and
    // dismissed by the other: the banner says "1 new NPC finished generating"
    // while the grid draws no New pill on anything, /api/unseen lists nothing,
    // and "Show new NPCs" arrives at a page with nothing to point at. Whatever
    // the id says, a run's own output is new, so the job un-sees what it wrote.
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT,
        generatorSource: stubWritingEntry({
            folder: 'Vera Kade (2)', id: 'npc-vera-kade-12345', name: 'Vera Kade',
        }),
    });
    t.after(() => server.stop());

    // The first run, already in the manifest under the unsuffixed folder.
    fs.writeFileSync(server.manifestPath, JSON.stringify({
        [path.join(server.dir, 'output', 'Pilots', 'Vera Kade')]: {
            id: 'npc-vera-kade-12345',
            kind: 'npc',
            name: 'Vera Kade',
            when: '2026-09-05T01-40-00',
            traits: { Role: 'a courier' },
            portrait: 'Vera Kade Portrait.png',
            files: ['Vera Kade Portrait.png'],
        },
    }));

    // That first Vera Kade, opened: the id is in the seen store before the
    // second run starts, which is the ordinary state of an NPC the user is
    // regenerating to compare against.
    const seen = await fetch(`${server.baseUrl}/api/seen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['npc-vera-kade-12345'] }),
    });
    assert.equal(seen.status, 200);

    const job = await runCreate(server, { count: 1, name: 'Vera Kade', seed: 12345 });
    assert.equal(job.status, 'done');
    assert.equal(job.produced, 1);

    const res = await fetch(`${server.baseUrl}/api/items?category=npc`);
    const items = (await res.json()).items;
    assert.equal(items.length, 2, 'the second folder never reached the manifest, so this proves nothing');
    for (const item of items) {
        assert.equal(
            item.isNew, true,
            'a run announced as new produced a card the grid draws as already seen');
    }
    // Both folders wear the one id, so the store had one thing to forget while
    // the grid has two cards to flag. /api/unseen answers per manifest entry,
    // which is what makes its count match what the user is looking at rather
    // than the number of distinct ids behind it.
    const unseen = await (await fetch(`${server.baseUrl}/api/unseen`)).json();
    assert.equal(unseen.count, 2);
    assert.deepEqual([...new Set(unseen.ids)], ['npc-vera-kade-12345']);
});

test('a dry run measures nothing', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, generatorSource: STUB_WRITES_NOTHING,
    });
    t.after(() => server.stop());

    const job = await runCreate(server, { count: 2, dryRun: true });
    assert.equal(job.status, 'done');
    assert.match(job.log, /--dry-run/, 'the preview run did not reach the generator as --dry-run');
    // null, not 0: a preview writes no manifest entries by design, so counting
    // them says nothing about it, and the client stays silent for a dry run
    // regardless. producedIds is null on the same terms rather than [], which
    // the client would be entitled to read as a measured empty run.
    assert.equal(job.produced, null);
    assert.equal(job.producedIds, null);
});

test('a failed run measures nothing', async (t) => {
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT,
        generatorSource: stubWriting(['Jules Sokolova'], 3),
    });
    t.after(() => server.stop());

    const job = await runCreate(server, { count: 1 });
    assert.equal(job.status, 'error');
    assert.equal(job.produced, null, 'a failed run should not claim a produced count');
    assert.equal(job.producedIds, null, 'a failed run should not claim to have produced any NPC');
});

test('dismissing the banner clears the run it announces and leaves the rest of the library flagged', async (t) => {
    // The whole reason producedIds exists, played out end to end: a library
    // holding NPCs the user has not looked at, one GUI run finishing on top of
    // them, and the run's banner being dismissed.
    //
    // No manifest at startup, so the seen store seeds empty and everything
    // written afterwards is genuinely new - the fresh-install shape, and the
    // cheapest way to get an honestly unseen NPC into the fixture.
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, manifest: null,
        generatorSource: stubWriting(['Rasa Mbeki']),
    });
    t.after(() => server.stop());

    // Rolled at the command line while this server was down, or before it was
    // started: unseen, and flagged New precisely because the store is seeded
    // once ever rather than once per boot.
    seedNpc(server, 'Jules Sokolova');

    const job = await runCreate(server, { count: 1 });
    assert.equal(job.status, 'done');
    assert.deepEqual(job.producedIds, ['npc-Rasa-Mbeki-1']);

    // What the banner's × posts: the run's own ids, and not `{ all: true }`.
    // The server resolves `all` to every id in the manifest, which at this
    // moment would take Jules Sokolova's tag with it, over a banner that said
    // "1 new NPC finished generating", with no undo and no way to re-flag him.
    const seen = await fetch(`${server.baseUrl}/api/seen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: job.producedIds }),
    });
    assert.equal(seen.status, 200);

    const res = await fetch(`${server.baseUrl}/api/items?category=npc`);
    const isNewByName = Object.fromEntries((await res.json()).items.map((i) => [i.name, i.isNew]));
    assert.deepEqual(isNewByName, {
        'Jules Sokolova': true,
        'Rasa Mbeki': false,
    }, 'dismissing a one-NPC banner cleared a tag that banner was not announcing');
});
