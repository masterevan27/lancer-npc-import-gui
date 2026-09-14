/**
 * Correcting a staged trait candidate before it is imported.
 *
 * The npc-trait-import skill picks a table by reading the reference image, and
 * it is sometimes wrong in a way the person reviewing the run can see at a
 * glance: a build staged under 'Build (she)' that plainly suits a man belongs
 * under 'Build', and a haircut staged as 'Hair (she) +' may read better as
 * 'Hair (he) +'. The fix is an edit to the staged entry itself - its `table`
 * and `bullet` - so that the import route, which already writes whatever the
 * entry says, needs no second code path for "imported with an override".
 *
 * The skill's own answer is kept beside the edit as `original_table` and
 * `original_bullet`, written once on the first change and never overwritten,
 * so a correction can always be undone and the detail sheet can say what it
 * replaced. An edit that lands back on the original clears them again rather
 * than leaving an "edited" marker on an entry that says what it always said.
 *
 * Pure (it mutates only the entry it is handed) so it can be tested without a
 * server, the same reason lib/tableGroups.js is.
 */

/**
 * A bullet as the tables file will hold it: one line, no leading '- '.
 *
 * insertBulletIntoTables writes `- ${bullet}`, so a pasted '- a wiry frame'
 * would land as '- - a wiry frame', and a newline would split one bullet into
 * a bullet and a stray line the parser reads as prose.
 */
function normaliseBullet(text) {
    return String(text ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim().replace(/^-\s+/, '').trim();
}

/**
 * Apply one edit to a staged entry in place.
 *
 * `edit` is `{ table, bullet }` - either may be omitted to leave it alone -
 * or `{ reset: true }` to put back what the skill staged. `tableNames` is
 * every heading in the kind's tables file; a table outside it is refused here
 * rather than at import time, where the error would arrive long after the
 * person who chose it had moved on.
 *
 * Returns `{ ok: true, changed }` or `{ ok: false, status, error }`.
 */
function applyCandidateEdit(entry, edit, tableNames) {
    if (entry.imported) {
        return { ok: false, status: 409, error: 'already imported - edit the bullet on the Tables tab instead' };
    }

    const originalTable = entry.original_table ?? entry.table;
    const originalBullet = entry.original_bullet ?? entry.bullet;

    let table;
    let bullet;
    if (edit && edit.reset) {
        table = originalTable;
        bullet = originalBullet;
    } else {
        table = edit && edit.table !== undefined ? String(edit.table).trim() : entry.table;
        bullet = edit && edit.bullet !== undefined ? normaliseBullet(edit.bullet) : entry.bullet;
        if (!table) return { ok: false, status: 400, error: 'table is required' };
        if (!bullet) return { ok: false, status: 400, error: 'bullet cannot be empty' };
        // The staged table is always allowed back, even if the tables file has
        // since lost that heading: reverting is never the edit to refuse.
        if (table !== originalTable && !tableNames.includes(table)) {
            return { ok: false, status: 400, error: `no "## ${table}" heading in the tables file` };
        }
    }

    const changed = table !== entry.table || bullet !== entry.bullet;
    entry.table = table;
    entry.bullet = bullet;
    if (table === originalTable && bullet === originalBullet) {
        delete entry.original_table;
        delete entry.original_bullet;
    } else {
        entry.original_table = originalTable;
        entry.original_bullet = originalBullet;
    }
    return { ok: true, changed };
}

module.exports = { applyCandidateEdit, normaliseBullet };
