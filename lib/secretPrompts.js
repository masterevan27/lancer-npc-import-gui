/**
 * Secret prompts: the user's fill-in-the-blank prompt templates for Secret
 * mode, read by generate-npc.py's --secret-prompts. The listing runs the
 * generator's own --list-secret-prompts so there is exactly one parser of
 * the file format; this module only lists the folder, validates a
 * selection against that listing, and reads the slot tables out of a
 * stored record's snapshot so the gallery can offer to re-roll them.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const FILE_NAME_RE = /^[^\\/]+\.md$/i;

function isSecretPromptsFileName(name) {
    return typeof name === 'string' && FILE_NAME_RE.test(name) && name.toLowerCase() !== '.md';
}

function promptFiles(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    return entries.filter(entry => entry.isFile() && isSecretPromptsFileName(entry.name))
        .map(entry => entry.name).sort((a, b) => a.localeCompare(b));
}

/**
 * { dir, exists, files } where files is the generator's own listing: each
 * { file, templates: [{ name, weight, pins, npcSlots, secretSlots }] } or
 * { file, error }. A missing folder is exists: false with no files, like
 * listSecretTables; nothing is spawned for it or for an empty folder.
 */
function listSecretPrompts({ dir, script, tablesPath, tablesDir, configFile, artStylesPath, executable }) {
    const names = promptFiles(dir);
    if (names === null) return Promise.resolve({ dir, exists: false, files: [] });
    if (!names.length) return Promise.resolve({ dir, exists: true, files: [] });
    const args = [script, '--secret', '--secret-config', configFile, '--art-styles', artStylesPath,
        '--tables', tablesPath, '--secret-tables-dir', tablesDir, '--list-secret-prompts',
        ...names.flatMap(name => ['--secret-prompts', path.join(dir, name)])];
    return new Promise((resolve, reject) => {
        execFile(executable, args, { cwd: path.dirname(script), windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
            encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (error, stdout, stderr) => {
            if (error) return reject(new Error(stderr.trim() || 'Could not list secret prompts. Check that the generator supports --list-secret-prompts.'));
            let data;
            try { data = JSON.parse(stdout); } catch { data = null; }
            if (!data || !Array.isArray(data.files)) {
                return reject(new Error('The generator did not return a secret prompt listing. Update lancer-art-generator.'));
            }
            resolve({ dir, exists: true, files: data.files });
        });
    });
}

/** The create request's secretPrompt, resolved to the file's path - or null for none. */
function validateSelection(raw, listing) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('secretPrompt must be {file, name}');
    const { file, name } = raw;
    const known = isSecretPromptsFileName(file) && listing.files.find(entry => entry.file === file);
    if (!known) throw new Error(`unknown secret prompts file "${file}"`);
    if (known.error) throw new Error(`${file}: ${known.error}`);
    if (typeof name !== 'string' || !name.trim()) throw new Error('secret prompt name must be a non-empty string');
    if (name !== 'random' && !(known.templates || []).some(template => template.name === name)) {
        throw new Error(`${file} has no secret prompt "${name}"`);
    }
    return { file: path.join(listing.dir, file), name };
}

/** A preset's secretPrompt: the shape is checked here, existence when it is used. */
function normaliseSelection(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('secretPrompt must be {file, name}');
    if (!isSecretPromptsFileName(raw.file)) throw new Error('secretPrompt.file must be a bare .md file name');
    if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('secretPrompt.name must be a non-empty string');
    return { file: raw.file, name: raw.name };
}

/** Every {secret:Table} a stored snapshot's two texts read, in order, once. */
function secretSlots(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return [];
    const out = [];
    for (const key of ['portrait', 'token']) {
        for (const match of String(snapshot[key] || '').matchAll(/\{secret:([^{}]+)\}/g)) {
            const name = match[1].trim();
            if (name && !out.includes(name)) out.push(name);
        }
    }
    return out;
}

module.exports = { isSecretPromptsFileName, listSecretPrompts, validateSelection, normaliseSelection, secretSlots };
