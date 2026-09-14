/**
 * A generated NPC (or spaceship) turned into a Create-form preset's settings.
 *
 * The NPC sheet's "Save as Create preset" is this function plus a file write:
 * a manifest entry in, the exact `settings` shape lib/createPresets.js stores
 * out, so that "roll me another one like her" is one click on the sheet and
 * one Load on the Create tab instead of retyping twenty override rows.
 *
 * Built here on the server rather than in the browser for a reason that is
 * easy to miss: the override value generate-npc.py wants is the bullet
 * *verbatim, flags included* (`a heavy work jacket || civ notac`), and the
 * flags are what gate the Weapon, Gear and Backdrop rolls that follow. The
 * browser is only ever sent the stripped `traits` - see itemView in server.js,
 * which deliberately never exposes rawTraits - so a preset assembled there
 * would pin flagless values that quietly change what the rest of a roll may
 * do. The manifest's `rawTraits` has the flags, and this is where it can be
 * read.
 *
 * What is kept and what is not follows the rules the preset schema already
 * states. The name halves and the callsign are left out for the reason
 * lib/createPresets.js gives for the Name field: a preset is a recipe and a
 * character's name is the one part of it that is not reusable - saving Vela
 * and loading her back would mint a second Vela. The seed IS kept, as that
 * module keeps it, because a seed names a roll rather than a person and the
 * form's Seed box is one click to clear. Pronouns become the form's own
 * `pronouns` field (the subject, `she`) rather than an override, since the
 * generator refuses `--pronouns` and `--set-trait Pronouns=` together and
 * the form only ever sends the former. Count is 1 and the render switches sit
 * at their defaults: the entry records none of them, and guessing would put
 * a value in a file nobody re-reads before applying.
 *
 * Pure, so it is testable without a manifest on disk. `tables` is the kind's
 * override table list (OVERRIDE_DATA_BY_KIND in server.js) and fixes both
 * which traits may be pinned and the order they land in; `options` is the
 * kind's trait options (lib/traitOptions.js) and decides `custom` - a value
 * the current tables file no longer offers verbatim is flagged so the Create
 * form reopens it as free text instead of a dropdown that cannot show it.
 */

/** Tables that identify one character rather than describe a kind of one. */
const IDENTITY_TABLES = ['Given names', 'Family names', 'Callsigns'];

/** `she/her/her/woman` -> `she`, the value the Create form's select carries. */
function pronounSubjectOf(traits) {
    const bullet = traits && typeof traits.Pronouns === 'string' ? traits.Pronouns : '';
    return bullet.split('/')[0].trim();
}

/**
 * `rawTraits` only when it is the generator's idea of present: an empty dict
 * is "no raw bullets" there (see hasRawTraits in server.js), and reading it
 * as an empty-but-authoritative set would drop every override.
 */
function rawTraitsOf(item) {
    const raw = item && item.rawTraits;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.keys(raw).length ? raw : {};
}

function settingsFromItem(item, { tables, options = {}, ship = false }) {
    const traits = item && item.traits && typeof item.traits === 'object' ? item.traits : {};
    const raw = rawTraitsOf(item);

    const overrides = [];
    for (const table of tables || []) {
        if (IDENTITY_TABLES.includes(table) || table === 'Pronouns') continue;
        const candidate = typeof raw[table] === 'string' ? raw[table] : traits[table];
        if (typeof candidate !== 'string') continue;
        const value = candidate.trim();
        if (!value) continue;
        const known = (options[table] || []).some((o) => o && o.value === value);
        overrides.push({ table, value, custom: !known });
    }

    const seed = Number.isInteger(item && item.seed) && item.seed >= 0 ? item.seed : null;

    // Same key order as normaliseSettings builds, so a round trip through it
    // is the identity and a test can deepEqual the two.
    return {
        count: 1,
        seed,
        ...(ship ? {} : { pronouns: pronounSubjectOf(traits) }),
        server: '',
        portrait: true,
        token: true,
        keepRawToken: false,
        ...(ship ? {} : { unarmed: false }),
        overrides,
    };
}

module.exports = { IDENTITY_TABLES, pronounSubjectOf, settingsFromItem };
