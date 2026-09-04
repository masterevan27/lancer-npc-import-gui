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
 * Parsed tables -> { [baseTableName]: Array<option> }.
 *
 * An option is { value, label, heading, isVariant, enabled, weight }. Variants
 * ('Outfit (she) +') fold into their base table's list rather than forming a
 * key of their own, because the override dropdown offers base names only -
 * those come from generate-npc.py's REQUIRED_TABLES, which has no variant
 * entries. Base-table options sort first, then variants, so the neutral pool
 * reads as the default and the gendered additions as additions.
 *
 * Disabled bullets are included and flagged rather than dropped: --set-trait
 * bypasses the roll pool entirely, so forcing a bullet that is switched off on
 * the Tables tab is a legitimate thing to want, and hiding it would make the
 * form quietly less capable than the command line it wraps.
 */
function traitOptionsFrom(tables) {
    const out = {};
    for (const table of tables) {
        if (!table.bullets.length) continue;
        const base = baseNameOf(table.name);
        const isVariant = table.name !== base;
        if (!out[base]) out[base] = [];
        for (const bullet of table.bullets) {
            out[base].push({
                value: bullet.text,
                label: readableLabel(bullet.text),
                heading: table.name,
                isVariant,
                enabled: bullet.enabled,
                weight: bullet.weight,
            });
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

module.exports = { traitOptionsFrom, readableLabel };
