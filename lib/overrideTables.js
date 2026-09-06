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
const REROLLABLE_TRAITS_RE = /^REROLLABLE_TRAITS\s*=\s*\(([\s\S]*?)\)/m;
// The `^` anchor is the only thing keeping this pattern and the one above
// apart: RAW_REROLLABLE_TRAITS contains REROLLABLE_TRAITS as a substring, so
// an unanchored search for the shorter name would find the longer constant
// first in a file that declares it first. Both patterns are anchored, and
// tests pin both directions of that.
// The capture deliberately keeps the inner closing paren - it runs to the
// first `))` in the statement, which is the exclusion tuple's close followed
// by tuple()'s own - so what comes back is a whole `not in (...)` for NOT_IN_RE
// to read rather than one with its tail bitten off.
const RAW_REROLLABLE_TRAITS_RE = /^RAW_REROLLABLE_TRAITS\s*=\s*tuple\(([\s\S]*?\))\)/m;
const NOT_IN_RE = /not\s+in\s*\(([^)]*)\)/;
const NAME_RE = /"([^"]+)"/g;
// The dict runs to the first `}` in column 0, which is how Python's own
// indentation guarantees the end of a top-level literal - nothing inside the
// body is unindented.
const TRAIT_DEPENDENTS_RE = /^TRAIT_DEPENDENTS\s*=\s*\{([\s\S]*?)^\}/m;
// Two thirds of that dict by volume is comment, one line of which quotes a
// phrase ("user expected a smaller change") the entry pattern below would read
// as a trait name if it ever landed before a colon. Whole comment lines are cut
// before the entries are read rather than the pattern being made cleverer,
// because the comments there are prose that will keep being rewritten and the
// parser must not be a reason to write them differently.
const COMMENT_LINE_RE = /^[ \t]*#.*$/gm;
// A key, then either a parenthesised tuple written in place or the name of a
// tuple declared elsewhere in the file - both shapes occur, and the second one
// is the important edge: "Theme" points at THEMED_TABLES rather than restating
// the seven tables a theme picks.
const DEPENDENT_ENTRY_RE = /"([^"]+)"\s*:\s*(\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)/g;

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

/**
 * The traits `--reroll-trait` will re-roll on an entry written before the
 * generator recorded raw bullets, from its REROLLABLE_TRAITS - parsed rather
 * than restated, for exactly the reason the override list is.
 *
 * This list is not merely a subset of REQUIRED_TABLES chosen for taste, and it
 * is no longer the whole story either. A manifest entry written before
 * `rawTraits` existed stores its bullets with their flags stripped, so a trait
 * whose filters need another trait's flags cannot be re-rolled correctly from
 * one - hence the eleven here. An entry that DID record its raw bullets has
 * those flags back and re-rolls almost everything; that is
 * rawRerollableTraitsFrom below, and generate-npc.py picks between the two per
 * NPC rather than globally. Both lists are derived rather than restated
 * because restating the judgement would put it in two places and let the two
 * disagree silently, which is how the override list drifted before it was
 * derived.
 *
 * Returns an empty list rather than throwing when the parse fails, same as
 * parseRequiredTables - the caller degrades to offering no reroll buttons.
 */
function rerollableTraitsFrom(pythonSource) {
    const block = pythonSource.match(REROLLABLE_TRAITS_RE);
    if (!block) return [];
    return [...block[1].matchAll(NAME_RE)].map((m) => m[1]);
}

/**
 * The traits `--reroll-trait` will re-roll on an entry that recorded its raw
 * bullets, from the generator's RAW_REROLLABLE_TRAITS.
 *
 * That constant is a comprehension rather than a literal tuple - it is
 * REQUIRED_TABLES minus the three names re-rolling in place cannot mean, since
 * the folder and manifest id are derived from the NPC's name and Pronouns
 * takes the per-pronoun variant tables with it - so there is no list of names
 * to read. What is read instead is the generator's own exclusion tuple, and
 * the subtraction is redone here over the same REQUIRED_TABLES the generator
 * comprehends over. That keeps the derived-not-restated property the whole of
 * this file exists for: a table added to REQUIRED_TABLES next month becomes
 * re-rollable in the GUI the day it is added, with nothing here to remember.
 *
 * Missing Theme is what made this function necessary. The GUI read only
 * REROLLABLE_TRAITS, the cascade work put Theme in the raw list alone, and the
 * two most useful re-rolls in the generator - Theme and Outfit - were
 * unreachable from every modern NPC's detail sheet without a single error
 * anywhere to say so.
 *
 * Same degrade-not-throw contract as the rest of the file: an empty list on
 * any parse miss, so the caller offers no buttons rather than offering the
 * wrong ones. The empty exclusion check below is part of that - a `tuple(...)`
 * whose `not in (...)` this could not read would otherwise return the whole of
 * REQUIRED_TABLES, name halves and Pronouns included, which is the one wrong
 * answer with a plausible shape.
 */
function rawRerollableTraitsFrom(pythonSource) {
    const block = pythonSource.match(RAW_REROLLABLE_TRAITS_RE);
    if (!block) return [];
    const excluded = block[1].match(NOT_IN_RE);
    if (!excluded) return [];
    const refused = new Set([...excluded[1].matchAll(NAME_RE)].map((m) => m[1]));
    if (!refused.size) return [];
    return parseRequiredTables(pythonSource).filter((name) => !refused.has(name));
}

/** The names in a top-level `NAME = (...)` or `NAME = [...]` tuple or list. */
function tupleConstantFrom(pythonSource, constantName) {
    const block = pythonSource.match(
        new RegExp(`^${constantName}\\s*=\\s*[([]([\\s\\S]*?)[)\\]]`, 'm'));
    if (!block) return [];
    return [...block[1].matchAll(NAME_RE)].map((m) => m[1]);
}

/**
 * Which traits a re-roll of one trait also frees, from generate-npc.py's
 * TRAIT_DEPENDENTS - the direct edges only, not their closure.
 *
 * The GUI needs this because "Re-roll" on one row of the detail sheet does not
 * re-roll one trait. reroll_from_raw() pins everything but the target, and a
 * pinned trait is never re-checked against the value that just changed, so the
 * generator frees every trait a filter would have had to look at again: a new
 * Role redraws the Faction, Outfit and Weapon; a new Theme takes eleven others
 * with it, the whole visible character. Guessing at that from the two
 * re-rollable lists instead - a "this changes more than one trait" dialog on
 * anything outside the legacy eleven - warns on Faction, Weather and Stance,
 * none of which is a key here, and can never say which traits a real cascade
 * carries. Reading the real map is what lets the dialog name them and stay
 * quiet when there are none.
 *
 * Values come two shapes and both are read: a tuple written in place, and the
 * name of a tuple declared elsewhere, which is how "Theme" points at
 * THEMED_TABLES so a table tagged for theming next month cascades the day it is
 * tagged. Keys and values are both filtered against REQUIRED_TABLES, which is
 * what trait_cascade() does to its own result - an edge naming something the
 * roller does not draw is not a trait the GUI can offer or warn about either.
 *
 * Same degrade-not-throw contract as the rest of this file, with the caller's
 * fallback the interesting half: an empty map means the page cannot tell a
 * cascade from a lone re-roll, so it over-warns from the eleven traits the
 * generator promises are cascade-free rather than firing Theme's dozen
 * unannounced.
 */
function traitDependentsFrom(pythonSource) {
    const block = pythonSource.match(TRAIT_DEPENDENTS_RE);
    if (!block) return {};
    const tables = new Set(parseRequiredTables(pythonSource));
    if (!tables.size) return {};
    const body = block[1].replace(COMMENT_LINE_RE, '');
    const dependents = {};
    for (const [, trait, value] of body.matchAll(DEPENDENT_ENTRY_RE)) {
        if (!tables.has(trait)) continue;
        const named = value.startsWith('(')
            ? [...value.matchAll(NAME_RE)].map((m) => m[1])
            : tupleConstantFrom(pythonSource, value);
        // A self-edge would survive the closure walk harmlessly but would make
        // a trait that closes to itself look like a cascade to the caller,
        // which is the whole question this map is asked.
        const freed = named.filter((name) => name !== trait && tables.has(name));
        if (freed.length) dependents[trait] = freed;
    }
    return dependents;
}

module.exports = {
    parseRequiredTables,
    overrideTablesFrom,
    rerollableTraitsFrom,
    rawRerollableTraitsFrom,
    traitDependentsFrom,
};
