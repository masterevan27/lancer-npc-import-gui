/**
 * The selectable values the Create NPC form offers for each trait override.
 *
 * The form has always accepted a free-text override, which maps to
 * generate-npc.py's `--set-trait Table=value`. Typing one by hand is
 * error-prone in a way that fails quietly: `--set-trait` takes the bullet
 * *verbatim, flags included* - the script's own help shows
 * `--set-trait Outfit="an elaborate floral kimono ... || civ notac"` - and
 * those flags are what gate the Weapon, Gear and Backdrop rolls that follow.
 * A value typed without them parses as a bullet with no flags and silently
 * changes what the rest of the roll is allowed to do. So an option's `value`
 * is the raw bullet text exactly as the tables file carries it, and only the
 * `label` is prettied up for display.
 *
 * A pure function, for the same reason lib/tableGroups.js is one: it can be
 * tested without a DOM, and the Create form itself is DOM code this repo has
 * no harness for. The route hands the result to the client; the client only
 * renders it.
 */

const { baseNameOf } = require('./tableGroups');
const { referenceTargetOf, groupParents } = require('./tableBullets');

/**
 * A bullet's text made readable in a one-line dropdown.
 *
 * '||' is the tables file's segment separator and reads as noise in a
 * <select>; '·' keeps the segment boundaries visible - which matters, since
 * the trailing segment is usually the flags - without looking like markup.
 * The value the option carries is untouched.
 */
function readableLabel(text) {
    return text.split('||').map((s) => s.trim()).filter((s) => s !== '').join(' · ');
}

/**
 * The pronoun subjects a variant heading may be written for.
 *
 * Kept as a literal list rather than read off the Pronouns table, because a
 * heading is not evidence that its subject is rollable and the two questions
 * have different answers: the tables file's they/them bullet was removed when
 * the renders came back androgynous, but '(they)' variant headings are still
 * documented as working and one could be sitting in the file right now. A
 * heading whose subject nobody can roll should still be recognised as gendered
 * and gated away, not mistaken for a neutral base table and offered to
 * everyone - which is exactly the bug this whole field exists to fix.
 */
const PRONOUN_SUBJECTS = new Set(['she', 'he', 'they']);

/**
 * A variant heading's pronoun subject, lowercased: 'Outfit (she) +' -> 'she',
 * 'Build (he)' -> 'he', 'Outfit' -> null.
 *
 * The Create form offers every bullet under a base table, variants folded in,
 * and --set-trait pastes the chosen bullet verbatim - so a user with Pronouns
 * set to 'he' could pick out of 'Outfit (she) +' and get a render wearing a
 * woman-only outfit. The client needs to know which subject each option
 * belongs to before it can hide the ones that do not apply, and the heading is
 * the only place that is written down.
 *
 * Both documented forms count. '<Table> (she) +' is added to the base table
 * and '<Table> (she)' replaces it - a difference that matters enormously to
 * the generator's roll and not at all here, since either way the bullet is
 * reachable by that pronoun alone. Answering 'she' for both is what lets the
 * caller gate them with one rule.
 *
 * Parenthesised text that is not a pronoun subject returns null rather than
 * being reported as one. Nothing stops a future heading from parenthesising
 * something else entirely, and a wrong subject is worse than no subject: it
 * would hide a neutral option from everyone whose pronouns did not happen to
 * match a word that was never about pronouns. null means "offer it to
 * everybody", which is the safe answer for a heading this function does not
 * understand.
 */
function variantSubjectOf(heading) {
    const match = /\(([^()]*)\)\s*\+?\s*$/.exec(heading);
    if (!match) return null;
    const subject = match[1].trim().toLowerCase();
    return PRONOUN_SUBJECTS.has(subject) ? subject : null;
}

/**
 * Parsed tables -> { [baseTableName]: Array<option> }.
 *
 * An option is { value, label, heading, isVariant, variantSubject, enabled,
 * weight, group }, where variantSubject is the pronoun subject of the option's
 * own heading, or null on a base table's bullets, and group is the heading of
 * the group table a member was rolled from, or null for a table's own bullet.
 * Variants ('Outfit (she) +') fold into their base table's list rather than
 * forming a key of their own, because the override dropdown offers base names
 * only - those come from generate-npc.py's REQUIRED_TABLES, which has no
 * variant entries. Base-table options sort first, then variants, so the
 * neutral pool reads as the default and the gendered additions as additions.
 *
 * A `- => Name` bullet is a reference: it hands its slot to `## Name`'s own
 * bullets (plus `## Name (she) +`, etc.), and it is never itself offered as a
 * value - `--set-trait Outfit="=> Flight suits"` is not a bullet the generator
 * can roll. A group table reached only through a reference is not a key of
 * its own for the same reason a variant is not: the override dropdown needs
 * one row per REQUIRED_TABLES entry, and a group table isn't one.
 *
 * Disabled bullets are included and flagged rather than dropped: --set-trait
 * bypasses the roll pool entirely, so forcing a bullet that is switched off on
 * the Tables tab is a legitimate thing to want, and hiding it would make the
 * form quietly less capable than the command line it wraps.
 */
/**
 * Whether a variant heading REPLACES its base table rather than adding to it.
 *
 * The tables file documents two forms and the difference is the whole of this
 * function: '<Table> (she) +' is added to '<Table>', so a woman rolls from both
 * pools, while '<Table> (she)' is used INSTEAD of it, so a woman never sees the
 * base table's bullets at all. Two live tables take the second form, Build and
 * Height, because the masculine builds should not apply to a woman even as
 * long odds.
 *
 * variantSubjectOf answers 'she' for both, which is right for gating a VARIANT
 * bullet - either way it belongs to that pronoun alone. It is not enough for
 * gating a BASE bullet, though, and that gap is what this exists to close: with
 * Pronouns set to 'she' every '## Build' and '## Height' bullet is unrollable,
 * and the Create form was offering all thirteen of them ungreyed because they
 * carry no variant subject of their own.
 */
function isReplacementVariant(heading) {
    return variantSubjectOf(heading) !== null && !/\+\s*$/.test(heading);
}

function traitOptionsFrom(tables) {
    const out = {};
    // Which pronoun subjects each base table is REPLACED for, gathered before
    // the options are built because a base table's bullets are usually read
    // before the variant that supersedes them.
    const replacedFor = {};
    for (const table of tables) {
        if (!table.bullets.length) continue;
        if (!isReplacementVariant(table.name)) continue;
        const base = baseNameOf(table.name);
        (replacedFor[base] ||= []).push(variantSubjectOf(table.name));
    }
    const parents = groupParents(tables);
    const byName = new Map(tables.map((t) => [t.name, t]));
    for (const table of tables) {
        if (!table.bullets.length) continue;
        // A group table is reached through the reference that points at it,
        // not listed as a trait key of its own - see the push() below.
        if (parents[table.name]) continue;
        const base = baseNameOf(table.name);
        if (!out[base]) out[base] = [];
        const push = (bullet, heading, group) => {
            const subject = variantSubjectOf(heading);
            out[base].push({
                value: bullet.text,
                label: readableLabel(bullet.text),
                heading,
                isVariant: heading !== base,
                variantSubject: subject,
                // Empty on a variant's own bullets: a replacement variant is
                // not itself replaced, and saying otherwise would gate the
                // very pool that supersedes the base table.
                replacedFor: heading === base ? (replacedFor[base] || []).slice() : [],
                enabled: bullet.enabled,
                weight: bullet.weight,
                // The group a member came from, null for a table's own bullet.
                // The Create form and Set... show members under this heading
                // in place of the reference, which is a slot, not a value.
                group,
            });
        };
        for (const bullet of table.bullets) {
            const target = referenceTargetOf(table.name, bullet.text);
            if (!target) {
                push(bullet, table.name, null);
                continue;
            }
            for (const name of [target, ...tables.map((t) => t.name).filter((n) => n.startsWith(`${target} (`))]) {
                const group = byName.get(name);
                if (!group) continue;
                for (const member of group.bullets) push(member, name, target);
            }
        }
    }
    for (const options of Object.values(out)) {
        // Stable: base table first, then variants by heading, file order
        // preserved within each. Array.prototype.sort is stable in Node.
        options.sort((a, b) => {
            if (a.isVariant !== b.isVariant) return a.isVariant ? 1 : -1;
            return a.heading.localeCompare(b.heading);
        });
    }
    return out;
}

module.exports = { traitOptionsFrom, readableLabel, variantSubjectOf, isReplacementVariant };
