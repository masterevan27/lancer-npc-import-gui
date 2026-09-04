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
    { group: 'Scene', tables: ['Backdrop', 'Weather', 'Stance', 'Glow colour'] },
];

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
 */
function groupTables(tables) {
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
    for (const { group, tables: names } of TABLE_GROUPS) {
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

module.exports = { TABLE_GROUPS, groupTables, baseNameOf };
