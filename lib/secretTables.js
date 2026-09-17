/**
 * The Secret-mode tables folder: the user's own roll tables, which
 * generate-npc.py takes through --extra-tables and rolls alongside the
 * default ones. Two file shapes, both the generator's own -
 *
 *   .json   { "table_name": [ { "value": "...", "weight": 1 }, ... ] }
 *   .md     '## table_name' headings over '- bullet' rows, 'xN ' for weight;
 *           '#tag' at a bullet's end and '(when: tag)' at a heading's end
 *           gate tables (public/secret-gates.js)
 *
 * This module lists files, table values and row counts, and validates the
 * selected tables and fixed values before creation or saving a secret preset.
 * The generator re-validates on every run, so the checks here exist to put a
 * readable reason in the form rather than in a job log, and they mirror the
 * generator's rules rather than extend them.
 */
const fs = require('node:fs');
const path = require('node:path');
const gates = require('../public/secret-gates');

// A bare file name with one of the two extensions. Anything with a separator
// cannot have come from the listing this module produced, so the create route
// refuses it outright rather than resolving it.
const FILE_NAME_RE = /^[^\\/]+\.(json|md)$/i;

function isSecretTablesFileName(name) {
    return typeof name === 'string' && FILE_NAME_RE.test(name) && name !== '.json' && name !== '.md';
}

/** '##' opens a table, '###' groups its choices, '- bullet' is a row; '#tag' and '(when:)' gate them. */
function markdownTables(text) {
    const tables = new Map();
    let current = null;
    let category = '';
    for (const line of text.split(/\r?\n/)) {
        const heading = line.match(/^##\s+(?!#)\s*(.*?)\s*$/);
        if (heading) {
            const { name, when } = gates.splitWhen(heading[1]);
            if (tables.has(name) && String(tables.get(name).when) !== String(when)) {
                throw new Error(`table '${name}' is repeated with a different (when:)`);
            }
            if (!tables.has(name)) tables.set(name, { when, count: 0, values: [], tags: new Map(), groups: new Map() });
            current = name;
            category = '';
            continue;
        }
        const subsection = line.match(/^###\s+(?!#)\s*(.*?)\s*$/);
        if (subsection) {
            category = subsection[1];
            continue;
        }
        if (current && /^-\s+\S/.test(line)) {
            if (/^-\s+x0+\s/.test(line)) continue;
            const { value, tags } = gates.splitTags(line.replace(/^-\s+/, '').replace(/^x\d+\s+/, '').trim());
            const table = tables.get(current);
            table.count += 1;
            if (!table.values.includes(value)) table.values.push(value);
            table.tags.set(value, [...new Set([...(table.tags.get(value) || []), ...tags])]);
            if (!table.groups.has(category)) table.groups.set(category, new Set());
            table.groups.get(category).add(value);
        }
    }
    return [...tables].filter(([, table]) => table.count > 0)
        .map(([name, { when, count, values, tags, groups }]) => ({ name, count, values,
            ...(when ? { when } : {}),
            ...tagsField(tags),
            ...([...groups.keys()].some(Boolean) ? {
                groups: [...groups].map(([name, values]) => ({ name, values: [...values] })),
            } : {}),
        }));
}

/** { tags: { value: [tag] } } for the values that carry any, or nothing. */
function tagsField(tags) {
    const tagged = [...tags].filter(([, list]) => list.length);
    return tagged.length ? { tags: Object.fromEntries(tagged) } : {};
}

function jsonTables(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('an extra tables file is one JSON object of table name -> list of rows');
    }
    return Object.entries(data).map(([name, spec]) => {
        if (!name.trim()) throw new Error('a table name must be non-blank text');
        const gated = spec && typeof spec === 'object' && !Array.isArray(spec);
        const when = gated ? gates.checkWhen(name, spec.when) : null;
        const rows = gated ? spec.rows : spec;
        if (!Array.isArray(rows) || !rows.length) {
            throw new Error(`table "${name}" must be a non-empty list of rows`);
        }
        const tags = new Map();
        for (const row of rows) {
            if (!row || typeof row !== 'object' || typeof row.value !== 'string' || !row.value.trim()) {
                throw new Error(`every row of "${name}" is {"value": text, "weight": number}`);
            }
            const weight = row.weight === undefined ? 1 : row.weight;
            if (typeof weight !== 'number' || !(weight > 0)) {
                throw new Error(`"${name}" row "${row.value}" has a weight that is not a positive number`);
            }
            const rowTags = row.tags === undefined ? [] : row.tags;
            if (!Array.isArray(rowTags) || rowTags.some(tag => typeof tag !== 'string' || !gates.TAG_RE.test(tag))) {
                throw new Error(`"${name}" row "${row.value}" has tags that are not a list of letters, digits, - and _`);
            }
            const value = row.value.trim();
            tags.set(value, [...new Set([...(tags.get(value) || []), ...rowTags.map(tag => tag.toLowerCase())])]);
        }
        return { name, count: rows.length, values: [...tags.keys()], ...(when ? { when } : {}), ...tagsField(tags) };
    });
}

/**
 * One file's listing entry: { file, tables: [{ name, count, values }] }, or
 * { file, tables: [], error } when the generator would refuse it. `reserved`
 * is the default tables' names - a private table may not share one, since
 * --disable-table is how a private table takes a default one's place.
 */
function readSecretTablesFile(file, reserved = []) {
    const name = path.basename(file);
    try {
        const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
        const tables = name.toLowerCase().endsWith('.md') ? markdownTables(text) : jsonTables(text);
        if (!tables.length) throw new Error('holds no tables');
        const clash = tables.find((table) => reserved.includes(table.name));
        if (clash) {
            throw new Error(`"${clash.name}" is a default table; disable that table and give the private one another name`);
        }
        return { file: name, tables };
    } catch (err) {
        const reason = err instanceof SyntaxError ? `not valid JSON: ${err.message}` : err.message;
        return { file: name, tables: [], error: reason };
    }
}

/**
 * Every .json and .md file at the top of `dir`, by name, each read. A folder
 * that does not exist is `exists: false` with no files rather than an error:
 * on a fresh install nothing has created it yet, and the form says so.
 */
function listSecretTables(dir, { reserved = [] } = {}) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return { dir, exists: false, files: [] };
    }
    const names = entries
        .filter((entry) => entry.isFile() && isSecretTablesFileName(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
    const files = names.map((name) => readSecretTablesFile(path.join(dir, name), reserved));
    // Gate order and unknown tags are checked across the whole folder, in
    // listing order - the order the form sends files to the generator.
    const errors = gates.orderErrors(files);
    return { dir, exists: true, files: files.map((file) => errors.has(file.file)
        ? { file: file.file, tables: [], error: errors.get(file.file) } : file) };
}

function validateSelection(raw, listing, disableable) {
    const picks = raw.extraTables ?? [];
    const disabled = raw.disabledTables ?? [];
    if (!Array.isArray(picks) || !Array.isArray(disabled)) throw new Error('secret table selections must be arrays');
    const chosen = new Map(), extraValues = [], extraTargets = [], selected = [];
    const loadedNames = new Set();
    let narrowed = false;
    for (const pick of picks) {
        const file = pick?.file;
        const known = isSecretTablesFileName(file) && listing.files.find(entry => entry.file === file);
        if (!known) throw new Error(`unknown secret tables file "${file}"`);
        if (known.error) throw new Error(`${file}: ${known.error}`);
        if (chosen.has(file)) throw new Error(`duplicate secret tables file "${file}"`);
        for (const table of known.tables) {
            if (loadedNames.has(table.name)) throw new Error(`table "${table.name}" is already loaded from another file`);
            loadedNames.add(table.name);
        }
        const names = known.tables.map(table => table.name);
        if (pick.tables !== undefined && !Array.isArray(pick.tables)) throw new Error(`${file}: tables must be an array`);
        const tables = [...new Set(pick.tables ?? names)];
        if (!tables.length) throw new Error(`${file}: no tables selected`);
        for (const name of tables) if (!names.includes(name)) throw new Error(`${file} has no table "${name}"`);
        const values = pick.values ?? {};
        if (typeof values !== 'object' || Array.isArray(values)) throw new Error(`${file}: values must be an object`);
        for (const [table, value] of Object.entries(values)) {
            if (!tables.includes(table) || typeof value !== 'string' || !known.tables.find(t => t.name === table)?.values.includes(value)) {
                throw new Error(`invalid value for secret table "${table}" in ${file}`);
            }
            if (table.includes('=')) throw new Error('fixed-value table names cannot contain "="');
            extraValues.push({ table, value });
        }
        const targets = pick.targets ?? {};
        if (typeof targets !== 'object' || Array.isArray(targets)) throw new Error(`${file}: targets must be an object`);
        for (const [table, target] of Object.entries(targets)) {
            if (!tables.includes(table) || !['portrait', 'token', 'both'].includes(target)) {
                throw new Error(`invalid target for secret table "${table}" in ${file}`);
            }
            if (table.includes('=')) throw new Error('targeted table names cannot contain "="');
            extraTargets.push({ table, target });
        }
        narrowed ||= tables.length !== names.length;
        chosen.set(file, tables);
        selected.push({ file, tables, values: { ...values }, ...(Object.keys(targets).length ? { targets: { ...targets } } : {}) });
    }
    for (const name of disabled) if (!disableable.includes(name)) throw new Error(`cannot disable table "${name}"`);
    // The same gate resolution the generator runs, so an impossible
    // selection is refused here with the generator's own words.
    const order = gates.rollOrder([...chosen.keys()].map(file => listing.files.find(entry => entry.file === file)));
    const gatePicks = new Map();
    for (const pick of selected) {
        for (const table of pick.tables) {
            gatePicks.set(gates.entryKey(pick.file, table), Object.hasOwn(pick.values, table) ? pick.values[table] : '');
        }
    }
    const { error: gateError } = gates.resolveGates(order, gatePicks);
    if (gateError) throw new Error(gateError);
    return {
        extraTables: [...chosen.keys()].map(file => path.join(listing.dir, file)),
        extraTableNames: narrowed ? [...chosen.values()].flat() : [],
        extraValues, extraTargets, disabledTables: [...new Set(disabled)], selected,
    };
}

module.exports = { listSecretTables, readSecretTablesFile, isSecretTablesFileName, markdownTables, jsonTables, validateSelection };
