const fs = require('node:fs');
const DEFAULT = Object.freeze({ id: 'default', name: 'Default', prompt: '', hidden: false });
function load(file) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return [DEFAULT]; throw err; }
    text = text.replace(/^\uFEFF/, '');
    if (!text.trim()) return [DEFAULT];
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Invalid art style catalog JSON'); }
    if (!data || !Array.isArray(data.styles)) throw new Error('art style catalog must contain a styles array');
    const ids = new Set(['default']);
    const styles = data.styles.map(style => {
        if (!style || typeof style !== 'object' || typeof style.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(style.id) || ids.has(style.id)) throw new Error('invalid, duplicate or reserved art style id');
        if (typeof style.name !== 'string' || !style.name.trim() || typeof style.prompt !== 'string' || !style.prompt.trim()) throw new Error('art style needs a name and prompt');
        for (const key of ['hidden', 'secret']) if (style[key] !== undefined && typeof style[key] !== 'boolean') throw new Error(`${key} must be a boolean`);
        ids.add(style.id);
        return { id: style.id, name: style.name.trim(), prompt: style.prompt.trim(), hidden: style.hidden === true || style.secret === true };
    });
    return [DEFAULT, ...styles];
}
function select(file, id = 'default', secret = false) {
    const style = load(file).find(s => s.id === id);
    if (!style || (style.hidden && !secret)) throw new Error('unknown or unavailable art style');
    return style;
}
function list(file, secret = false) { return load(file).filter(s => secret || !s.hidden).map(({ id, name }) => ({ id, name })); }
function metadata(item) { const s = item.art_style || item.artStyle; return s && typeof s.id === 'string' && typeof s.name === 'string' ? { id: s.id, name: s.name } : { id: 'default', name: 'Default' }; }
function hidden(file, item) {
    const style = item.art_style || item.artStyle || {};
    if (item.secret === true || item.hidden === true || style.secret === true || style.hidden === true) return true;
    try { return load(file).some(s => s.id === style.id && s.hidden); } catch { return true; }
}
module.exports = { load, select, list, metadata, hidden };
