/**
 * Preset save/export/import logic for the Create NPC form, the sibling of
 * lib/presets.js. Where a Tables preset snapshots which bullets are enabled,
 * a Create preset snapshots the form itself - count, seed, pronouns, server,
 * the four flag checkboxes and the trait overrides - so "frontier medic run"
 * or "zero-g salvage crew" can be rebuilt in one click instead of being
 * retyped, override rows and all, every session. On disk:
 * { name, created, kind: 'create-form', settings: { ... } }.
 *
 * The single-NPC `name` field is deliberately absent from `settings`. A preset
 * is a recipe, and a character's name is the one part of a run that is not
 * reusable: saving "frontier medics" while Sgt. Vance happened to be in the
 * name box and then restoring it a month later would quietly generate a second
 * Vance, which is exactly the sort of duplicate that only gets noticed after
 * the portraits are rendered. Leaving it out costs a GM one field of typing on
 * the runs where they actually want a fixed name. `seed` IS kept, nullable,
 * because reproducing an exact roll is a real want and a seed names a roll
 * rather than a character.
 *
 * The `kind` discriminator exists because both preset flavours are JSON files
 * with a `name` and a `created` stamp sitting in adjacent directories, and a
 * user will drop one on the other tab's Import button. Without a check that
 * lands as a Create form with every field back at its default and no error at
 * all - the import "worked". A Tables preset carries `selected` and no
 * `settings`; a Create preset is the reverse; validatePresetFile refuses the
 * wrong one by name so the message says which file this is and which tab
 * wants it.
 */

const fs = require('node:fs');
const path = require('node:path');
const { slugify } = require('./presets');

// Shared with the Tables presets rather than reimplemented, because both
// flavours name their files after the preset and a user comparing the two
// directories will read a different slug for the same typed name as a bug.
// Two copies of that regex is also two places to fix when it is wrong.

const MIN_COUNT = 1;
// generate-npc.py will happily accept --count 100000 and then spend a night
// rendering; a preset is a stored value that nobody re-reads before applying,
// so a typo'd or hand-edited count is clamped here instead of being handed to
// the child process. 100 is well past any real run and far short of a mistake.
const MAX_COUNT = 100;

const KIND = 'create-form';
// The spaceship Create form's own discriminator - see lib/kinds.js's
// createPresetDiscriminator, which is where each kind registry entry names
// which of the two this module should read and write it as.
const SHIP_KIND = 'create-form-spaceship';

function fail(error) {
    return { ok: false, error };
}

/**
 * A field's value as a trimmed string, or null meaning "cannot be one".
 *
 * Missing becomes '' so a preset saved before a field existed still loads.
 * Anything that is not a string is rejected outright rather than run through
 * String(): pronouns and server both end up as argv entries, and String({})
 * yields '[object Object]', which would reach the command line as a real
 * argument instead of an error the user can see.
 */
function asString(value) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') return null;
    return value.trim();
}

/**
 * A checkbox's value as a boolean, or null meaning "cannot be one".
 *
 * The literal strings 'true' and 'false' are accepted because a hand-edited
 * preset file writing "portrait": "false" is a plausible mistake and !!'false'
 * is true - the flag would flip ON, the opposite of what was written, which is
 * the worst available failure. Anything else is an error rather than a guess.
 */
function asBoolean(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
}

/**
 * An untrusted object -> the exact settings shape, or an error naming the
 * field that could not be coerced.
 *
 * This is the security boundary of the whole feature. It is fed a JSON body
 * straight from the browser and, worse, the contents of whatever file a user
 * picked in the Import dialog, and everything it returns is minutes later
 * spread across generate-npc.py's argv by startCreateJob. So nothing is passed
 * through: each field is coerced to its own type, count is clamped, unknown
 * keys are dropped rather than preserved, and the returned object is built
 * literally here so a key that exists on the way in cannot exist on the way
 * out. Dropping unknown keys rather than keeping them is the point - a
 * preserved `dryRun` or `name` smuggled into a settings blob would ride along
 * into the run.
 *
 * `portrait` and `token` are stored in the positive sense the checkboxes use,
 * not the generator's `--no-portrait` / `--no-token` sense. The route inverts
 * them. Storing the negatives would have meant a preset file whose `false`
 * means "yes, render it", which is unreadable in a file a GM may hand-edit.
 * Whether the two of them are both off - which leaves nothing to generate - is
 * the route's call and not checked here, because a half-built preset being
 * saved mid-edit is legitimate and only the run is impossible.
 *
 * `ship: true` reads and writes the spaceship's narrower schema: pronouns and
 * unarmed are person-only concepts - the same split /api/create's own
 * validation makes for the live form - so a ship preset carries neither
 * field at all rather than a value nobody asked for and nothing reads. This
 * is the "second settings schema behind the discriminator" the ship Create
 * form needs, sharing every other field (and every other coercion rule) with
 * the NPC one rather than duplicating them.
 */
function normaliseSettings(raw, { ship = false } = {}) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return fail('settings must be an object');
    }

    // typeof-gated before Number() because Number([]) is 0, Number(true) is 1
    // and Number(null) is 0: an array or a boolean in the count field would
    // otherwise coerce silently into a plausible-looking run size.
    let count = MIN_COUNT;
    if (raw.count !== undefined && raw.count !== null && raw.count !== '') {
        if (typeof raw.count !== 'number' && typeof raw.count !== 'string') {
            return fail('count must be a number');
        }
        const n = Number(raw.count);
        if (!Number.isFinite(n)) return fail('count must be a number');
        count = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.trunc(n)));
    }

    let seed = null;
    if (raw.seed !== undefined && raw.seed !== null && raw.seed !== '') {
        if (typeof raw.seed !== 'number' && typeof raw.seed !== 'string') {
            return fail('seed must be an integer or null');
        }
        const n = Number(raw.seed);
        // Rejected rather than truncated: a seed is an identity, and quietly
        // turning 12.5 into 12 would reproduce a different roll than the one
        // the file names. The generator's own "must not be negative" rule is
        // left to the route, which is where that error message already lives.
        if (!Number.isInteger(n)) return fail('seed must be an integer or null');
        seed = n;
    }

    let pronouns = '';
    let unarmed = false;
    if (!ship) {
        pronouns = asString(raw.pronouns);
        if (pronouns === null) return fail('pronouns must be a string');
        unarmed = asBoolean(raw.unarmed, false);
        if (unarmed === null) return fail('unarmed must be true or false');
    }
    const server = asString(raw.server);
    if (server === null) return fail('server must be a string');

    const portrait = asBoolean(raw.portrait, true);
    if (portrait === null) return fail('portrait must be true or false');
    const token = asBoolean(raw.token, true);
    if (token === null) return fail('token must be true or false');
    const keepRawToken = asBoolean(raw.keepRawToken, false);
    if (keepRawToken === null) return fail('keepRawToken must be true or false');

    // A non-array overrides is an error, but a bad entry inside a good array
    // is dropped. The difference is what each one implies: `overrides: {}` is a
    // file that was never a Create preset, while one unusable row among six is
    // a hand edit, and refusing the whole preset there would cost the user five
    // good rows to punish one typo.
    if (raw.overrides !== undefined && raw.overrides !== null && !Array.isArray(raw.overrides)) {
        return fail('overrides must be an array');
    }
    const overrides = [];
    for (const entry of raw.overrides || []) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
        if (typeof entry.table !== 'string' || typeof entry.value !== 'string') continue;
        const table = entry.table.trim();
        const value = entry.value.trim();
        if (!table || !value) continue;
        // `custom` only tells the form whether to reopen the row as a free-text
        // box instead of a dropdown, so a malformed one degrades to false
        // rather than discarding an override that is otherwise complete.
        overrides.push({ table, value, custom: asBoolean(entry.custom, false) === true });
    }

    // Built with `pronouns` and `unarmed` at their original key positions
    // (npc's key order is unchanged from before this function took a `ship`
    // option) rather than appended at the end - kept off the object
    // entirely for a ship, not merely defaulted, so a saved ship preset
    // never carries a `pronouns: ''` that would round-trip through
    // export/import looking like an NPC preset missing one optional field.
    const settings = {
        count, seed,
        ...(ship ? {} : { pronouns }),
        server, portrait, token, keepRawToken,
        ...(ship ? {} : { unarmed }),
        overrides,
    };
    return { ok: true, settings };
}

/**
 * A parsed preset file, or an error a user can act on.
 *
 * Accepts either the parsed object or the raw file text, because the Import
 * button has the text and the API route has the object, and having one of them
 * JSON.parse in a try block of its own only moved this error message somewhere
 * it would be worded differently.
 *
 * The wrong-tab checks come first and name both flavours explicitly. "Invalid
 * preset" tells a user nothing when the file they picked is a perfectly valid
 * preset of the other kind - the fix is to go to the other tab, and the
 * message has to say so.
 *
 * `kind` picks the discriminator (and so the schema) this file is checked
 * against - KIND for the NPC form, SHIP_KIND for the spaceship one, each
 * matching the createPresetDiscriminator its registry entry names. Left at
 * its default, every existing call site (the NPC Create form's own import
 * route) validates exactly as it always has.
 */
function validatePresetFile(raw, { kind = KIND } = {}) {
    let data = raw;
    if (typeof raw === 'string') {
        try {
            data = JSON.parse(raw);
        } catch (err) {
            return fail(`not valid JSON: ${err.message}`);
        }
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return fail('a preset file must contain a JSON object');
    }

    // The label the messages below name - "Create NPC" or "Create Spaceship"
    // - tracks which discriminator is being checked against, so a spaceship
    // preset wrongly imported on the NPC tab (or the reverse) gets told
    // which tab actually wants it, not always "Create NPC" regardless.
    const label = kind === SHIP_KIND ? 'Create Spaceship' : 'Create NPC';

    if (data.kind !== undefined && data.kind !== null && data.kind !== kind) {
        return fail(`this file is a "${data.kind}" preset, not a ${label} preset - ${label} presets have "kind": "${kind}"`);
    }
    if (data.settings === undefined && data.selected !== undefined) {
        return fail(`this is a Tables preset (it lists "selected" tables), not a ${label} preset (which carries "settings") - import it on the Tables tab instead`);
    }
    if (data.settings === undefined) {
        return fail(`this is not a ${label} preset - it has no "settings"`);
    }

    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) return fail('preset name is missing');

    const result = normaliseSettings(data.settings, { ship: kind === SHIP_KIND });
    if (!result.ok) return result;

    // A missing or non-string `created` is stamped rather than refused. It is
    // only ever used to sort the list, and a preset a user assembled by hand
    // from the docs is worth more than the timestamp it forgot.
    const created = typeof data.created === 'string' && data.created
        ? data.created : new Date().toISOString();

    return { ok: true, preset: { name, created, kind, settings: result.settings } };
}

function createPresetFile(dir, slug) {
    return path.join(dir, `${slug}.json`);
}

function createPresetExists(dir, slug) {
    return fs.existsSync(createPresetFile(dir, slug));
}

function readCreatePreset(dir, slug) {
    const file = createPresetFile(dir, slug);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Writes the preset, defaulting `kind` when the caller left it off.
 *
 * The stamp is applied here rather than trusted to every call site because a
 * file written without it is one that validatePresetFile cannot later tell
 * apart from a Tables preset - the export/import round trip would break for
 * presets this app itself wrote, which is the worst way to discover a missing
 * key.
 */
function writeCreatePreset(dir, slug, presetObject) {
    fs.mkdirSync(dir, { recursive: true });
    const toWrite = presetObject.kind ? presetObject : { ...presetObject, kind: KIND };
    fs.writeFileSync(createPresetFile(dir, slug), JSON.stringify(toWrite, null, 2));
}

function deleteCreatePreset(dir, slug) {
    const file = createPresetFile(dir, slug);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
}

/**
 * Every saved Create preset, newest first, as list rows.
 *
 * A missing directory is [] and not an error, same as listPresets: nothing has
 * been saved yet is the normal state on a fresh install, not a failure.
 *
 * Unlike listPresets, a file that will not parse is skipped instead of
 * throwing. That is a deliberate difference. These files are small and
 * plausible to hand-edit, and one truncated or half-saved file taking down the
 * entire list - including the presets that are perfectly fine - leaves a user
 * with a dead tab and no way to find out which file is at fault. Skipping
 * costs them the broken row, which is the row they broke.
 */
function listCreatePresets(dir) {
    let files;
    try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
    const out = [];
    for (const f of files) {
        let data;
        try {
            data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        } catch {
            continue;
        }
        if (data === null || typeof data !== 'object') continue;
        const overrides = data.settings && data.settings.overrides;
        out.push({
            name: data.name,
            slug: f.slice(0, -'.json'.length),
            created: data.created,
            overrideCount: Array.isArray(overrides) ? overrides.length : 0,
        });
    }
    out.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));
    return out;
}

module.exports = {
    KIND, SHIP_KIND,
    slugify, normaliseSettings, validatePresetFile,
    listCreatePresets, createPresetExists, readCreatePreset, writeCreatePreset, deleteCreatePreset,
};
