/**
 * The pure half of the Backgrounds tab.
 *
 * Same split as lib/animate.js and lib/model3d.js, for the same reason:
 * nothing here touches the filesystem or spawns anything, so the argv the
 * server builds for generate-art.py and animate-portrait.py, the catalogue
 * parse, the two filenames written beside a still and the traversal refusals
 * can all be asserted without a Python interpreter, a ComfyUI server or the
 * minutes a Wan render takes.
 *
 * A background has no manifest entry, no id and no traits - the folder is the
 * source of truth and a still is identified by its path relative to
 * backgroundsDir. What the GUI remembers about one lives in a JSON sidecar
 * beside it, exactly as lib/animate.js keeps the animated-portrait record
 * beside the .webp.
 */

const path = require('node:path');
const animate = require('./animate');

/** Every file in backgroundPromptsDir matching this is a catalogue. */
const CATALOGUE_SUFFIX = '-background-art-prompts.md';

/** The heading in backgroundTablesPath whose bullets are the motion prompts. */
const MOTION_TABLE = 'Background Animation';

/** What the gallery walk will pick up. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

const ANIMATED_SUFFIX = ' Animated';

/** Kept inside backgroundsDir so a background run never writes the mech record. */
const RENDER_MANIFEST = '.backgrounds-manifest.json';

const OUTPUT_PREFIX = 'LancerBackgrounds';

/**
 * generate-art.py prints one line per entry as
 *   "  %-58s %-20s line %-5d (%d chars)"
 * The first column is safe as \S+ because a prefix is a '/'-joined run of
 * _slug() output and _slug replaces every non-alphanumeric run with '-', so a
 * prefix can never hold a space. That is what keeps the columns unambiguous
 * when the role column is empty.
 */
const LIST_LINE = /^\s*(\S+)\s+(.*?)\s*line\s+(\d+)\s+\((\d+) chars\)\s*$/;

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCatalogue(fileName) {
    return String(fileName || '').endsWith(CATALOGUE_SUFFIX);
}

/**
 * A catalogue's display label: the filename minus the suffix, dashes back to
 * spaces, first letter up. 'Scene' and 'City' without a lookup table that a
 * third file would have to be added to.
 */
function catalogueLabel(fileName) {
    const name = String(fileName || '');
    const stem = name.endsWith(CATALOGUE_SUFFIX)
        ? name.slice(0, -CATALOGUE_SUFFIX.length) : name;
    const words = stem.replace(/-+/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/**
 * A still's display name: the filename stem with ComfyUI's _00001_ counter
 * dropped and _slug's dashes turned back into spaces, so
 * Canyon-Skirmish_00001_.png reads as "Canyon Skirmish". Cosmetic and safe to
 * get wrong - a stem that does not match that shape is shown as it is.
 */
function displayName(fileName) {
    const base = String(fileName || '').replace(/\.[^.]+$/, '');
    const stem = base.replace(/_\d+_$/, '');
    const words = stem.replace(/-+/g, ' ').trim();
    return words || base;
}

/**
 * The entries `--filter` can select, read off the script's own --list rather
 * than reparsed from the markdown here. A JS reimplementation would be a
 * second copy of parse_prompts' judgment (SKIP_HEADINGS, MIN_PROMPT_CHARS,
 * fenced-or-quoted blocks, Alt2 labels) free to drift from it. --list returns
 * before find_server, so it costs one Python start and no ComfyUI.
 *
 * Non-matching lines are ignored, so the banner line generate-art.py prints
 * first cannot become a phantom entry.
 */
function parseListOutput(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
        const m = LIST_LINE.exec(line);
        if (!m) continue;
        out.push({ prefix: m[1], role: m[2], line: Number(m[3]), chars: Number(m[4]) });
    }
    return out;
}

/**
 * The first 200 characters of the prompt block starting at `line` (1-based),
 * blockquote markers stripped, stopping at the first blank line or fence.
 */
function excerptAt(lines, line) {
    const body = [];
    for (let i = line - 1; i >= 0 && i < lines.length; i += 1) {
        const raw = lines[i];
        if (!raw.trim() || raw.startsWith('```')) break;
        body.push(raw.replace(/^>\s?/, '').trim());
    }
    return body.join(' ').slice(0, 200);
}

/**
 * --list gives a slug and a line number, not a title. Walk the markdown once
 * and attach the nearest heading at or above each entry's line plus an
 * excerpt of its prompt, so the picker shows "Pilot's Quarters - Planetrise
 * Through the Porthole" rather than the slug. Display only: nothing
 * downstream depends on it, so a heading this misses degrades to a blank name
 * and the client falls back to the prefix.
 */
function attachHeadings(entries, fileText) {
    const lines = String(fileText || '').split(/\r?\n/);
    return (entries || []).map((entry) => {
        let name = '';
        for (let i = Math.min(entry.line - 1, lines.length - 1); i >= 0; i -= 1) {
            const m = /^#{1,6}\s+(.*?)\s*$/.exec(lines[i]);
            if (m) { name = m[1]; break; }
        }
        return { ...entry, name, excerpt: excerptAt(lines, entry.line) };
    });
}

/**
 * The argv for one generate-art.py run.
 *
 * Three things are load-bearing. The filter is anchored and escaped, because
 * --filter is compiled case-insensitively and matched with re.search against
 * entry.key OR entry.name: unanchored, one entry whose slug is a prefix of
 * another's would render both, and unescaped a heading's own punctuation
 * would be regex syntax. --manifest points inside backgroundsDir, because the
 * script's default is the mech catalogue's record at the generator root. And
 * the size defaults to 1920x1080, which is what every '### Settings' block in
 * these catalogues asks for.
 */
function renderArgs(scriptPath, {
    catalogue, prefix, backgroundsDir, variants = 1, width = 1920, height = 1080, seed = null,
} = {}) {
    if (typeof scriptPath !== 'string' || !scriptPath) throw new Error('renderArgs needs the script path');
    if (typeof catalogue !== 'string' || !catalogue) throw new Error('renderArgs needs the catalogue path');
    if (typeof prefix !== 'string' || !prefix) throw new Error('renderArgs needs the entry prefix');
    if (typeof backgroundsDir !== 'string' || !backgroundsDir) {
        throw new Error('renderArgs needs the backgrounds directory');
    }
    if (!Number.isInteger(variants) || variants < 1 || variants > 8) {
        throw new Error('renderArgs needs variants between 1 and 8');
    }
    if (!Number.isInteger(width) || width < 1) throw new Error('renderArgs needs a positive integer width');
    if (!Number.isInteger(height) || height < 1) throw new Error('renderArgs needs a positive integer height');
    if (seed !== null && (!Number.isInteger(seed) || seed < 0)) {
        throw new Error('renderArgs needs a non-negative integer seed, or null to roll one');
    }
    return [
        scriptPath,
        '--prompts', catalogue,
        '--filter', `^${escapeRegExp(prefix)}$`,
        '--variants', String(variants),
        '--width', String(width),
        '--height', String(height),
        '--output-prefix', OUTPUT_PREFIX,
        '--download-to', backgroundsDir,
        '--manifest', path.join(backgroundsDir, RENDER_MANIFEST),
        ...(seed === null ? [] : ['--seed', String(seed)]),
    ];
}

/**
 * The argv for one animate-portrait.py --background run. Every field
 * required, the way animate.animateArgs validates its own: the script would
 * happily default --out beside the source and roll its own seed, but a run
 * the server cannot name the output of, or cannot record the seed of, is a
 * run the panel cannot show.
 *
 * -d rather than --roll, for the reason lib/animate.js gives: the draw
 * happens on this side, where it can be shown, re-rolled and pinned before a
 * multi-minute render is paid for, and the sidecar records what was sent.
 *
 * Nothing --background sets is overridden here, so the size, frame count and
 * negative prompt stay whatever the generator repo decides they should be.
 */
function animateArgs(scriptPath, { still, out, description, seed, pingpong = true } = {}) {
    if (typeof scriptPath !== 'string' || !scriptPath) throw new Error('animateArgs needs the script path');
    if (typeof still !== 'string' || !still) throw new Error('animateArgs needs the still path');
    if (typeof out !== 'string' || !out) throw new Error('animateArgs needs the output path');
    if (typeof description !== 'string' || !description) throw new Error('animateArgs needs a description');
    if (!Number.isInteger(seed) || seed < 0) throw new Error('animateArgs needs a non-negative integer seed');
    return [
        scriptPath, still, '--background', '--out', out, '-d', description, '--seed', String(seed),
        ...(pingpong ? [] : ['--no-pingpong']),
    ];
}

/**
 * The loop and its record, beside the still and named from its stem, so a
 * folder listing reads as one set. Mirrors animate.animationFiles. Takes and
 * returns a '/'-separated rel path, which is what crosses the API.
 */
function animationFilesFor(rel) {
    const s = String(rel || '');
    const dot = s.lastIndexOf('.');
    const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    const stem = dot > slash ? s.slice(0, dot) : s;
    return { webp: `${stem}${ANIMATED_SUFFIX}.webp`, sidecar: `${stem}${ANIMATED_SUFFIX}.json` };
}

/** Whether a filename is this module's own animation output, not a still. */
function isAnimationFile(fileName) {
    return /\sAnimated\.webp$/i.test(String(fileName || ''));
}

/**
 * Resolves a client-supplied rel inside root, or null. Every filename that
 * reaches a route passes through here before anything opens it. Pure, so the
 * traversal refusals are unit-tested without a server.
 *
 * The trailing-separator check is the point: a bare startsWith(root) would
 * accept a sibling directory whose name merely starts with the root's.
 */
function resolveInside(root, rel) {
    if (typeof rel !== 'string' || !rel) return null;
    if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return null;
    const base = path.resolve(root);
    const target = path.resolve(base, ...rel.split('/'));
    if (target === base) return target;
    return target.startsWith(base + path.sep) ? target : null;
}

/**
 * The enabled bullets of the Background Animation table, from
 * tableBullets.readTables' output. Disabled bullets are left out - the Tables
 * tab switched them off, and offering one here would be the one place the
 * switch did not reach.
 *
 * readTables returns tables per heading, so reading this one good table out of
 * a file whose Backdrop and Spaceships tables are hard-wrapped (and therefore
 * silently truncated by the bullet regex) is safe. Only this table is offered.
 */
function motionPromptsFrom(tables) {
    const table = (tables || []).find((t) => t.name === MOTION_TABLE);
    if (!table) return [];
    return table.bullets.filter((b) => b.enabled).map((b) => b.text);
}

module.exports = {
    CATALOGUE_SUFFIX, MOTION_TABLE, IMAGE_EXTENSIONS, RENDER_MANIFEST, OUTPUT_PREFIX,
    escapeRegExp, isCatalogue, catalogueLabel, displayName,
    parseListOutput, attachHeadings, renderArgs, animateArgs,
    animationFilesFor, isAnimationFile, resolveInside, motionPromptsFrom,
    // Re-exported from lib/animate.js unchanged rather than reimplemented: the
    // sidecar shape is the same and so is the staleness question, and
    // pickDescription is already parameterised on its pool, so this is an
    // alias and not a copy. The background sidecar therefore records the
    // still's mtime under `portraitVersion` - deliberately, so isStale needs
    // no second version of itself.
    parseSidecar: animate.parseSidecar,
    isStale: animate.isStale,
    pickMotionPrompt: animate.pickDescription,
};
