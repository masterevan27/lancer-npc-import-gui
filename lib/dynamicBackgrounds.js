/** Dynamic scene CLI bridge. Python owns rolling and prompt construction. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const backgrounds = require('./backgrounds');

function metadataPath(image) {
    return image.slice(0, -path.extname(image).length) + '.background.json';
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function validateRequest(body) {
    if (!object(body)) throw new Error('scene request must be an object');
    for (const [key, min, max] of [['width', 64, 8192], ['height', 64, 8192], ['count', 1, 8], ['seed', 0, 2 ** 32 - 1]]) {
        if (body[key] !== undefined && body[key] !== null &&
            (!Number.isInteger(body[key]) || body[key] < min || body[key] > max)) {
            throw new Error(`${key} must be an integer between ${min} and ${max}`);
        }
    }
    if (body.environment !== undefined && !['outdoor', 'indoor', 'space'].includes(body.environment)) throw new Error('unknown environment');
    if (body.view !== undefined && !['perspective', 'topdown'].includes(body.view)) throw new Error('unknown view');
    for (const key of ['populatePeople', 'interiorLife']) {
        if (body[key] !== undefined && typeof body[key] !== 'boolean') throw new Error(`${key} must be a boolean`);
    }
    if (body.populationDensity !== undefined && !['sparse', 'natural', 'lively'].includes(body.populationDensity)) throw new Error('populationDensity must be sparse, natural or lively');
    if (body.vegetation !== undefined && !['none', 'balanced', 'lush'].includes(body.vegetation)) throw new Error('vegetation must be none, balanced or lush');
    if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 4000)) throw new Error('notes must be text up to 4000 characters');
    if (body.traits !== undefined && (!object(body.traits) || Object.keys(body.traits).length > 50 ||
        Object.entries(body.traits).some(([k, v]) => k.length > 100 || typeof v !== 'string' || v.length > 4000))) throw new Error('traits must map table names to text');
    if (body.locked !== undefined && (!Array.isArray(body.locked) || body.locked.length > 50 ||
        body.locked.some((v) => typeof v !== 'string' || v.length > 100))) throw new Error('locked must be a list of table names');
    if (body.reroll !== undefined && typeof body.reroll !== 'boolean') throw new Error('reroll must be a boolean');
    return body;
}

function createService({ script, tables, root, executable, jobs, onProduced = () => {}, timeoutMs = 1800000, previewTimeoutMs = 15000, extraArgs = () => [], urlPrefix = '/api/backgrounds/image', blockedFile = () => false, beforeStart = () => {} }) {
    const mapJobs = new Map();
    function available() { return fs.existsSync(script) && fs.existsSync(tables); }
    function childFor(args) {
        if (!fs.existsSync(script)) throw new Error(`generate-background.py not found at ${script}`);
        return spawn(executable, [script, ...args], {
            cwd: path.dirname(script), windowsHide: true,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
        });
    }
    function sendInput(child, input) {
        child.stdin.on('error', () => {}); // an early CLI validation exit can close stdin
        child.stdin.end(input === undefined ? '' : JSON.stringify(input));
    }
    function query(args, input) {
        return new Promise((resolve, reject) => {
            let child;
            try { child = childFor([...args, '--tables', tables, ...extraArgs(input?.artStyle)]); } catch (err) { reject(err); return; }
            let out = '', err = '', failure = null;
            const timer = setTimeout(() => {
                failure = new Error('Background preview timed out'); child.kill();
            }, previewTimeoutMs);
            child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
            child.stdout.on('data', (chunk) => {
                out += chunk;
                if (out.length > 2 * 1024 * 1024) { failure = new Error('Background response is too large'); child.kill(); }
            });
            child.stderr.on('data', (chunk) => { err = (err + chunk).slice(-20000); });
            child.on('error', (error) => { clearTimeout(timer); reject(error); });
            child.on('close', (code) => {
                clearTimeout(timer);
                if (failure || code !== 0) { reject(failure || new Error(err.trim() || `Background generator exited with code ${code}`)); return; }
                try { resolve(JSON.parse(out)); } catch { reject(new Error('Background generator returned invalid JSON')); }
            });
            sendInput(child, input);
        });
    }
    function insideFile(rel) {
        const file = backgrounds.resolveInside(root, rel);
        if (file && blockedFile(file)) return null;
        if (!file || !backgrounds.IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase())) return null;
        try {
            const realRoot = fs.realpathSync(root), real = fs.realpathSync(file);
            if (!real.startsWith(realRoot + path.sep) || !fs.statSync(real).isFile()) return null;
            return file;
        } catch { return null; }
    }
    function metadata(rel) {
        const file = insideFile(rel);
        if (!file) return null;
        try {
            const recordPath = metadataPath(file);
            if (blockedFile(recordPath) || !fs.realpathSync(recordPath).startsWith(fs.realpathSync(root) + path.sep)) return null;
            if (fs.statSync(recordPath).size > 256 * 1024) return null;
            const data = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
            return object(data) && ['background', 'battlemap'].includes(data.kind) ? data : null;
        } catch { return null; }
    }
    function sourceKey(rel) {
        const file = insideFile(rel);
        if (!file) return null;
        const real = fs.realpathSync(file);
        return process.platform === 'win32' ? real.toLowerCase() : real;
    }
    function imageView(file) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        return { rel, url: `${urlPrefix}?rel=${encodeURIComponent(rel)}&v=${fs.statSync(file).mtimeMs}` };
    }
    function mapsFor(rel, cache = new Map()) {
        const source = insideFile(rel);
        if (!source) return [];
        const directory = path.dirname(source);
        if (!cache.has(directory)) {
            const records = new Map();
            for (const name of fs.readdirSync(directory)) {
                if (!backgrounds.IMAGE_EXTENSIONS.includes(path.extname(name).toLowerCase())) continue;
                const file = path.join(directory, name);
                const childRel = path.relative(root, file).split(path.sep).join('/');
                const data = metadata(childRel);
                if (data?.kind === 'battlemap' && typeof data.source?.path === 'string') {
                    const key = path.resolve(data.source.path);
                    const list = records.get(key) || [];
                    list.push({ file, data }); records.set(key, list);
                }
            }
            cache.set(directory, records);
        }
        const maps = [];
        for (const { file, data } of cache.get(directory).get(path.resolve(source)) || []) {
            maps.push({ ...imageView(file), seed: data.seed, width: data.width, height: data.height,
                stale: !Number.isFinite(data.source.mtime) || Math.abs(data.source.mtime - fs.statSync(source).mtimeMs) > 1 });
        }
        return maps;
    }
    function start(args, input, kind, options = {}) {
        beforeStart();
        fs.mkdirSync(root, { recursive: true });
        const jobId = crypto.randomUUID();
        const job = { jobId, kind, status: 'running', startedAt: Date.now(), log: '', produced: 0,
            producedIds: [], outputs: [], chain: [], chainError: null };
        jobs.set(jobId, job);
        let child;
        try { child = childFor([...args, ...extraArgs(options.artStyle || input?.artStyle)]); } catch (err) {
            job.status = 'error'; job.error = err.message; return { ok: true, jobId };
        }
        let pending = '';
        const timer = setTimeout(() => { job.error = 'Background generation timed out'; child.kill(); }, timeoutMs);
        const collect = (chunk) => { job.log = (job.log + chunk).slice(-20000); };
        function outputLine(line) {
            if (!line.startsWith('BACKGROUND_RESULT ')) return;
            try {
                const event = JSON.parse(line.slice('BACKGROUND_RESULT '.length));
                if (typeof event.path !== 'string' || !path.isAbsolute(event.path)) return;
                const rel = path.relative(root, event.path).split(path.sep).join('/');
                const file = insideFile(rel);
                if (!file || job.outputs.some((o) => o.rel === rel)) return;
                job.outputs.push(imageView(file));
                job.produced = job.outputs.length;
                if (kind === 'dynamic') job.producedIds.push(backgrounds.idFor(rel));
            } catch { /* ordinary log output is not a result */ }
        }
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            collect(chunk); pending += chunk;
            const lines = pending.split(/\r?\n/); pending = lines.pop();
            lines.forEach(outputLine);
            if (pending.length > 256 * 1024) pending = ''; // bound unterminated diagnostics
        });
        child.stderr.on('data', collect);
        child.on('error', (err) => { job.error = err.message; });
        child.on('close', (code) => {
            clearTimeout(timer); outputLine(pending); job.doneAt = Date.now();
            if (code !== 0 || job.error || !job.produced) job.error ||= job.log.trim() || 'The generator produced no images';
            try { onProduced(job, options); } catch (err) { job.chainError = err.message; }
            job.status = job.error ? 'error' : 'done';
        });
        sendInput(child, input);
        return { ok: true, jobId };
    }
    return {
        available, metadata, mapsFor, insideFile,
        mapJob: (rel) => jobs.get(mapJobs.get(sourceKey(rel))) || null,
        catalogue: () => query(['--catalogue']),
        preview: (request) => query(['--preview', '--request-stdin'], validateRequest(request)),
        render: (plan, options) => start(['--render', '--request-stdin', '--tables', tables, '--output-dir', root], plan, 'dynamic', options),
        battlemap(body) {
            validateRequest(body);
            const source = insideFile(body.rel);
            if (!source || backgrounds.isAnimationFile(path.basename(source))) throw new Error('battlemap source must be an image inside the backgrounds folder');
            if (metadata(body.rel)?.kind === 'battlemap') throw new Error('choose the original background as the battlemap source');
            const key = sourceKey(body.rel);
            if (jobs.get(mapJobs.get(key))?.status === 'running') throw new Error('a battlemap is already being generated for this source');
            const result = start(['--battlemap', source, '--width', String(body.width ?? 1536), '--height', String(body.height ?? 1536),
                '--seed', String(body.seed ?? crypto.randomInt(2 ** 32)), '--notes', body.notes || '', '--output-dir', path.dirname(source)], undefined, 'battlemap', { artStyle: body.artStyle });
            mapJobs.set(key, result.jobId);
            return result;
        },
    };
}

module.exports = { createService, validateRequest, metadataPath };
