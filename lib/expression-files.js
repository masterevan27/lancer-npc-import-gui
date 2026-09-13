const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { classifyExpressionFiles } = require('./expressions');

function isInside(parent, candidate) {
    const rel = path.relative(parent, candidate);
    return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function isSpriteBasename(file) {
    return typeof file === 'string'
        && file === path.basename(file)
        && !file.includes('/') && !file.includes('\\')
        && Object.values(classifyExpressionFiles([file])).some((files) => files.includes(file));
}

function realDirectoryInside(parent, directory) {
    let parentReal;
    let stat;
    try {
        parentReal = fs.realpathSync(parent);
        stat = fs.statSync(directory);
    } catch {
        return null;
    }
    if (!stat.isDirectory()) return null;
    const directoryReal = fs.realpathSync(directory);
    return isInside(parentReal, directoryReal) ? directoryReal : null;
}

function expressionDirectory(itemFolder) {
    return path.join(itemFolder, 'expressions');
}

function safeExpressionDirectory(itemFolder) {
    return realDirectoryInside(itemFolder, expressionDirectory(itemFolder));
}

function resolveSprite(itemFolder, file) {
    if (!isSpriteBasename(file)) return { error: 'file must be a classified .webp sprite basename' };
    const directory = safeExpressionDirectory(itemFolder);
    if (!directory) return { error: 'no expressions directory' };
    const candidate = path.join(directory, file);
    let stat;
    let real;
    try {
        stat = fs.statSync(candidate);
        real = fs.realpathSync(candidate);
    } catch {
        return { error: 'no such expression sprite' };
    }
    if (!stat.isFile() || !isInside(directory, real)) {
        return { error: 'no such expression sprite' };
    }
    return { directory, file: candidate, real };
}

function listSprites(itemFolder) {
    const directory = safeExpressionDirectory(itemFolder);
    if (!directory) return [];
    let names;
    try {
        names = fs.readdirSync(directory);
    } catch {
        return [];
    }
    return names.filter((name) => !resolveSprite(itemFolder, name).error);
}

function readSidecar(itemFolder) {
    const directory = safeExpressionDirectory(itemFolder);
    if (!directory) return {};
    const sidecar = path.join(directory, 'expressions.json');
    try {
        const stat = fs.statSync(sidecar);
        const real = fs.realpathSync(sidecar);
        if (!stat.isFile() || !isInside(directory, real)) return {};
        const parsed = JSON.parse(fs.readFileSync(real, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function writeSidecarAtomic(itemFolder, value) {
    const directory = safeExpressionDirectory(itemFolder);
    if (!directory) throw new Error('no safe expressions directory');
    const sidecar = path.join(directory, 'expressions.json');
    const temp = path.join(directory, `.expressions-${process.pid}-${crypto.randomUUID()}.tmp`);
    try {
        fs.writeFileSync(temp, JSON.stringify(value, null, 2));
        fs.renameSync(temp, sidecar);
    } finally {
        try { fs.rmSync(temp, { force: true }); } catch { /* rename already consumed it */ }
    }
}

function resolveFileInside(parent, file) {
    let parentReal;
    let stat;
    let real;
    try {
        parentReal = fs.realpathSync(parent);
        stat = fs.statSync(file);
        real = fs.realpathSync(file);
    } catch {
        return null;
    }
    return stat.isFile() && isInside(parentReal, real) ? real : null;
}

function migrateSidecarEntry(entry, sources) {
    const migrated = { ...entry };
    if (!entry.source || typeof entry.source !== 'object' || Array.isArray(entry.source)) return migrated;
    const kind = Object.hasOwn(entry.source, 'kind') ? entry.source.kind : 'portrait';
    if (kind !== 'token' && kind !== 'portrait') return migrated;
    const relocation = sources?.[kind];
    const recordedMtime = Number(entry.source?.mtime);
    if (Number.isFinite(recordedMtime) && Number.isFinite(relocation?.sourceMtime)
        && Number.isFinite(relocation?.destinationMtime) && relocation.destinationPath) {
        migrated.source = {
            ...entry.source,
            path: relocation.destinationPath,
            mtime: relocation.destinationMtime + recordedMtime - relocation.sourceMtime,
        };
    }
    return migrated;
}

module.exports = {
    isInside,
    isSpriteBasename,
    expressionDirectory,
    safeExpressionDirectory,
    resolveSprite,
    listSprites,
    readSidecar,
    writeSidecarAtomic,
    resolveFileInside,
    migrateSidecarEntry,
};
