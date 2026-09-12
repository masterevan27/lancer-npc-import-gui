/**
 * Preset save/export/import logic for the Tables tab. A preset is a full
 * snapshot, at the moment it's saved, of every table that existed in
 * npc-generator-tables.md and every bullet that was enabled in each one:
 * { name, created, selected: { [table]: Array<{ text, weight }> } }.
 * Every table gets a key, even one with an empty array (every bullet
 * disabled at save time) - that's what "covers" it.
 *
 * Applying a preset treats it as the definitive configuration for every
 * table it covers: bullets it lists get enabled at their listed weight,
 * and any other bullet currently enabled in that same table gets
 * disabled. A table that didn't exist yet when the preset was saved has
 * no key in `selected` and is left completely untouched by apply - this
 * is what keeps an old preset safe to apply after you've added whole new
 * tables later.
 */

const fs = require('node:fs');
const path = require('node:path');
const tableFlags = require('./tableFlags');
const { referenceTargetOf } = require('./tableBullets');

function slugify(name) {
    return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function snapshotSelected(parsedTables) {
    const out = {};
    for (const table of parsedTables) {
        out[table.name] = table.bullets
            .filter((b) => b.enabled)
            .map((b) => ({ text: b.text, weight: b.weight }));
    }
    return out;
}

/**
 * The identity a preset matches a bullet on: its text WITHOUT the `||` flags.
 *
 * A preset stores each selected bullet's full text, flags included, and that
 * was a complete identity right up until the Tables tab learned to edit
 * flags. Now it isn't: flagging a hat `crown` rewrites the very string every
 * saved preset is holding, so an exact match would report the bullet as
 * `notFound` and - because apply is a whitelist - promptly disable it. Every
 * preset saved before a flag edit would quietly delete the bullet it edited.
 *
 * Matching on the prose instead makes a preset survive a flag edit, which is
 * the behaviour anyone would expect: a preset is a statement about WHICH
 * bullets are in play, and a flag is not part of that choice.
 *
 * Collisions are possible in principle - two bullets in one table whose prose
 * is identical and whose flags differ - and are resolved first-wins, the same
 * rule the writers in lib/tableBullets.js already follow for a table carrying
 * the same text twice. See docs/known-issues.md.
 */
function bulletKey(tableName, text) {
    return tableFlags.splitBulletFlags(tableName, text).body;
}

function diffPresetAgainstTables(presetSelected, parsedTables) {
    const byTable = new Map(parsedTables.map((t) => [t.name, t.bullets]));
    const willEnable = [];
    const willDisable = [];
    const willReweight = [];
    const alreadyMatching = [];
    const notFound = [];

    for (const [table, entries] of Object.entries(presetSelected || {})) {
        const bullets = byTable.get(table);
        if (!bullets) {
            for (const { text } of entries) notFound.push({ table, text });
            continue;
        }
        // Keyed on the flag-stripped body throughout, so a preset written
        // before a flag edit still resolves to the bullet it named. The diff
        // entries below carry the bullet's CURRENT full text, because that is
        // what the writers in lib/tableBullets.js match on.
        const selected = new Map(entries.map((e) => [bulletKey(table, e.text), e.weight]));
        const liveKeys = new Set(bullets.map((b) => bulletKey(table, b.text)));
        for (const { text } of entries) {
            if (!liveKeys.has(bulletKey(table, text))) notFound.push({ table, text });
        }
        // One diff entry per unique bullet text, not per matching line. The
        // writers in lib/tableBullets.js resolve a bullet to its FIRST
        // matching line, so where a table carries the same text twice only
        // one copy can be changed at all - walking both made the preview
        // promise two changes for an apply that performs one, and the second
        // apply call then found the first line already in the requested state
        // and returned early having changed nothing. Taking the first copy
        // and skipping the rest describes exactly what the writers will do.
        const seen = new Set();
        for (const bullet of bullets) {
            const key = bulletKey(table, bullet.text);
            if (seen.has(key)) continue;
            seen.add(key);
            if (!selected.has(key)) {
                // A '=> Name' reference is one slot standing for a whole table.
                // A preset saved before that table existed lists neither the
                // reference nor the group, and says nothing about entering it
                // - so it is left as it is, the way a table the preset never
                // saw is left as it is. Only a preset that covers the group
                // and still omits the reference is asking to switch it off.
                const target = referenceTargetOf(table, bullet.text);
                const knowsGroup = target && Object.keys(presetSelected || {})
                    .some((k) => k === target || k.startsWith(`${target} (`));
                if (target && !knowsGroup) {
                    alreadyMatching.push({ table, text: bullet.text });
                    continue;
                }
                if (bullet.enabled) willDisable.push({ table, text: bullet.text });
                else alreadyMatching.push({ table, text: bullet.text });
                continue;
            }
            const wantWeight = selected.get(key) ?? 1;
            if (!bullet.enabled) {
                willEnable.push({ table, text: bullet.text, weight: wantWeight });
            } else if (bullet.weight !== wantWeight) {
                willReweight.push({ table, text: bullet.text, weight: wantWeight });
            } else {
                alreadyMatching.push({ table, text: bullet.text });
            }
        }
    }
    return { willEnable, willDisable, willReweight, alreadyMatching, notFound };
}

function presetFile(dir, slug) {
    return path.join(dir, `${slug}.json`);
}

function presetExists(dir, slug) {
    return fs.existsSync(presetFile(dir, slug));
}

function readPreset(dir, slug) {
    const file = presetFile(dir, slug);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writePreset(dir, slug, presetObject) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(presetFile(dir, slug), JSON.stringify(presetObject, null, 2));
}

function deletePreset(dir, slug) {
    const file = presetFile(dir, slug);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
}

function listPresets(dir) {
    let files;
    try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
    const out = files.map((f) => {
        const slug = f.slice(0, -'.json'.length);
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const count = Object.values(data.selected || {}).reduce((n, arr) => n + arr.length, 0);
        return { name: data.name, slug, created: data.created, count };
    });
    out.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));
    return out;
}

module.exports = {
    slugify, snapshotSelected, diffPresetAgainstTables,
    listPresets, presetExists, readPreset, writePreset, deletePreset,
};
