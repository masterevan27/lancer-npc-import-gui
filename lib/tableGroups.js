/**
 * The order and grouping the Tables tab lists headings in.
 *
 * File order put Hair, 'Hair (she) +' and 'Hair (he) +' as three unrelated
 * top-level rows and interleaved identity tables with appearance ones. These
 * groups follow what a bullet actually describes, which is how someone
 * curating the tables thinks about them.
 *
 * A pure function so it can be tested without a DOM - the rest of the Tables
 * tab is DOM code this repo has no harness for.
 */

const TABLE_GROUPS = [
    { group: 'Identity', tables: ['Given names', 'Family names', 'Callsigns', 'Pronouns', 'Theme', 'Role', 'Faction'] },
    { group: 'Body', tables: ['Age', 'Build', 'Height', 'Skin'] },
    { group: 'Appearance', tables: ['Hair', 'Hair colour', 'Eyes', 'Feature', 'Demeanor'] },
    { group: 'Kit', tables: ['Outfit', 'Headgear', 'Weapon', 'Gear'] },
    { group: 'Scene', tables: ['Backdrop', 'Weather', 'Stance', 'Glow colour', 'Glow placement'] },
];

/**
 * The same, for spaceship-generator-tables.md.
 *
 * Purely cosmetic: a table named in no group already falls to the trailing
 * 'Other' bucket below, so before this list every ship table was listed under
 * one heading in file order and the Tables tab still worked. What it buys is
 * that a ship's tables read the way someone curating them thinks about a
 * ship - what it is, what it is made of, what it carries, and the shot it is
 * photographed in - instead of the order the generator happens to draw them.
 *
 * 'Ship names' rather than the NPC file's two-part name: ships have one name
 * table, and it leads the list for the same reason Given names does there.
 * The four Scene tables are the ones the two files genuinely share - both
 * carry a '## Backdrop', which is why table identity is (kind, table) on the
 * wire - and they are grouped here under the same heading they have there so
 * the two tabs do not disagree about what a backdrop is.
 */
const SPACESHIP_TABLE_GROUPS = [
    { group: 'Identity', tables: ['Ship names', 'Theme', 'Ship type', 'Size', 'Faction'] },
    { group: 'Structure', tables: ['Hull', 'Detail', 'Markings', 'Condition'] },
    { group: 'Systems', tables: ['Weapon', 'Shield generator', 'Launch catapult', 'Command bridge'] },
    { group: 'Scene', tables: ['Backdrop', 'Weather', 'Glow colour', 'Glow placement'] },
];

/** Which group list each kind's Tables tab is ordered by. */
const GROUPS_BY_KIND = { npc: TABLE_GROUPS, spaceship: SPACESHIP_TABLE_GROUPS };

const OTHER = 'Other';

/** A heading's base table name: 'Hair (she) +' -> 'Hair', 'Hair' -> 'Hair'. */
function baseNameOf(name) {
    const paren = name.indexOf(' (');
    return paren === -1 ? name : name.slice(0, paren);
}

/**
 * Tables arranged into ordered groups, with per-pronoun variants nested under
 * the base table they extend.
 *
 * Every table given is returned exactly once. One named in no group lands in a
 * trailing 'Other' rather than disappearing, so a table added to the generator
 * later stays reachable without an edit here.
 *
 * `kindId` picks which group list orders the result, and it is optional and
 * trailing on purpose: every existing caller and every existing test passes
 * one argument and means the NPC list, and a kind with no list of its own
 * gets the NPC list too - which orders nothing of its own and drops the whole
 * file into 'Other', exactly the behaviour a ship had before this parameter
 * existed. Grouping is cosmetic, so being wrong about it must never be worse
 * than not grouping at all.
 */
function groupTables(tables, kindId = 'npc') {
    const groups = GROUPS_BY_KIND[kindId] || GROUPS_BY_KIND.npc;
    const byBase = new Map();
    for (const table of tables) {
        const base = baseNameOf(table.name);
        if (!byBase.has(base)) byBase.set(base, []);
        byBase.get(base).push(table);
    }

    // Base first, then its variants in a stable order rather than file order,
    // so 'Hair (she) +' and 'Hair (he) +' do not swap places between reloads.
    for (const group of byBase.values()) {
        group.sort((a, b) => {
            const aVariant = a.name.includes(' (');
            const bVariant = b.name.includes(' (');
            if (aVariant !== bVariant) return aVariant ? 1 : -1;
            return a.name.localeCompare(b.name);
        });
    }

    const claimed = new Set();
    const out = [];
    for (const { group, tables: names } of groups) {
        const rows = [];
        for (const name of names) {
            for (const table of byBase.get(name) || []) {
                rows.push({ table, isVariant: table.name !== name });
                claimed.add(table.name);
            }
        }
        if (rows.length) out.push({ group, rows });
    }

    const leftovers = tables.filter((table) => !claimed.has(table.name));
    if (leftovers.length) {
        out.push({ group: OTHER, rows: leftovers.map((table) => ({ table, isVariant: false })) });
    }
    return out;
}

module.exports = { TABLE_GROUPS, SPACESHIP_TABLE_GROUPS, GROUPS_BY_KIND, groupTables, baseNameOf };
