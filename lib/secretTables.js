/**
 * The Secret-mode tables folder: the user's own roll tables, which
 * generate-npc.py takes through --extra-tables and rolls alongside the
 * default ones. Two file shapes, both the generator's own -
 *
 *   .json   { "table_name": [ { "value": "...", "weight": 1 }, ... ] }
 *   .md     '## table_name' headings over '- bullet' rows, 'xN ' for weight
 *
 * - and this module only LISTS them: which files are there, which tables
 * each holds and how many rows, and which files the generator would refuse.
 * The generator re-validates on every run, so the checks here exist to put a
 * readable reason in the form rather than in a job log, and they mirror the
 * generator's rules rather than extend them.
 */
const fs = require('node:fs');
const path = require('node:path');

// A bare file name with one of the two extensions. Anything with a separator
// cannot have come from the listing this module produced, so the create route
// refuses it outright rather than resolving it.
const FILE_NAME_RE = /^[^\\/]+\.(json|md)$/i;

function isSecretTablesFileName(name) {
    return typeof name === 'string' && FILE_NAME_RE.test(name) && name !== '.json' && name !== '.md';
}

/** '## Heading' opens a table, '- bullet' is a row; prose between is ignored. */
function markdownTables(text) {
    const counts = new Map();
    let current = null;
    for (const line of text.split(/\r?\n/)) {
        const heading = line.match(/^##\s+(?!#)\s*(.*?)\s*$/);
        if (heading) {
            current = heading[1];
            if (!counts.has(current)) counts.set(current, 0);
            continue;
        }
        if (current && /^-\s+\S/.test(line)) counts.set(current, counts.get(current) + 1);
    }
    return [...counts].filter(([, count]) => count > 0).map(([name, count]) => ({ name, count }));
}

function jsonTables(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('an extra tables file is one JSON object of table name -> list of rows');
    }
    return Object.entries(data).map(([name, rows]) => {
        if (!name.trim()) throw new Error('a table name must be non-blank text');
        if (!Array.isArray(rows) || !rows.length) {
            throw new Error(`table "${name}" must be a non-empty list of rows`);
        }
        for (const row of rows) {
            if (!row || typeof row !== 'object' || typeof row.value !== 'string' || !row.value.trim()) {
                throw new Error(`every row of "${name}" is {"value": text, "weight": number}`);
            }
            const weight = row.weight === undefined ? 1 : row.weight;
            if (typeof weight !== 'number' || !(weight > 0)) {
                throw new Error(`"${name}" row "${row.value}" has a weight that is not a positive number`);
            }
        }
        return { name, count: rows.length };
    });
}

/**
 * One file's listing entry: { file, tables: [{ name, count }] }, or
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
    return { dir, exists: true, files: names.map((name) => readSecretTablesFile(path.join(dir, name), reserved)) };
}

module.exports = { listSecretTables, readSecretTablesFile, isSecretTablesFileName, markdownTables, jsonTables };
