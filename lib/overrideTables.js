/**
 * The trait tables the GUI's override dropdown offers, derived from
 * generate-npc.py's own REQUIRED_TABLES rather than restated here.
 *
 * It used to be a hand-maintained constant in server.js, and it drifted: it
 * was missing Weapon (split out of Gear after the list was written), Theme
 * (added later, and the most useful override of the lot), Height and Hair
 * colour - and it still named Accent after that table became Glow colour.
 * Every one of those was silently unreachable from the GUI.
 *
 * Parsed with a regex rather than executed, because this is a Node process
 * reading a Python file. That is fragile in exactly one way - reformatting
 * REQUIRED_TABLES onto a different shape could break it - so the parse
 * returns an empty list rather than throwing, and the caller falls back.
 */

const REQUIRED_TABLES_RE = /^REQUIRED_TABLES\s*=\s*\[([\s\S]*?)\]/m;
const NAME_RE = /"([^"]+)"/g;

/** Every table name in generate-npc.py's REQUIRED_TABLES, in file order. */
function parseRequiredTables(pythonSource) {
    const block = pythonSource.match(REQUIRED_TABLES_RE);
    if (!block) return [];
    return [...block[1].matchAll(NAME_RE)].map((m) => m[1]);
}

/**
 * Those tables minus Pronouns, which the GUI exposes as its own form field -
 * the same split --pronouns and --set-trait have on the command line.
 */
function overrideTablesFrom(pythonSource) {
    return parseRequiredTables(pythonSource).filter((name) => name !== 'Pronouns');
}

module.exports = { parseRequiredTables, overrideTablesFrom };
