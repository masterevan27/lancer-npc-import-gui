const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

// The detail sheet could show an NPC's art but never said where on disk that
// art was. The files are the point of the whole review flow - they get opened
// in an editor, handed to a player, or dropped into a VTT by hand - and the
// only route to them was to guess the generator's <category>/<name> nesting
// from the NPC's name and role.
//
// itemView() withheld the path deliberately: the browser is served
// /api/image?id=... URLs and the importer contract exposes no disk paths at
// all. What is pinned here is the narrow widening of that - the folder and the
// two bare filenames, on /api/items only - and, more importantly, that the
// folder stays honest. Importing an NPC copies its files under foundryDataRoot
// and repoints the manifest key at the copy, so a path captured at generate
// time would start lying the moment the user imported.
const PORT = 5213;

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '',
].join('\n');

const PORTRAIT = 'Vera Sokolova Portrait.png';
const TOKEN = 'Vera Sokolova Token.png';

/**
 * One NPC on disk, keyed by absolute folder path the way generate-npc.py
 * writes its manifest. The art is written for real because /api/import only
 * copies files that exist, and this file asserts on where they land.
 */
function seedNpc(dir, { name = 'Vera Sokolova', category = 'Military', token = true } = {}) {
    const folder = path.join(dir, 'output', category, name);
    fs.mkdirSync(folder, { recursive: true });
    const files = [PORTRAIT, ...(token ? [TOKEN] : [])];
    for (const file of files) fs.writeFileSync(path.join(folder, file), 'png');
    return {
        folder,
        manifest: {
            [folder]: {
                id: 'npc-vera-1',
                kind: 'npc',
                name,
                when: '2026-09-04 09:00:00',
                traits: { Role: 'a courier' },
                portrait: PORTRAIT,
                ...(token ? { token: TOKEN } : {}),
                files,
            },
        },
    };
}

async function firstItem(server) {
    const res = await fetch(`${server.baseUrl}/api/items?category=npc`);
    assert.equal(res.status, 200);
    const { items } = await res.json();
    assert.equal(items.length, 1, 'fixture should describe exactly one NPC');
    return items[0];
}

test('an item reports the folder its art lives in, and the two filenames', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const { folder, manifest } = seedNpc(server.dir);
    fs.writeFileSync(server.manifestPath, JSON.stringify(manifest));

    const item = await firstItem(server);
    assert.equal(item.folderPath, folder);
    assert.equal(item.portraitFile, PORTRAIT);
    assert.equal(item.tokenFile, TOKEN);
});

test('a missing token reports null rather than a path into nothing', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const { manifest } = seedNpc(server.dir, { token: false });
    fs.writeFileSync(server.manifestPath, JSON.stringify(manifest));

    const item = await firstItem(server);
    assert.equal(item.portraitFile, PORTRAIT);
    assert.equal(item.tokenFile, null);
});

test('the folder follows the art into foundryDataRoot on import', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const { folder, manifest } = seedNpc(server.dir);
    fs.writeFileSync(server.manifestPath, JSON.stringify(manifest));
    assert.equal((await firstItem(server)).folderPath, folder, 'precondition');

    const res = await fetch(`${server.baseUrl}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['npc-vera-1'] }),
    });
    assert.equal(res.status, 200, await res.text());

    const item = await firstItem(server);
    assert.notEqual(item.folderPath, folder, 'still names the review folder after an import');
    assert.ok(
        item.folderPath.startsWith(path.join(server.dir, 'FoundryData')),
        `imported folder should sit under foundryDataRoot, got ${item.folderPath}`);
    assert.ok(
        fs.existsSync(path.join(item.folderPath, item.portraitFile)),
        'the folder and filename it reports do not name a file that exists');
});
