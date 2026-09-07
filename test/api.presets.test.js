const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

/**
 * /api/table-bullets only sends the grouped shape - a flat `tables` field
 * alongside it would give the client two independent copies of every table
 * after JSON.parse, since object identity does not survive serialization.
 * Flatten back to a plain table list here for assertions that don't care
 * about grouping.
 */
function flatten(groups) {
    return groups.flatMap((g) => g.rows.map((r) => r.table));
}

const TABLES_FIXTURE = [
    '## Outfit',
    '- a heavy work jacket over a stained undersuit || civ',
    '- a graffiti-tagged cropped t-shirt and cut-off shorts || civ',
    '',
    '## Gear',
    '- nothing at all, hands loose and empty',
    '',
].join('\n');

async function toggle(server, table, text, enabled) {
    return fetch(`${server.baseUrl}/api/table-bullets/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, text, enabled }),
    });
}

async function savePreset(server, name) {
    return fetch(`${server.baseUrl}/api/presets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    });
}

test('POST /api/presets saves a snapshot of every table, listing only currently-enabled bullets', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    await toggle(server, 'Outfit', 'a graffiti-tagged cropped t-shirt and cut-off shorts || civ', false);

    const saveRes = await savePreset(server, 'Grittier Frontier');
    assert.equal(saveRes.status, 200);
    const { slug } = await saveRes.json();
    assert.equal(slug, 'grittier-frontier');

    const exportRes = await fetch(`${server.baseUrl}/api/presets/export?slug=grittier-frontier`);
    const saved = await exportRes.json();
    assert.deepEqual(saved.selected, {
        Outfit: [{ text: 'a heavy work jacket over a stained undersuit || civ', weight: 1 }],
        Gear: [{ text: 'nothing at all, hands loose and empty', weight: 1 }],
    });

    const listRes = await fetch(`${server.baseUrl}/api/presets`);
    const { presets } = await listRes.json();
    assert.equal(presets.length, 1);
    assert.equal(presets[0].slug, 'grittier-frontier');
    assert.equal(presets[0].count, 2);
});

test('POST /api/presets returns 409 for a duplicate name', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    const first = await savePreset(server, 'Same Name');
    assert.equal(first.status, 200);
    const second = await savePreset(server, 'Same Name');
    assert.equal(second.status, 409);
});

test('GET /api/presets/export downloads the raw preset JSON with a Content-Disposition header', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    await savePreset(server, 'Export Me');
    const res = await fetch(`${server.baseUrl}/api/presets/export?slug=export-me`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="export-me\.json"/);
    const data = await res.json();
    assert.equal(data.name, 'Export Me');
});

test('GET /api/presets/export returns 404 for an unknown slug', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/presets/export?slug=nope`);
    assert.equal(res.status, 404);
});

test('POST /api/presets/import previews without writing anything to disk', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    const preset = {
        name: "Someone Else's Preset",
        created: '2026-01-01T00:00:00.000Z',
        selected: {
            Outfit: [{ text: 'a heavy work jacket over a stained undersuit || civ', weight: 2 }],
            Headgear: [{ text: 'a hat that does not exist', weight: 1 }],
        },
    };
    const res = await fetch(`${server.baseUrl}/api/presets/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preset),
    });
    assert.equal(res.status, 200);
    const diff = await res.json();
    assert.deepEqual(diff.willReweight, [{ table: 'Outfit', text: 'a heavy work jacket over a stained undersuit || civ', weight: 2 }]);
    assert.deepEqual(diff.willDisable, [{ table: 'Outfit', text: 'a graffiti-tagged cropped t-shirt and cut-off shorts || civ' }]);
    assert.deepEqual(diff.notFound, [{ table: 'Headgear', text: 'a hat that does not exist' }]);

    const tablesRes = await fetch(`${server.baseUrl}/api/table-bullets`);
    const { groups } = await tablesRes.json();
    const outfit = flatten(groups).find((t) => t.name === 'Outfit');
    const jacket = outfit.bullets.find((b) => b.text === 'a heavy work jacket over a stained undersuit || civ');
    assert.equal(jacket.weight, 1, 'import must not write anything - the weight should be untouched');
});

test('POST /api/presets/apply enables and reweights bullets in a covered table, leaving an uncovered table untouched', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    await toggle(server, 'Outfit', 'a graffiti-tagged cropped t-shirt and cut-off shorts || civ', false);

    const preset = {
        name: 'Apply Me',
        created: '2026-01-01T00:00:00.000Z',
        selected: {
            Outfit: [
                { text: 'a heavy work jacket over a stained undersuit || civ', weight: 3 },
                { text: 'a graffiti-tagged cropped t-shirt and cut-off shorts || civ', weight: 1 },
            ],
        },
    };
    const res = await fetch(`${server.baseUrl}/api/presets/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preset),
    });
    assert.equal(res.status, 200);
    const diff = await res.json();
    assert.deepEqual(diff.willReweight, [{ table: 'Outfit', text: 'a heavy work jacket over a stained undersuit || civ', weight: 3 }]);
    assert.deepEqual(diff.willEnable, [{ table: 'Outfit', text: 'a graffiti-tagged cropped t-shirt and cut-off shorts || civ', weight: 1 }]);
    assert.deepEqual(diff.willDisable, []);

    const tablesRes = await fetch(`${server.baseUrl}/api/table-bullets`);
    const { groups } = await tablesRes.json();
    const tables = flatten(groups);
    const outfit = tables.find((t) => t.name === 'Outfit');
    const jacket = outfit.bullets.find((b) => b.text === 'a heavy work jacket over a stained undersuit || civ');
    assert.equal(jacket.weight, 3);
    const tee = outfit.bullets.find((b) => b.text === 'a graffiti-tagged cropped t-shirt and cut-off shorts || civ');
    assert.equal(tee.enabled, true);
    assert.equal(tee.weight, 1);
    const gear = tables.find((t) => t.name === 'Gear');
    assert.equal(gear.bullets[0].enabled, true, 'Gear was not covered by this preset and must stay untouched');
});

test('POST /api/presets/apply disables an enabled bullet the preset does not select in a table it covers', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    const preset = {
        name: 'Trim Outfit',
        created: '2026-01-01T00:00:00.000Z',
        selected: { Outfit: [{ text: 'a heavy work jacket over a stained undersuit || civ', weight: 1 }] },
    };
    const res = await fetch(`${server.baseUrl}/api/presets/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preset),
    });
    const diff = await res.json();
    assert.deepEqual(diff.willDisable, [{ table: 'Outfit', text: 'a graffiti-tagged cropped t-shirt and cut-off shorts || civ' }]);

    const tablesRes = await fetch(`${server.baseUrl}/api/table-bullets`);
    const { groups } = await tablesRes.json();
    const tables = flatten(groups);
    const outfit = tables.find((t) => t.name === 'Outfit');
    const tee = outfit.bullets.find((b) => b.text === 'a graffiti-tagged cropped t-shirt and cut-off shorts || civ');
    assert.equal(tee.enabled, false);
    const gear = tables.find((t) => t.name === 'Gear');
    assert.equal(gear.bullets[0].enabled, true, 'Gear was not covered by this preset and must stay untouched');
});

test('POST /api/presets/apply rejects a hostile weight instead of corrupting the tables file', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    const before = await (await fetch(`${server.baseUrl}/api/table-bullets`)).json();

    const preset = {
        name: 'Hostile',
        created: '2026-01-01T00:00:00.000Z',
        selected: {
            Outfit: [
                { text: 'a heavy work jacket over a stained undersuit || civ', weight: -2 },
                // Also select the tee at its current state, so the only thing this
                // preset would change is the jacket's weight - keeping the diff
                // isolated to the hostile value instead of also disabling the tee.
                { text: 'a graffiti-tagged cropped t-shirt and cut-off shorts || civ', weight: 1 },
            ],
        },
    };
    await fetch(`${server.baseUrl}/api/presets/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preset),
    });

    const after = await (await fetch(`${server.baseUrl}/api/table-bullets`)).json();
    const outfitBefore = flatten(before.groups).find((t) => t.name === 'Outfit');
    const outfitAfter = flatten(after.groups).find((t) => t.name === 'Outfit');
    assert.deepEqual(outfitAfter, outfitBefore, 'a hostile weight must not change any bullet text or weight on disk');
});

test('POST /api/presets/delete removes a saved preset', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    await savePreset(server, 'Delete Me');
    const del = await fetch(`${server.baseUrl}/api/presets/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'delete-me' }),
    });
    assert.equal(del.status, 200);
    const listRes = await fetch(`${server.baseUrl}/api/presets`);
    const { presets } = await listRes.json();
    assert.equal(presets.length, 0);
});

test('POST /api/presets/delete returns 404 for an unknown slug', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/presets/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'nope' }),
    });
    assert.equal(res.status, 404);
});

/* ---- known-issues 4: the preset format break was implemented but untested ---- */

/**
 * A preset saved before the format changed carries `{ disabled: {...} }` where
 * the current one carries `{ selected: {...} }`. The two mean opposite things,
 * so applying an old file under the new reading would enable precisely the
 * bullets it was saved to turn off. Both routes reject it and listPresets
 * reports it as covering nothing - behaviour the refinements plan promised and
 * nothing verified until now.
 */
const LEGACY_PRESET = {
    name: 'Old Format',
    created: '2026-08-01T00:00:00.000Z',
    disabled: { Outfit: ['a heavy work jacket over a stained undersuit || civ'] },
};

test('POST /api/presets/import rejects a preset in the superseded disabled-only format', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    const res = await fetch(`${server.baseUrl}/api/presets/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(LEGACY_PRESET),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /selected/);
});

test('POST /api/presets/apply rejects a preset in the superseded disabled-only format', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    const before = await (await fetch(`${server.baseUrl}/api/table-bullets`)).json();
    const res = await fetch(`${server.baseUrl}/api/presets/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(LEGACY_PRESET),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /selected/);

    // And it changed nothing on the way out.
    const after = await (await fetch(`${server.baseUrl}/api/table-bullets`)).json();
    assert.deepEqual(flatten(after.groups), flatten(before.groups));
});

test('GET /api/presets reports a legacy preset as covering nothing rather than erroring', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    // Written straight to the presets dir: the import route now refuses this
    // shape, so the only way one exists is having been saved before the
    // change - which is exactly the case listPresets has to survive.
    fs.mkdirSync(server.presetsDir, { recursive: true });
    fs.writeFileSync(path.join(server.presetsDir, 'old-format.json'),
        JSON.stringify(LEGACY_PRESET, null, 2));

    const res = await fetch(`${server.baseUrl}/api/presets`);
    assert.equal(res.status, 200);
    const { presets } = await res.json();
    const legacy = presets.find((p) => p.slug === 'old-format');
    assert.ok(legacy, 'the legacy preset should still be listed');
    assert.equal(legacy.count, 0);
});

/* ---- known-issues 1: a rejected write used to be reported as a success ---- */

test('POST /api/presets/apply reports bullets it could not write rather than claiming success', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    // A preset naming a bullet that is not in the live file at all. It lands
    // in notFound, so nothing is written for it - and the response has to say
    // so rather than returning a bare 200 the client reads as "all applied".
    const res = await fetch(`${server.baseUrl}/api/presets/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            selected: {
                Outfit: [{ text: 'a bullet that is not in this file', weight: 1 }],
                Gear: [{ text: 'nothing at all, hands loose and empty', weight: 1 }],
            },
        }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.notFound.length, 1);
    assert.equal(body.notFound[0].text, 'a bullet that is not in this file');
    assert.ok(Array.isArray(body.failed), 'the response must carry a failed list');
});

/* ---- the slug reaches path.join, so it has to be a slug ---- */

test('a traversing slug is refused rather than reaching the filesystem', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: 5198 });
    t.after(() => server.stop());

    // Both routes hand their slug to path.join(dir, slug + '.json'), so before
    // safeSlug() an export could read any .json on the box and a delete could
    // remove one. slugify() only ever emits [a-z0-9-], so no preset this app
    // can save is named anything the guard refuses - it costs nothing.
    //
    // The export route has a second reason of its own: the slug is
    // interpolated into a Content-Disposition header, so a CR or LF in it
    // injects response headers.
    const hostile = [
        '../../../../package', '..%2F..%2Fetc%2Fhosts', 'a/b', 'a\\b', '.',
        'x%0d%0aX-Injected:%20yes',
    ];
    for (const slug of hostile) {
        const exported = await fetch(
            `${server.baseUrl}/api/presets/export?slug=${slug}`);
        assert.equal(exported.status, 404, `export should refuse ${slug}`);
        assert.equal(exported.headers.get('x-injected'), null,
            'no header may be injected through the slug');

        const deleted = await fetch(`${server.baseUrl}/api/presets/delete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug }),
        });
        assert.equal(deleted.status, 404, `delete should refuse ${slug}`);
    }

    // And an ordinary slug still works, so the guard is a guard and not a ban.
    await fetch(`${server.baseUrl}/api/presets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Guard check' }),
    });
    const ok = await fetch(`${server.baseUrl}/api/presets/export?slug=guard-check`);
    assert.equal(ok.status, 200);
});
