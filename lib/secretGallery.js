/** Isolated private manifest and job store. No public import/cache callbacks. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { within, canonical } = require('./secretMode');
const artStyles = require('./artStyles');
const colorGuidance = require('./colorGuidance');
const backgrounds = require('./backgrounds');
const dynamicBackgrounds = require('./dynamicBackgrounds');
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };
function createGallery({ config, configFile, paths, artStylesPath, colorGuidancePath, workflowCatalog = require('./workflows').createCatalog(path.dirname(paths.generateNpcScript)), rerollableFor = () => [] }) {
    const jobs = new Map();
    let root = config.secretImagesDir || '';
    const blockedRoots = [config.foundryDataRoot, config.sillyTavernBackgroundsDir, config.sillyTavernCharactersDir, ...Object.values(paths), config.spaceshipOutputRoot, path.join(__dirname, '..', 'public')].filter(value => typeof value === 'string' && value);
    function validateRoot(value) {
        if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('secretImagesDir must be an absolute path');
        if (blockedRoots.some(other => within(other, value) || within(value, other)) || within(value, config.npcManifestPath)) throw new Error('Secret storage must be separate from public output and shared data folders');
        return path.resolve(value);
    }
    if (root) root = validateRoot(root);
    const privateRoots = new Set([...(root ? [root] : []), ...(Array.isArray(config.secretImageRoots) ? config.secretImageRoots.filter(p => typeof p === 'string' && path.isAbsolute(p)) : [])]);
    const privateRootPaths = new Map([...privateRoots].map(dir => [dir, canonical(dir)]));
    function isPrivate(file) {
        if (!file) return false;
        const target = canonical(file);
        return [...privateRootPaths.values()].some(rootPath => {
            const rel = path.relative(rootPath, target);
            return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
        });
    }
    function ready() { if (!root) throw new Error('Set secretImagesDir before generating private images'); return root; }
    function manifest() {
        if (!root) return {};
        try { const data = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')); return data && typeof data === 'object' ? data : {}; } catch { return {}; }
    }
    function entries() { return Object.entries(manifest()).filter(([folder, item]) => item && typeof item.id === 'string' && within(root, folder)).map(([folderPath, item]) => ({ ...item, folderPath })); }
    function imageFile(file) {
        if (!root || !file || !within(root, file) || !TYPES[path.extname(file).toLowerCase()]) return null;
        try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
    }
    function itemImage(item, which) { return ['portrait', 'token'].includes(which) && typeof item[which] === 'string' ? imageFile(path.resolve(item.folderPath, item[which])) : null; }
    function imageUrl(file) { return '/api/secret/image?rel=' + encodeURIComponent(path.relative(root, file).split(path.sep).join('/')); }
    function itemView(item) {
        const portrait = itemImage(item, 'portrait'), token = itemImage(item, 'token');
        const job = [...jobs.values()].find(j => j.itemId === item.id && j.status === 'running');
        return { id: item.id, name: item.name, kind: item.kind || 'npc', traits: item.traits || {}, callsign: item.callsign,
            rerollable: rerollableFor({ ...item, kind: item.kind || 'npc' }), artStale: !!item.artStale, regenStatus: job?.status || null,
            when: item.when, seed: item.seed, artStyle: artStyles.metadata(item), colorGuidance: colorGuidance.metadata(item), secret: true, importable: false,
            portraitUrl: portrait ? imageUrl(portrait) : null, tokenUrl: token ? imageUrl(token) : null,
            portraitPrompt: item.portraitPrompt || null, tokenPrompt: item.tokenPrompt || null,
            // The generator writes both only when the roll used them.
            extraTraits: item.extraTraits && typeof item.extraTraits === 'object' ? item.extraTraits : {},
            disabledTables: Array.isArray(item.disabledTables) ? item.disabledTables : [] };
    }
    function backgroundFiles() {
        if (!root) return [];
        const result = [];
        function walk(dir) {
            if (!within(root, dir)) return;
            let names; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const entry of names) {
                const file = path.join(dir, entry.name);
                if (entry.isSymbolicLink()) continue;
                if (entry.isDirectory()) walk(file);
                else if (imageFile(file) && !backgrounds.isAnimationFile(entry.name)) result.push(file);
            }
        }
        walk(path.join(root, 'backgrounds')); return result;
    }
    function styleArgs(id, workflow) { const style = artStyles.select(artStylesPath, id || 'default', true); return ['--art-style', style.id, '--art-styles', artStylesPath, '--secret', '--secret-config', configFile, ...workflowCatalog.args(workflow, true)]; }
    let dynamic = null;
    function scenes() {
        ready();
        if (!dynamic) dynamic = dynamicBackgrounds.createService({ script: paths.generateBackgroundScript, tables: paths.dynamicBackgroundTablesPath,
            root: path.join(root, 'backgrounds'), executable: config.pythonExecutable, jobs,
            extraArgs: styleArgs, urlPrefix: '/api/secret/backgrounds/image' });
        return dynamic;
    }
    function backgroundViews() {
        return backgroundFiles().map(file => {
            const rel = path.relative(path.join(root, 'backgrounds'), file).split(path.sep).join('/');
            const scene = scenes().metadata(rel);
            return { rel, name: backgrounds.displayName(path.basename(file)), url: imageUrl(file), mtime: fs.statSync(file).mtimeMs,
                scene, artStyle: artStyles.metadata(scene || {}), battlemaps: scenes().mapsFor(rel), battlemapJob: scenes().mapJob(rel), animation: null, sillyTavern: null };
        });
    }
    function items() {
        return [...entries().map(itemView), ...backgroundViews().map(view => ({ id: backgrounds.idFor(view.rel), kind: 'background', name: view.name,
            artStyle: view.artStyle, portraitUrl: view.url, tokenUrl: null, traits: {}, secret: true, importable: false, background: view }))];
    }
    function start(args, kind, dryRun) {
        ready(); fs.mkdirSync(root, { recursive: true });
        for (const [id, job] of jobs) if (job.doneAt && job.doneAt < Date.now() - 3600000) jobs.delete(id);
        if ([...jobs.values()].filter(j => j.status === 'running').length >= 4) throw new Error('Too many private generation jobs');
        const before = new Set(items().map(i => i.id));
        const jobId = crypto.randomUUID(), job = { secret: true, status: 'running', kind, dryRun: !!dryRun, log: '', produced: null, producedIds: null };
        jobs.set(jobId, job);
        const child = spawn(config.pythonExecutable, args, { cwd: path.dirname(args[0]), windowsHide: true });
        const collect = chunk => { job.log = (job.log + chunk).slice(-20000); };
        child.stdout.on('data', collect); child.stderr.on('data', collect);
        const timer = setTimeout(() => { job.error = 'Private generation timed out'; child.kill(); }, 1800000);
        child.on('error', err => { job.error = err.message; });
        child.on('close', code => {
            clearTimeout(timer); job.doneAt = Date.now(); job.status = code === 0 && !job.error ? 'done' : 'error';
            if (job.status === 'error') job.error ||= job.log || 'Generation failed';
            if (!dryRun) { job.producedIds = items().filter(i => !before.has(i.id)).map(i => i.id); job.produced = job.producedIds.length; }
        });
        return { ok: true, jobId, secret: true };
    }
    return {
        jobs, isPrivate, items, backgroundViews, scenes, imageFile, types: TYPES,
        find: id => entries().find(item => item.id === id),
        get root() { return root; },
        image(url) {
            if (!root) return null;
            const rel = url.searchParams.get('rel');
            if (rel) return imageFile(path.resolve(root, rel));
            const item = entries().find(i => i.id === url.searchParams.get('id'));
            return item ? itemImage(item, url.searchParams.get('which') || 'portrait') : null;
        },
        setRoot(value) {
            const next = validateRoot(value);
            if ([...jobs.values()].some(j => j.status === 'running')) throw new Error('Wait for private generation to finish before changing storage');
            const saved = JSON.parse(fs.readFileSync(configFile, 'utf8')); saved.secretImagesDir = next;
            saved.secretImageRoots = [...new Set([...privateRoots, next])];
            fs.writeFileSync(configFile, JSON.stringify(saved, null, 2) + '\n');
            root = next; privateRoots.add(next); privateRootPaths.set(next, canonical(next)); dynamic = null; jobs.clear(); return root;
        },
        startCreate(kind, opts) {
            ready();
            if (opts.server) throw new Error('Private generation uses the configured backend; server overrides are unavailable');
            const args = kind.createArgs({ ...opts, manifestPath: path.join(root, 'manifest.json'), outputRoot: path.join(root, 'spaceships') });
            args.push(...styleArgs(opts.artStyle, opts.workflow));
            // Hidden guidance is allowed here: private generation is authenticated.
            if (kind.id === 'npc' && colorGuidancePath) {
                const guidance = colorGuidance.select(colorGuidancePath, opts.colorGuidance || 'default', true);
                if (opts.colorGuidance) args.push('--color-guidance', guidance.id, '--color-guidance-catalog', colorGuidancePath);
            }
            return start(args, kind.id, opts.dryRun);
        },
        startRegen(kind, item, body, trait = null) {
            if ([...jobs.values()].some(j => j.itemId === item.id && j.status === 'running')) throw new Error('Already regenerating this item');
            const which = body.which || 'both';
            if (!['both', 'portrait', 'token'].includes(which)) throw new Error('Unknown image selection');
            const seedMode = body.seedMode || 'same';
            if (!['same', 'random', 'specific'].includes(seedMode)) throw new Error('Unknown seed mode');
            const newSeed = trait || seedMode === 'random' ? crypto.randomInt(2 ** 32)
                : seedMode === 'specific' ? Number(body.seed) : item.seed;
            if (!Number.isInteger(newSeed) || newSeed < 0 || newSeed > 2 ** 32 - 1) throw new Error('seed must be an integer between 0 and 4294967295');
            const args = kind.regenArgs({ manifestPath: path.join(ready(), 'manifest.json'), id: item.id, newSeed, which });
            args.push('--tables', kind.tables);
            if (trait) args.push('--reroll-trait', trait, '--apply-only');
            args.push(...styleArgs(body.artStyle || artStyles.metadata(item).id, body.workflow));
            // A named guidance is validated (hidden allowed: this is authenticated)
            // and passed on; without one the generator reuses the saved entry.
            if (kind.id === 'npc' && colorGuidancePath && body.colorGuidance) {
                const guidance = colorGuidance.select(colorGuidancePath, body.colorGuidance, true);
                args.push('--color-guidance', guidance.id, '--color-guidance-catalog', colorGuidancePath);
            }
            const result = start(args, kind.id, false);
            jobs.get(result.jobId).itemId = item.id;
            return result;
        },
        renderCatalogue(body, catalogue) {
            const args = backgrounds.renderArgs(paths.generateArtScript, { ...body, catalogue, backgroundsDir: path.join(ready(), 'backgrounds') });
            args.push(...styleArgs(body.artStyle, body.workflow)); return start(args, 'background', false);
        },
    };
}
module.exports = { createGallery };
