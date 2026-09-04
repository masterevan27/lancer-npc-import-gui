/**
 * Parses and edits npc-generator-tables.md's bullet lists in place.
 *
 * Mirrors generate-npc.py's own parse_tables()/split_flags() conventions
 * closely enough to stay in sync with it: '## Heading' starts a table, a
 * '- ' line is a bullet, a leading 'xN ' on a bullet is its weight. This
 * module adds one convention generate-npc.py doesn't need to know about -
 * a bullet wrapped '<!-- - text -->' is disabled. generate-npc.py's own
 * parser already ignores any line that doesn't start with '-', so a
 * disabled bullet is silently skipped there with no change needed to that
 * script - see the design doc this implements.
 */

const fs = require('node:fs');

const HEADING_RE = /^##\s+(?!#)\s*(.*?)\s*$/;
const ENABLED_BULLET_RE = /^-\s+(.*?)\s*$/;
const DISABLED_BULLET_RE = /^<!--\s*-\s+(.*?)\s*-->\s*$/;
const WEIGHT_RE = /^x(\d+)\s+(.*)$/;

/**
 * Headings in npc-generator-tables.md that are documentation, not roll tables.
 *
 * The parser cannot tell them apart structurally: the '|| conventions' section
 * explains the format using '- ' bullets, which look exactly like roll
 * options. Served as options they got checkboxes and weight inputs, so
 * unchecking one wrapped a paragraph of the file's own documentation in
 * <!-- --> and setting a weight prefixed prose with 'x2 '.
 *
 * A named constant rather than a parsed rule, for the same reason the override
 * list is derived from REQUIRED_TABLES: the generator fixes these headings, so
 * they are not free to grow. A prose section added later with no bullets is
 * caught by the second half of isRollTable() without needing an entry here.
 */
const NON_TABLE_SECTIONS = [
    'How the script reads this file',
    'Prompt templates',
];

/** Whether a parsed '## Heading' section is something the GUI may edit. */
function isRollTable(name, bullets) {
    return !NON_TABLE_SECTIONS.includes(name) && bullets.length > 0;
}

/** One bullet line -> { raw, enabled }, or null if the line isn't a bullet at all. */
function matchBulletLine(line) {
    const disabled = line.match(DISABLED_BULLET_RE);
    if (disabled) return { raw: disabled[1], enabled: false };
    const active = line.match(ENABLED_BULLET_RE);
    if (active) return { raw: active[1], enabled: true };
    return null;
}

/** A bullet's raw text (weight prefix still attached) -> { weight, text }. */
function splitWeight(raw) {
    const m = raw.match(WEIGHT_RE);
    return m ? { weight: Number(m[1]), text: m[2] } : { weight: 1, text: raw };
}

function parseTableFile(fileText) {
    const lines = fileText.split('\n');
    const tables = [];
    let current = null;
    for (const line of lines) {
        const heading = line.match(HEADING_RE);
        if (heading) {
            current = { name: heading[1], bullets: [] };
            tables.push(current);
            continue;
        }
        if (!current) continue;
        const bullet = matchBulletLine(line);
        if (!bullet) continue;
        const { weight, text } = splitWeight(bullet.raw);
        current.bullets.push({ text, weight, enabled: bullet.enabled });
    }
    return tables;
}

function toggleBulletInText(fileText, tableName, bulletText, enabled) {
    if (NON_TABLE_SECTIONS.includes(tableName)) {
        return { ok: false, error: `"${tableName}" is not a roll table - it is the generator's own documentation` };
    }
    const lines = fileText.split('\n');
    let inTarget = false;
    for (let i = 0; i < lines.length; i++) {
        const heading = lines[i].match(HEADING_RE);
        if (heading) {
            inTarget = heading[1] === tableName;
            continue;
        }
        if (!inTarget) continue;
        const bullet = matchBulletLine(lines[i]);
        if (!bullet) continue;
        const { text } = splitWeight(bullet.raw);
        if (text !== bulletText) continue;

        if (bullet.enabled === enabled) return { ok: true, text: fileText }; // already in the requested state

        lines[i] = enabled ? `- ${bullet.raw}` : `<!-- - ${bullet.raw} -->`;
        return { ok: true, text: lines.join('\n') };
    }
    return { ok: false, error: `no bullet matching that text under "## ${tableName}"` };
}

/** The inverse of splitWeight(): weight 1 has no prefix, matching every plain bullet already in the file. */
function formatRaw(weight, text) {
    return weight === 1 ? text : `x${weight} ${text}`;
}

function setBulletWeightInText(fileText, tableName, bulletText, weight) {
    if (!Number.isInteger(weight) || weight < 1) {
        return { ok: false, error: 'weight must be an integer >= 1' };
    }
    if (NON_TABLE_SECTIONS.includes(tableName)) {
        return { ok: false, error: `"${tableName}" is not a roll table - it is the generator's own documentation` };
    }
    const lines = fileText.split('\n');
    let inTarget = false;
    for (let i = 0; i < lines.length; i++) {
        const heading = lines[i].match(HEADING_RE);
        if (heading) {
            inTarget = heading[1] === tableName;
            continue;
        }
        if (!inTarget) continue;
        const bullet = matchBulletLine(lines[i]);
        if (!bullet) continue;
        const { weight: currentWeight, text } = splitWeight(bullet.raw);
        if (text !== bulletText) continue;

        if (currentWeight === weight) return { ok: true, text: fileText }; // already at that weight

        const raw = formatRaw(weight, text);
        lines[i] = bullet.enabled ? `- ${raw}` : `<!-- - ${raw} -->`;
        return { ok: true, text: lines.join('\n') };
    }
    return { ok: false, error: `no bullet matching that text under "## ${tableName}"` };
}

/**
 * Many bullet edits applied in one pass over the file text.
 *
 * `edits` is a list of `{ table, text, enabled?, weight? }`. Omitting
 * `enabled` leaves the bullet's enabled state alone; omitting `weight` leaves
 * its weight alone; giving both rewrites the line once rather than twice.
 * Returns `{ text, applied, failed }`, where `failed` carries each rejected
 * edit with the reason - the caller decides what to do about it, which is the
 * whole point: applying a preset used to call the single-edit writers below
 * in a loop and discard every {ok:false} they returned, so a rejected write
 * was reported to the user as a success.
 *
 * Walking the file once also makes an apply O(file) rather than
 * O(edits x file): each single-edit writer re-reads, re-parses and re-writes
 * the whole of npc-generator-tables.md, so a 40-bullet preset was 40 full
 * rewrites, and the file was observably half-applied in between.
 *
 * Resolves a bullet to its FIRST matching line, the same rule
 * toggleBulletInText() and setBulletWeightInText() already follow. Where a
 * table carries the same bullet text twice, the later copies are unreachable
 * here as they always were - see docs/known-issues.md.
 */
function applyEditsInText(fileText, edits) {
    const lines = fileText.split('\n');

    // One indexing pass: table -> text -> [line index]. Built before any
    // rewriting so the line numbers stay valid; edits only ever replace a
    // line in place, never insert or delete one, so they cannot shift.
    const index = new Map();
    let current = null;
    for (let i = 0; i < lines.length; i++) {
        const heading = lines[i].match(HEADING_RE);
        if (heading) {
            current = heading[1];
            if (!index.has(current)) index.set(current, new Map());
            continue;
        }
        if (current === null) continue;
        const bullet = matchBulletLine(lines[i]);
        if (!bullet) continue;
        const { text } = splitWeight(bullet.raw);
        const byText = index.get(current);
        if (!byText.has(text)) byText.set(text, []);
        byText.get(text).push(i);
    }

    const applied = [];
    const failed = [];
    for (const edit of edits) {
        const { table, text } = edit;
        if (NON_TABLE_SECTIONS.includes(table)) {
            failed.push({ ...edit, error: `"${table}" is not a roll table - it is the generator's own documentation` });
            continue;
        }
        if (edit.weight !== undefined && (!Number.isInteger(edit.weight) || edit.weight < 1)) {
            failed.push({ ...edit, error: 'weight must be an integer >= 1' });
            continue;
        }
        const at = index.get(table)?.get(text);
        if (!at || !at.length) {
            failed.push({ ...edit, error: `no bullet matching that text under "## ${table}"` });
            continue;
        }
        // Re-read the line rather than trusting the index's snapshot of it:
        // an earlier edit in this same batch may already have rewritten it,
        // and a disable followed by a reweight should keep the disable.
        const i = at[0];
        const bullet = matchBulletLine(lines[i]);
        const { weight: currentWeight } = splitWeight(bullet.raw);
        const enabled = edit.enabled === undefined ? bullet.enabled : edit.enabled;
        const weight = edit.weight === undefined ? currentWeight : edit.weight;
        const raw = formatRaw(weight, text);
        lines[i] = enabled ? `- ${raw}` : `<!-- - ${raw} -->`;
        applied.push({ ...edit });
    }
    return { text: lines.join('\n'), applied, failed };
}

function readTables(filePath) {
    return parseTableFile(fs.readFileSync(filePath, 'utf8'))
        .filter((table) => isRollTable(table.name, table.bullets));
}

function toggleBulletOnDisk(filePath, tableName, bulletText, enabled) {
    const fileText = fs.readFileSync(filePath, 'utf8');
    const result = toggleBulletInText(fileText, tableName, bulletText, enabled);
    if (!result.ok) return result;
    fs.writeFileSync(filePath, result.text);
    return { ok: true };
}

function setBulletWeightOnDisk(filePath, tableName, bulletText, weight) {
    const fileText = fs.readFileSync(filePath, 'utf8');
    const result = setBulletWeightInText(fileText, tableName, bulletText, weight);
    if (!result.ok) return result;
    fs.writeFileSync(filePath, result.text);
    return { ok: true };
}

/**
 * applyEditsInText() against a file, with a single read and a single write.
 *
 * The write is skipped entirely when nothing applied, so a batch that was
 * rejected in full leaves the file's mtime alone.
 */
function applyEditsOnDisk(filePath, edits) {
    const fileText = fs.readFileSync(filePath, 'utf8');
    const { text, applied, failed } = applyEditsInText(fileText, edits);
    if (applied.length) fs.writeFileSync(filePath, text);
    return { applied, failed };
}

module.exports = {
    parseTableFile, toggleBulletInText, readTables, toggleBulletOnDisk,
    setBulletWeightInText, setBulletWeightOnDisk, splitWeight,
    applyEditsInText, applyEditsOnDisk,
    isRollTable, NON_TABLE_SECTIONS,
};
