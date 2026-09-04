/**
 * The subject pronouns the generator can actually roll, read off
 * npc-generator-tables.md.
 *
 * The GUI used to hardcode she/he/they. The generator removed they/them
 * deliberately - see that table's own comment - and the dropdown went on
 * offering a value that matched nothing, sending --pronouns they to a script
 * that would reject it. Deriving the list means the two cannot drift again,
 * and a pronoun set added to the table later appears with no GUI change.
 *
 * Deliberately its own tiny parser rather than a call into tableBullets: it
 * wants one table's subject field, not the full bullet model or the disk-write
 * machinery. It does need the weight convention, though - the Tables tab's
 * weight control attaches to every bullet of every table with no per-table
 * exclusion for Pronouns, so a weighted bullet like "x2 she/her/her/woman" is
 * a real value this module will see. splitWeight() is imported from
 * tableBullets rather than re-matched here: one definition of what a weight
 * prefix looks like is the point, since two copies would drift the moment
 * that syntax changed.
 */

const { splitWeight } = require('./tableBullets');

const HEADING_RE = /^##\s+(?!#)\s*(.*?)\s*$/;
const BULLET_RE = /^-\s+(.*?)\s*$/;

/** The subject pronoun of every enabled bullet under '## Pronouns', in order. */
function subjectsFrom(tablesText) {
    const subjects = [];
    let inPronouns = false;
    for (const line of tablesText.split('\n')) {
        const heading = line.match(HEADING_RE);
        if (heading) {
            inPronouns = heading[1] === 'Pronouns';
            continue;
        }
        if (!inPronouns) continue;
        const bullet = line.match(BULLET_RE);
        if (!bullet) continue;   // prose, blank lines and disabled bullets alike
        const { text } = splitWeight(bullet[1]);
        const subject = text.split('/')[0].trim();
        if (subject) subjects.push(subject);
    }
    return subjects;
}

module.exports = { subjectsFrom };
