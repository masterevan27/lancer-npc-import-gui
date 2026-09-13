/**
 * Pure expression-sprite contract shared by the future job routes and tests.
 *
 * The Python generator owns the actual rendering and validates its argv too,
 * but keeping the filename and argv rules here lets the GUI refuse an unsafe
 * request before it reaches a child process or a filesystem path.
 */

const DEFAULT_EXPRESSION_LABELS = [
    'admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring',
    'confusion', 'curiosity', 'desire', 'disappointment', 'disapproval',
    'disgust', 'embarrassment', 'excitement', 'fear', 'gratitude', 'grief',
    'joy', 'love', 'nervousness', 'neutral', 'optimism', 'pride',
    'realization', 'relief', 'remorse', 'sadness', 'surprise',
];

const SPRITE_NAME_RE = /^([a-z0-9_]+)(?:-(\d+)|\.([A-Za-z0-9_.-]+))?\.webp$/;

function sanitizeExpressionLabel(value) {
    const label = String(value).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!label) throw new Error('expression label is empty after sanitizing');
    return label;
}

function classifyExpressionFile(name) {
    if (typeof name !== 'string' || name.includes('/') || name.includes('\\')) return null;
    const match = SPRITE_NAME_RE.exec(name);
    return match ? match[1] : null;
}

function classifyExpressionFiles(names) {
    const byLabel = new Map();
    for (const name of names || []) {
        const label = classifyExpressionFile(name);
        if (!label) continue;
        if (!byLabel.has(label)) byLabel.set(label, []);
        byLabel.get(label).push(name);
    }
    const groups = Object.fromEntries(byLabel);
    const compare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
    for (const [label, files] of Object.entries(groups)) {
        const rank = (file) => file === `${label}.webp` ? 0
            : new RegExp(`^${escapeRegExp(label)}-\\d+\\.webp$`).test(file) ? 1 : 2;
        files.sort((left, right) => rank(left) - rank(right) || compare(left, right));
    }
    return groups;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requiredString(value, name) {
    if (typeof value !== 'string' || !value) throw new Error(`${name} is required`);
    return value;
}

function customArg(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        throw new Error('custom expressions must be {label, text?} objects');
    }
    if (typeof spec.label !== 'string' || !spec.label.trim()) {
        throw new Error('custom expression label must be a non-empty string');
    }
    const label = sanitizeExpressionLabel(spec.label);
    if (spec.text === undefined || spec.text === null || spec.text === '') return label;
    if (typeof spec.text !== 'string') throw new Error('custom expression text must be a string');
    return `${label}=${spec.text.trim()}`;
}

function expressionArgs(opts = {}) {
    const script = requiredString(opts.script, 'script');
    const id = requiredString(opts.id, 'id');
    const count = opts.count === undefined ? 1 : opts.count;
    if (!Number.isInteger(count) || count < 1) throw new Error('count must be an integer of at least 1');
    const mode = opts.mode === undefined ? 'add' : opts.mode;
    if (mode !== 'add' && mode !== 'replace') throw new Error('mode must be "add" or "replace"');

    const labels = opts.labels === undefined ? [] : opts.labels;
    if (!Array.isArray(labels) || labels.some((label) => typeof label !== 'string')) {
        throw new Error('labels must be an array of strings');
    }
    const cleanLabels = [...new Set(labels.map(sanitizeExpressionLabel))];
    const custom = opts.custom === undefined ? [] : opts.custom;
    if (!Array.isArray(custom)) throw new Error('custom expressions must be an array');
    const file = opts.file;
    if (file !== undefined && classifyExpressionFile(file) === null) {
        throw new Error('file must be a safe .webp sprite basename');
    }
    if (file !== undefined && (cleanLabels.length || custom.length || count !== 1 || mode !== 'add')) {
        throw new Error('file redo is incompatible with labels, custom expressions, count, or replace mode');
    }

    const args = [script, '--id', id];
    if (opts.manifest) args.push('--manifest', requiredString(opts.manifest, 'manifest'));
    if (opts.tables) args.push('--tables', requiredString(opts.tables, 'tables'));
    if (cleanLabels.length) args.push('-e', cleanLabels.join(','));
    for (const spec of custom) args.push('--custom', customArg(spec));
    if (count !== 1) args.push('--count', String(count));
    if (mode === 'replace') args.push('--replace');
    if (file !== undefined) args.push('--file', file);
    if (opts.keepBackground) args.push('--keep-background');
    if (opts.source !== undefined) {
        if (opts.source !== 'token' && opts.source !== 'portrait') {
            throw new Error('source must be "token" or "portrait"');
        }
        args.push('--source', opts.source);
    }
    if (opts.server) args.push('--server', requiredString(opts.server, 'server'));
    return args;
}

function expressionJobAcceptsOutput(job, currentJob) {
    return !!job && job.status === 'running' && currentJob?.jobId === job.jobId;
}

module.exports = {
    DEFAULT_EXPRESSION_LABELS,
    sanitizeExpressionLabel,
    classifyExpressionFiles,
    expressionArgs,
    expressionJobAcceptsOutput,
};
