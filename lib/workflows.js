/** Discover generation graphs; metadata lives beside the generator, not in the graph. */
const fs = require('node:fs');
const path = require('node:path');
const { within } = require('./secretMode');

function createCatalog(generatorRoot) {
    const dir = path.join(generatorRoot, 'workflows', 'api');
    const metadataFile = path.join(generatorRoot, 'workflows.json');
    function load() {
        let metadata = [];
        try {
            const data = JSON.parse(fs.readFileSync(metadataFile, 'utf8').replace(/^\uFEFF/, ''));
            if (!Array.isArray(data.workflows)) throw new Error('workflows.json must contain a workflows array');
            metadata = data.workflows;
            const seen = new Set();
            for (const item of metadata) {
                if (!item || typeof item.file !== 'string' || path.basename(item.file) !== item.file || seen.has(item.file)) throw new Error('Invalid or duplicate workflow file');
                seen.add(item.file);
                for (const flag of ['hidden', 'secret']) if (item[flag] !== undefined && typeof item[flag] !== 'boolean') throw new Error(`${flag} must be a boolean`);
                if (item.name !== undefined && (typeof item.name !== 'string' || !item.name.trim())) throw new Error('Invalid workflow name');
            }
        } catch (err) { if (err.code !== 'ENOENT') throw err; }
        let files;
        try { files = fs.readdirSync(dir); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
        const secretDir = path.join(dir, 'secret');
        if (within(dir, secretDir)) {
            try { files.push(...fs.readdirSync(secretDir).map(file => 'secret/' + file)); }
            catch (err) { if (err.code !== 'ENOENT') throw err; }
        }
        return files.sort().filter(file => /\.json$/i.test(file) && !/^util_/i.test(path.basename(file))).flatMap(file => {
            if (!within(dir, path.join(dir, file))) return [];
            let graph;
            try { graph = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, '')); } catch { return []; }
            const nodes = graph && typeof graph === 'object' && !Array.isArray(graph) ? Object.values(graph) : [];
            if (!nodes.length || !nodes.every(n => n && typeof n.class_type === 'string' && n.inputs && typeof n.inputs === 'object')) return [];
            const meta = metadata.find(m => m.file === file) || {};
            return [{ id: file, name: meta.name || file.replace(/\.json$/i, ''), hidden: file.startsWith('secret/') || meta.hidden === true || meta.secret === true }];
        });
    }
    function list(secret = false) {
        return [{ id: 'default', name: 'Default' }, ...load().filter(w => secret || !w.hidden).map(({ id, name }) => ({ id, name }))];
    }
    function args(id, secret = false) {
        if (!id || id === 'default') return [];
        if (typeof id !== 'string' || !list(secret).some(w => w.id === id)) throw new Error('Unknown or unavailable workflow');
        return ['--workflow', path.join(dir, id)];
    }
    return { list, args };
}
module.exports = { createCatalog };
