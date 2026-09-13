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
 * 'Ship names' leads the list for the same reason Given names does in the NPC
 * one, and 'Name prefixes' follows it the way Family names follows there: the
 * ship file's two-part name is a registry mark joined to a proper name
 * ("ISV Vespertine"), rolled from its own '## Name prefixes' table, so it is
 * an Identity row rather than an unrecognised one falling to 'Other'.
 * The four Scene tables are the ones the two files genuinely share - both
 * carry a '## Backdrop', which is why table identity is (kind, table) on the
 * wire - and they are grouped here under the same heading they have there so
 * the two tabs do not disagree about what a backdrop is.
 */
const SPACESHIP_TABLE_GROUPS = [
    { group: 'Identity', tables: ['Ship names', 'Name prefixes', 'Theme', 'Ship type', 'Size', 'Faction'] },
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

/** { groupHeading: parentBaseName }, the same rule lib/tableBullets.js's groupParents() applies. */
function parentsOf(tables) {
    const parents = {};
    for (const table of tables) {
        for (const target of table.references || []) {
            for (const other of tables) {
                if (other.name === target || other.name.startsWith(`${target} (`)) {
                    parents[other.name] = baseNameOf(table.name);
                }
            }
        }
    }
    return parents;
}

/**
 * The group rows entered from a table named `name` (already a base name),
 * each with its own variants, in base-then-variants order - a curator
 * reading that table sees what it can deal, groups included, right after
 * its own rows. Used for a listed table and for one that fell to Other
 * alike, so a group is never orphaned just because the table that references
 * it isn't in TABLE_GROUPS.
 */
function nestedGroupRowsFor(name, byBase, parents, claimed) {
    const rows = [];
    const groupBases = [...new Set(
        Object.entries(parents).filter(([, p]) => p === name).map(([g]) => baseNameOf(g)))].sort();
    for (const base of groupBases) {
        for (const table of byBase.get(base) || []) {
            // Skip a heading already claimed, so one both listed under a
            // group and referenced by a table is emitted once, not twice.
            if (parents[table.name] !== name || claimed.has(table.name)) continue;
            rows.push({ table, isVariant: table.name !== base, isGroup: true, parent: name });
            claimed.add(table.name);
        }
    }
    return rows;
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

    const parents = parentsOf(tables);
    const claimed = new Set();
    const out = [];
    for (const { group, tables: names } of groups) {
        const rows = [];
        for (const name of names) {
            for (const table of byBase.get(name) || []) {
                // Skip a heading already claimed: a table can be BOTH a
                // TABLE_GROUPS root name and, at the same time, some other
                // table's referenced group (an unusual file, but nothing
                // stops one), and the first pass to visit it wins. Without
                // this a later group's own root loop would push it a second
                // time as a root row, on top of the nested row it already got
                // (or is about to get) as a group.
                if (claimed.has(table.name)) continue;
                rows.push({ table, isVariant: table.name !== name, isGroup: false, parent: null });
                claimed.add(table.name);
            }
            rows.push(...nestedGroupRowsFor(name, byBase, parents, claimed));
        }
        if (rows.length) out.push({ group, rows });
    }

    // A table that fell to Other still nests any group it references, the
    // same as a listed one - the docstring above promises a table added
    // later stays reachable, and a group entered only from that table must
    // stay reachable too, rather than landing as its own orphaned row here.
    const otherRows = [];
    for (const [base, entries] of byBase) {
        if (claimed.has(entries[0].name)) continue;
        // A base that is itself a group entered from some other table is
        // never its own root row here - it surfaces only through that
        // table's nestedGroupRowsFor call below, whatever order this loop
        // happens to visit the two bases in.
        if (entries.some((table) => parents[table.name])) continue;
        for (const table of entries) {
            otherRows.push({ table, isVariant: false, isGroup: false, parent: null });
            claimed.add(table.name);
        }
        otherRows.push(...nestedGroupRowsFor(base, byBase, parents, claimed));
    }
    // Safety net: a group deferred above whose own referencing table never
    // became a root (for instance, a group entered only from another group)
    // still gets a row here rather than silently vanishing.
    for (const entries of byBase.values()) {
        for (const table of entries) {
            if (claimed.has(table.name)) continue;
            otherRows.push({ table, isVariant: false, isGroup: false, parent: null });
            claimed.add(table.name);
        }
    }
    if (otherRows.length) out.push({ group: OTHER, rows: otherRows });
    return out;
}

module.exports = { TABLE_GROUPS, SPACESHIP_TABLE_GROUPS, GROUPS_BY_KIND, groupTables, baseNameOf };
