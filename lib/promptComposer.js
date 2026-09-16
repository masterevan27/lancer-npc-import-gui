const { execFile } = require('node:child_process');
const path = require('node:path');

function normaliseLayout(value) {
    if (value == null) return {};
    if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['portrait', 'token'].includes(k))) {
        throw new Error('promptLayout must contain only portrait and token lists');
    }
    const result = {};
    for (const [target, entries] of Object.entries(value)) {
        if (!Array.isArray(entries) || entries.length > 256) throw new Error('promptLayout lists must have at most 256 snippets');
        const seen = new Set();
        result[target] = entries.map(entry => {
            const id = typeof entry === 'string' ? entry : entry?.id;
            if (typeof id !== 'string' || !id || id.length > 240 || seen.has(id)) {
                throw new Error('promptLayout snippet IDs must be unique, non-empty strings of at most 240 characters');
            }
            seen.add(id);
            if (typeof entry === 'string') return id;
            if (!entry || Array.isArray(entry) || Object.keys(entry).sort().join(',') !== 'id,text' || !id.startsWith('custom:') || typeof entry.text !== 'string' || entry.text.length > 4000) {
                throw new Error('custom snippets need a custom: ID and text of at most 4000 characters');
            }
            return { id, text: entry.text };
        });
    }
    if (JSON.stringify(result).length > 24000) throw new Error('promptLayout is too large (24,000 characters maximum)');
    return result;
}

function preview(executable, args) {
    return new Promise((resolve, reject) => {
        execFile(executable, args, { cwd: path.dirname(args[0]), windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
            encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (error, stdout, stderr) => {
            if (error) return reject(new Error(stderr.trim() || 'Prompt preview failed. Check that the generator supports --prompt-preview.'));
            try {
                const data = JSON.parse(stdout);
                if (!Array.isArray(data.portrait) || !Array.isArray(data.token)) throw new Error('invalid preview');
                resolve(data);
            } catch { reject(new Error('The generator did not return prompt fragments. Update lancer-art-generator.')); }
        });
    });
}

module.exports = { normaliseLayout, preview };
