/**
 * The colour guidance catalog: the generator's color-guidance.json, the same
 * shape as art-styles.json under a "guidance" key. Each entry's prompt is a
 * complete palette sentence that generate-npc.py swaps in for its house
 * "Keep the palette restrained ..." line. The GUI only ever needs ids and
 * names (the prompt text stays server-side, as with art styles), plus the
 * saved `color_guidance` metadata a manifest record carries.
 */
const fs = require('node:fs');
const DEFAULT = Object.freeze({ id: 'default', name: 'Default', prompt: '', hidden: false });
function load(file) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return [DEFAULT]; throw err; }
    text = text.replace(/^﻿/, '');
    if (!text.trim()) return [DEFAULT];
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Invalid colour guidance catalog JSON'); }
    if (!data || !Array.isArray(data.guidance)) throw new Error('colour guidance catalog must contain a guidance array');
    const ids = new Set(['default']);
    const entries = data.guidance.map(entry => {
        if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.id) || ids.has(entry.id)) throw new Error('invalid, duplicate or reserved colour guidance id');
        if (typeof entry.name !== 'string' || !entry.name.trim() || typeof entry.prompt !== 'string' || !entry.prompt.trim()) throw new Error('colour guidance needs a name and prompt');
        for (const key of ['hidden', 'secret']) if (entry[key] !== undefined && typeof entry[key] !== 'boolean') throw new Error(`${key} must be a boolean`);
        ids.add(entry.id);
        return { id: entry.id, name: entry.name.trim(), prompt: entry.prompt.trim(), hidden: entry.hidden === true || entry.secret === true };
    });
    return [DEFAULT, ...entries];
}
function select(file, id = 'default', secret = false) {
    const entry = load(file).find(g => g.id === id);
    if (!entry || (entry.hidden && !secret)) throw new Error('unknown or unavailable colour guidance');
    return entry;
}
function list(file, secret = false) { return load(file).filter(g => secret || !g.hidden).map(({ id, name }) => ({ id, name })); }
function metadata(item) { const g = item.color_guidance || item.colorGuidance; return g && typeof g.id === 'string' && typeof g.name === 'string' ? { id: g.id, name: g.name } : { id: 'default', name: 'Default' }; }
module.exports = { load, select, list, metadata };
