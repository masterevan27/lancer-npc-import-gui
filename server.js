/*
 * FoundryVTT to SillyTavern NHP Uplink
 * Copyright (C) 2026 masterevan27
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Import GUI server
 *
 * A small standalone Node server (stdlib only, same spirit as
 * ../st-server-plugin) that lets a GM browse dynamically generated content
 * (currently: NPCs rolled by generate-npc.py) and choose which of it gets
 * created as Actors in Foundry.
 *
 * Two faces, same as the SillyTavern relay:
 *
 *   1. GM-facing routes under /api/*, same-origin with the page this server
 *      also serves (public/) - no CORS needed.
 *   2. A Foundry-facing poll queue under /importer/*, which the module's
 *      scripts/importer.js polls the same way uplink.js polls the ST relay's
 *      /outbound. Foundry only ever calls out; this server never reaches
 *      into a running world.
 *
 * Generated content reaches this server by reading generate-npc.py's own
 * `.generated-npcs.json` run log directly off disk - no transport needed for
 * that half. Importing an item that isn't already under `foundryDataRoot`
 * (the normal case - generate-npc.py's own default output root is a ComfyUI
 * review folder, not the Foundry Data tree) copies its files in first and
 * repoints the manifest entry at the copy, so Foundry only ever needs a path
 * relative to Data/ and a later Regenerate keeps writing to the same,
 * already-imported location. See copyIntoFoundry() below.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const tableBullets = require('./lib/tableBullets');
const tableGroups = require('./lib/tableGroups');
const tableFlags = require('./lib/tableFlags');
const presets = require('./lib/presets');
const createPresets = require('./lib/createPresets');
const { derivePaths } = require('./lib/paths');
const { buildKinds, kindFor, kindOf, requestKind, available, DEFAULT_KIND } = require('./lib/kinds');
const pronouns = require('./lib/pronouns');
const traitOptions = require('./lib/traitOptions');
const traitOdds = require('./lib/traitOdds');
const traitChoices = require('./lib/traitChoices');
const applyTrait = require('./lib/applyTrait');
const animate = require('./lib/animate');
const backgrounds = require('./lib/backgrounds');

const PLUGIN_ID = 'import-gui-server';

const DEFAULT_CONFIG = {
    port: 5089,
    host: '127.0.0.1',
    secret: '',
    npcManifestPath: '',
    // Preferred alias for npcManifestPath - resolves as
    // config.manifestPath || config.npcManifestPath, right after
    // loadConfig() below, before the startup guard checks it. Existing
    // configs that only set npcManifestPath keep working untouched.
    manifestPath: '',
    foundryDataRoot: '',
    // Regenerating an NPC's art shells out to generate-npc.py, which lives
    // beside npcManifestPath by default (that's where the script's own
    // DEFAULT_MANIFEST points) - only override generateNpcScript if it's
    // been moved elsewhere.
    pythonExecutable: 'python',
    generateNpcScript: '',
    // The 3D panel shells out to generate-3d.py, which sits beside
    // generate-npc.py in the same repo - only override this if it has been
    // moved on its own.
    generate3dScript: '',
    // generate-spaceship.py sits beside generate-npc.py by default (see
    // lib/paths.js); override only if the ship generator has been moved on
    // its own.
    generateSpaceshipScript: '',
    // Where an imported item's files get copied to under foundryDataRoot -
    // see copyIntoFoundry(). Mirrors generate-npc.py's own COMFY_PREFIX so
    // the two output trees read as the same convention.
    foundryNpcSubdir: 'LancerNPCs',
    foundrySpaceshipSubdir: 'LancerSpaceships',
    // Sent to the Foundry module as the actor type to create - only when
    // non-empty; an empty string omits the field entirely rather than
    // guessing wrong (queueImport()). foundryNpcActorType defaults empty:
    // the module already creates a plain 'npc'-type Actor for every NPC
    // import today with no actorType on the wire at all, so an empty
    // default here is what preserves that behaviour byte-for-byte - set it
    // explicitly only if a deployment wants to send one anyway.
    // foundrySpaceshipActorType defaults to 'deployable', which is
    // unverified against the Lancer system (the module isn't vendored in
    // this repo, R14/G6) - a wrong guess there costs one config line, not a
    // code change, same reasoning applied to both kinds.
    foundryNpcActorType: '',
    foundrySpaceshipActorType: 'deployable',
    // npc-generator-tables.md and the npc-trait-import skill's staging
    // directory both default to prompts/ beneath generate-npc.py; override
    // either for a nonstandard layout.
    npcTablesPath: '',
    stagedImportsDir: '',
    // The reference images npc-trait-import copies beside each staged run, so
    // the Trait Imports detail sheet can show a candidate's source rather than
    // only naming it. Defaults to refs/ inside stagedImportsDir; worth
    // overriding only to put them on a different disk, since they are the one
    // thing here measured in tens of megabytes per run.
    stagedRefsDir: '',
    presetsDir: '',
    // Create NPC form presets. Defaults to create/ inside presetsDir, so the
    // two flavours stay one folder to back up; override it only to split them
    // deliberately, and note that overriding presetsDir alone already moves
    // this one with it.
    createPresetsDir: '',
    // The ship-tables, staging and presets equivalents of the six NPC keys
    // above - see lib/paths.js for how each is derived when left empty.
    spaceshipTablesPath: '',
    spaceshipStagedImportsDir: '',
    spaceshipStagedRefsDir: '',
    spaceshipPresetsDir: '',
    spaceshipCreatePresetsDir: '',
    // Passed to generate-spaceship.py as --out-root when non-empty. Not a
    // per-kind --out: --out names a single run folder, so a configured --out
    // would pin every ship run to the same directory. --out-root is a tree
    // the generator numbers run folders under, same as its own default.
    spaceshipOutputRoot: '',
    // SillyTavern's own backgrounds folder - data/<user>/backgrounds under
    // its install - which is where "Import into SillyTavern" copies a still
    // and its loop. Not derived from anything: SillyTavern's location has no
    // relation to the generator's, and lib/paths.js only derives paths that
    // follow one another. Empty means the button stays off.
    sillyTavernBackgroundsDir: '',
    // Rolls behind each percentage on the Tables page. The trade is precision
    // against how long the number takes to settle after an edit: 20,000 rolls
    // is about six seconds and holds still at whole-percent precision, while
    // 8,000 settles in half the time and wobbles a point either way. A
    // property of the machine rather than of any one request, so it lives
    // here rather than in a query parameter.
    traitOddsSamples: 20000,
    // Where the imported-Actor cache (see INDEX_FILE below) is persisted.
    // Empty means today's default: a fixed file beside server.js. This
    // exists so a test server can point it at its own per-test tmp
    // directory instead of the one real, gitignored file every server.js
    // process on the machine otherwise shares - a concurrently running dev
    // server and a test run (or two test files run at once) would
    // otherwise silently stomp each other's cache, since saveIndex()
    // writes a full snapshot rather than merging. Production behaviour is
    // unchanged: an unset value resolves to the exact same path as before.
    importedIndexPath: '',
};

function loadConfig() {
    // Overridable so tests can point a real server.js process at a synthetic
    // fixture config without ever touching the real config.json.
    const file = process.env.IMPORT_GUI_CONFIG || path.join(__dirname, 'config.json');
    let fromFile = {};
    try {
        if (fs.existsSync(file)) fromFile = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        console.warn(`[${PLUGIN_ID}] could not read config.json:`, err.message);
    }
    return {
        ...DEFAULT_CONFIG,
        ...fromFile,
        port: Number(process.env.IMPORT_GUI_PORT || fromFile.port || DEFAULT_CONFIG.port),
        host: process.env.IMPORT_GUI_HOST || fromFile.host || DEFAULT_CONFIG.host,
        secret: process.env.IMPORT_GUI_SECRET ?? fromFile.secret ?? DEFAULT_CONFIG.secret,
    };
}

const config = loadConfig();

// manifestPath is the preferred alias for npcManifestPath (both kinds now
// share one manifest file, so the older name is misleading); resolve it
// before the startup guard below so an existing config.json that only sets
// npcManifestPath keeps working untouched, and everything downstream
// (derivePaths, the guard, the manifest reads) sees one resolved value.
config.npcManifestPath = config.manifestPath || config.npcManifestPath;

if (!config.npcManifestPath || !config.foundryDataRoot) {
    console.error(
        `[${PLUGIN_ID}] npcManifestPath and foundryDataRoot must be set in config.json ` +
        `(copy config.example.json and fill in your paths). Refusing to start.`,
    );
    process.exit(1);
}

// Path layout lives in lib/paths.js so it can be tested directly; see the
// comment there for how each value is derived and overridden.
const DERIVED_PATHS = derivePaths(config);
// GENERATE_3D_SCRIPT is the last path here that belongs to no kind: the 3D
// pipeline is NPC-only by construction (generate-3d.py imports generate-npc.py
// for its own DEFAULT_MANIFEST, and lib/model3d.js matches exact NPC
// deliverable names), which the registry records as supports.model3d.
// Everything else - the tables files, the two presets roots, the two staging
// directories - is now read off the kind the request resolved to, including
// the trait-candidate routes that were the last holdouts.
const { generate3dScript: GENERATE_3D_SCRIPT } = DERIVED_PATHS;
// animate-portrait.py takes an image, not a kind, so it too belongs to no
// kind here; which kinds may reach it is supports.animate in the registry.
const { animatePortraitScript: ANIMATE_PORTRAIT_SCRIPT } = DERIVED_PATHS;

// The Backgrounds tab's four paths. A background is not a kind - no manifest
// entry, no traits, no Foundry import - so it has no registry row to read
// these off, and they are destructured here the way the two kindless scripts
// above are. See lib/backgrounds.js for why the folder is the source of truth.
const {
    generateArtScript: GENERATE_ART_SCRIPT,
    backgroundsDir: BACKGROUNDS_DIR,
    backgroundPromptsDir: BACKGROUND_PROMPTS_DIR,
    backgroundTablesPath: BACKGROUND_TABLES_PATH,
} = DERIVED_PATHS;

// Straight from config, not DERIVED_PATHS - see the key's comment above.
const SILLYTAVERN_BACKGROUNDS_DIR = typeof config.sillyTavernBackgroundsDir === 'string'
    ? config.sillyTavernBackgroundsDir : '';

// The kind registry - see lib/kinds.js for what varies between an NPC and a
// spaceship and why it is resolved here rather than as scattered constants.
const KINDS = buildKinds(DERIVED_PATHS, config);

/**
 * Resolves a request's kind against the registry, or null if the caller named
 * one the registry doesn't recognise.
 *
 * requestKind() itself does not normalise an unknown kind - '?kind=mech'
 * comes back as the literal string 'mech' - which is right for its own
 * tests but wrong to index KINDS with directly: KINDS.mech is undefined, and
 * every route below reads a property off what this returns. So every route
 * that turns a request into a kind goes through here instead of calling
 * requestKind() and indexing KINDS itself.
 *
 * An unknown kind is refused with a 400 rather than folded onto npc, which is
 * requestKind()'s own default when nothing was named at all. Falling back
 * silently would mean a typo'd '?kind=spacehip' quietly serves NPC data - the
 * Tables tab would edit the wrong file, a Create post would spawn the wrong
 * generator - with nothing on the response to say a request for a specific
 * kind was not honoured. Every route in this file that accepts a kind at all
 * is new with this task, so there is no existing behaviour a 400 here could
 * regress: with no kind named, requestKind() already answers DEFAULT_KIND and
 * this resolves it exactly as before.
 */
function resolveKind(url, body) {
    return kindFor(KINDS, requestKind(url, body));
}

/* ------------------------------------------------------------------ */
/* Manifest access                                                     */
/* ------------------------------------------------------------------ */

/**
 * Read generate-npc.py's run log fresh every time it's needed. It's a small
 * JSON file rewritten after every NPC, so re-reading it beats trying to keep
 * this process in sync with a script that runs independently of it.
 */
function loadManifest() {
    let raw;
    try {
        raw = fs.readFileSync(config.npcManifestPath, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.warn(`[${PLUGIN_ID}] ${config.npcManifestPath} is not valid JSON:`, err.message);
        return [];
    }
    return manifestItemsFrom(parsed);
}

/**
 * The item list a parsed manifest describes, with the folder path each entry is
 * keyed by folded into it. Split out of loadManifest() for seedSeen(), which
 * has to know whether the file was there at all and so does its own read - and
 * having parsed the bytes once must not go back to disk for a second opinion.
 * The seed writes a library-wide "already seen" from what it reads, so a second
 * read that disagreed with the first would decide the fate of every NPC written
 * in between the two.
 */
function manifestItemsFrom(parsed) {
    const items = [];
    for (const [folderPath, entry] of Object.entries(parsed || {})) {
        if (!entry || typeof entry !== 'object' || !entry.id) continue;
        items.push({ ...entry, folderPath });
    }
    return items;
}

function findItem(id) {
    return loadManifest().find((item) => item.id === id) || null;
}

/** Path relative to foundryDataRoot, forward-slashed the way Foundry wants it. */
function dataRelative(absolutePath) {
    const rel = path.relative(config.foundryDataRoot, absolutePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return rel.split(path.sep).join('/');
}

function isUnderFoundryRoot(item) {
    return dataRelative(item.folderPath) !== null;
}

/**
 * Whether an item can be imported at all - just that its source files still
 * exist on disk, wherever the manifest currently records them. Importing no
 * longer requires that location to already be under foundryDataRoot;
 * queueImport()'s caller copies it in first via copyIntoFoundry() when it
 * isn't (see /api/import).
 */
function isImportable(item) {
    return fs.existsSync(item.folderPath);
}

/**
 * Deep-sorts object keys, matching generate-art.py's
 * save_manifest(..., sort_keys=True) so a manifest this server rewrites
 * diffs the same way a Python-written one would.
 */
function sortKeysDeep(value) {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
        return out;
    }
    return value;
}

/**
 * <foundryDataRoot>/<kind's foundrySubdir>/<category>/<name>/ - the same
 * <category>/<name> nesting npc_folder() (and its spaceship equivalent) in
 * the generator uses, just rooted under Foundry's Data folder instead of
 * wherever the item currently lives (normally a ComfyUI review folder). The
 * subdir comes from the kind registry rather than a fixed constant so a ship
 * files under LancerSpaceships instead of LancerNPCs.
 */
function foundryDestFolder(item) {
    const category = path.basename(path.dirname(item.folderPath));
    const name = path.basename(item.folderPath);
    return path.join(config.foundryDataRoot, kindOf(KINDS, item).foundrySubdir, category, name);
}

/**
 * Copies an item's files into foundryDataRoot and repoints its manifest
 * entry at the copy, in place. The manifest's own key *is* the folder path
 * (see loadManifest), so "moving" an entry means deleting the old key and
 * re-inserting the same entry under the new one - after which a later
 * Regenerate (which reads this same manifest fresh every time) writes new
 * art straight to the copy, and a by-hand `generate-npc.py --regen-manifest`
 * run would too.
 */
function copyIntoFoundry(item) {
    const dest = foundryDestFolder(item);
    fs.mkdirSync(dest, { recursive: true });
    // The animation pair too, when there is one. It is not in the manifest's
    // file list - generate-npc.py never wrote it - and a portrait that moved
    // without its loop would open an empty panel on the imported copy.
    const animation = Object.values(animate.animationFiles(animate.animationBase(item)));
    for (const file of [...(item.files || []), ...animation]) {
        const src = path.join(item.folderPath, file);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, file));
    }

    const raw = fs.readFileSync(config.npcManifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    const entry = parsed[item.folderPath];
    if (!entry) throw new Error(`manifest entry for ${item.folderPath} vanished mid-import`);
    delete parsed[item.folderPath];
    parsed[dest] = entry;
    fs.writeFileSync(config.npcManifestPath, JSON.stringify(sortKeysDeep(parsed), null, 2));

    return dest;
}

function itemFile(item, which) {
    const name = which === 'portrait' ? item.portrait : item.token;
    return name ? path.join(item.folderPath, name) : null;
}

/**
 * File mtime in ms, or null - used only as a cache-busting version stamp on
 * image URLs (see itemView) so a Regenerate that overwrites a portrait/token
 * in place is reflected immediately in the GUI (grid thumbnails included, not
 * just the detail overlay) instead of however long the browser feels like
 * keeping the old bytes around under the old URL.
 */
function fileVersion(file) {
    try {
        return Math.round(fs.statSync(file).mtimeMs);
    } catch {
        return null;
    }
}

/**
 * Permanently deletes a generated item: its whole folder on disk (portrait,
 * token, and any other files generate-npc.py wrote alongside them) plus its
 * manifest entry. Does *not* touch a Foundry Actor already created from it -
 * if the item was imported, its folder is the copy under foundryDataRoot
 * (see copyIntoFoundry), so this only removes the source art and the GUI's
 * record of it, not the Actor itself.
 */
function deleteItem(item) {
    try {
        fs.rmSync(item.folderPath, { recursive: true, force: true });
    } catch (err) {
        throw new Error(`couldn't delete files: ${err.message}`);
    }

    const raw = fs.readFileSync(config.npcManifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    delete parsed[item.folderPath];
    fs.writeFileSync(config.npcManifestPath, JSON.stringify(sortKeysDeep(parsed), null, 2));

    jobsByItemId.delete(item.id);
    regenJobsByItemId.delete(item.id);
    animateJobsByItemId.delete(item.id);
    if (importedIndex.delete(item.id)) saveIndex();
    // Forget that this NPC was ever looked at, too. Its id is
    // `npc-<slug>-<seed>` and so deterministic from its name and seed, which
    // means deleting one and rolling it again with the same two produces the
    // *same* id - and without this the re-created NPC would arrive already
    // marked seen and wear no New tag at all. This is the only place the seen
    // store is pruned; see ensureSeenLoaded for why it is deliberately not
    // reconciled against the manifest wholesale the way importedIndex is.
    ensureSeenLoaded();
    if (seenIndex.delete(item.id)) saveSeen();
}

/* ------------------------------------------------------------------ */
/* Import job queue + dedup index                                      */
/* ------------------------------------------------------------------ */

/** Jobs the GUI has queued, keyed by item id. One active job per item. */
const jobsByItemId = new Map();

/**
 * itemId -> { actorId, actorUuid, importedAt }. This is a cache for fast
 * lookups without Foundry running, not the source of truth - reconcile()
 * below rebuilds it from the actor flags Foundry actually reports, so a GM
 * deleting an Actor in Foundry is reflected here on the next poll rather
 * than leaving a stale "already imported" mark behind.
 *
 * Location is config-driven (config.importedIndexPath) so a test server can
 * isolate it in its own tmp directory; empty resolves to exactly today's
 * path, so production behaviour is unchanged.
 */
const INDEX_FILE = config.importedIndexPath || path.join(__dirname, '.imported.json');
let importedIndex = new Map();
try {
    const raw = fs.readFileSync(INDEX_FILE, 'utf8');
    for (const [id, rec] of Object.entries(JSON.parse(raw))) importedIndex.set(id, rec);
} catch { /* no cache yet, or unreadable - reconcile will rebuild it */ }

function saveIndex() {
    const obj = Object.fromEntries(importedIndex);
    fs.writeFileSync(INDEX_FILE, JSON.stringify(obj, null, 2));
}

/** How long a job can sit "sent" before a poll re-offers it (a stuck/reloaded client). */
const SENT_STALE_MS = 2 * 60 * 1000;

function queueImport(item, { force = false } = {}) {
    const existing = jobsByItemId.get(item.id);
    if (existing && (existing.status === 'queued' || existing.status === 'sent')) {
        return { queued: true, jobId: existing.jobId };
    }
    if (importedIndex.has(item.id) && !force) {
        return { queued: false, reason: 'already imported' };
    }
    const kind = kindOf(KINDS, item);
    // Grid units on the wire. `item` here is a spread manifest entry (see
    // manifestItemsFrom), so it carries BOTH pairs side by side:
    // gridWidth/gridHeight are the hex count Foundry sets
    // prototypeToken.width/height from, and tokenWidth/tokenHeight are the
    // rendered canvas in PIXELS. Reading the wrong one sends 1728 where 3 was
    // meant - see G1 in docs/foundry-importer-contract.md. Do not reach for
    // item.tokenHexes; that is itemView's projection and is not present on
    // this raw entry.
    const gw = item.gridWidth;
    const gh = item.gridHeight ?? item.gridWidth;
    const job = {
        jobId: crypto.randomUUID(),
        itemId: item.id,
        kind: item.kind,
        name: item.name,
        callsign: item.callsign,
        role: item.traits?.Role || null,
        faction: item.traits?.Faction || null,
        portraitPath: dataRelative(itemFile(item, 'portrait')),
        tokenPath: dataRelative(itemFile(item, 'token')),
        // Conditional spreads, not null defaults: an NPC job's key set stays
        // byte-identical to before this task, which is what keeps
        // test/importerContract.test.js's existing assertions passing
        // unchanged.
        ...(kind.foundryActorType ? { actorType: kind.foundryActorType } : {}),
        ...(Number.isInteger(gw) && gw > 0 ? { tokenWidth: gw, tokenHeight: gh } : {}),
        status: 'queued',
        queuedAt: Date.now(),
    };
    jobsByItemId.set(item.id, job);
    return { queued: true, jobId: job.jobId };
}

function pendingJobsForFoundry() {
    const now = Date.now();
    const offered = [];
    for (const job of jobsByItemId.values()) {
        if (job.status === 'sent' && now - job.sentAt > SENT_STALE_MS) job.status = 'queued';
        if (job.status !== 'queued') continue;
        job.status = 'sent';
        job.sentAt = now;
        offered.push(job);
    }
    return offered;
}

function completeJob({ jobId, itemId, ok, actorId, actorUuid, error }) {
    const job = jobsByItemId.get(itemId);
    if (!job || job.jobId !== jobId) return false;
    job.doneAt = Date.now();
    if (ok) {
        job.status = 'done';
        importedIndex.set(itemId, { actorId, actorUuid, importedAt: job.doneAt });
        saveIndex();
        // Importing is a stronger "I have dealt with this" than merely looking,
        // so it clears the New tag as well. Without it, an NPC swept up by
        // Select All and never opened would keep a flag it had no way left to
        // shed: the grid suppresses the tag on an imported card, so nothing on
        // screen could ever clear it again.
        markSeen([itemId]);
        jobsByItemId.delete(itemId);
    } else {
        job.status = 'error';
        job.error = error || 'unknown error';
    }
    return true;
}

/**
 * entries: [{ itemId, actorId, actorUuid }] currently flagged in the world.
 * kinds:   which item kinds this reporter actually looked for.
 *
 * A module that does not say `kinds` claims 'npc' alone - the only kind that
 * existed when it shipped - so a spaceship it has never heard of survives its
 * report instead of being deleted. This is additive to a request body rather
 * than an alteration of a response, so it respects the contract doc's "add a
 * route rather than altering one" rule without needing a new route.
 */
function reconcile(entries, kinds) {
    const claimed = Array.isArray(kinds) && kinds.length
        ? new Set(kinds) : new Set(['npc']);
    const kindById = new Map(loadManifest().map((i) => [i.id, i.kind || 'npc']));
    const seen = new Set();
    for (const { itemId, actorId, actorUuid } of entries) {
        if (!itemId) continue;
        seen.add(itemId);
        const prior = importedIndex.get(itemId);
        importedIndex.set(itemId, {
            actorId,
            actorUuid,
            importedAt: prior?.importedAt ?? Date.now(),
        });
    }
    for (const itemId of [...importedIndex.keys()]) {
        if (seen.has(itemId)) continue;
        const k = kindById.get(itemId); // undefined = the item is gone entirely
        if (k === undefined || claimed.has(k)) importedIndex.delete(itemId);
    }
    saveIndex();
}

/* ------------------------------------------------------------------ */
/* Seen index (what the New tag reads)                                 */
/* ------------------------------------------------------------------ */

/**
 * Which items the user has already laid eyes on, so an NPC generated ten
 * minutes ago can look different in the grid from one generated six months
 * ago. Nothing else in this stack could answer that. `when` looks like the
 * obvious candidate and is a trap: generate-npc.py rewrites it on every
 * --regen-manifest pass, so a timestamp watermark would flag every
 * *regenerated* NPC as new - precisely the state the "Regenerating…" badge
 * already owns - and it is a zone-less local-time string besides.
 *
 * So newness is defined negatively: an id is new iff it is *absent* from this
 * set. That framing is what makes the feature survive how NPCs are really
 * made - generate-npc.py run straight from a shell, with no browser open and
 * no create job for a client to poll - and it is why this is server state
 * rather than localStorage. "New since you last looked" is a fact about the
 * library, not about a browser profile, and this repo already keeps exactly
 * this kind of small durable side-file (see .imported.json above).
 *
 * The file sits beside the *manifest* rather than beside server.js, which is
 * the one place it departs from .imported.json's pattern. Two reasons:
 * seen-ness belongs to one library, so two servers pointed at two different
 * manifests have no business sharing it; and `node --test` runs test files as
 * concurrent processes, each with its own fixture manifest, which a single
 * repo-root store would have them fighting over.
 */
const SEEN_FILE = path.join(path.dirname(config.npcManifestPath), '.npc-seen.json');

/**
 * Bumped whenever the shape saveSeen() writes stops being one this file can
 * read. ensureSeenLoaded() reseeds on any value but this one rather than
 * migrating, which is only safe because the seed's answer - "everything in the
 * library right now is already seen" - is the conservative one: the worst it
 * costs is a tag the user never gets, never a library that lights up whole. A
 * *newer* version reseeds on the same terms, since a store written by a future
 * shape is no more legible for having come from one.
 */
const SEEN_VERSION = 1;

/** id -> { at }, meaningful only once ensureSeenLoaded() has run. */
let seenIndex = new Map();
let seenLoaded = false;
let seenSeededAt = null;

/**
 * Load the store, creating it the first time. The *absence* of the file is
 * load-bearing: it means this library has never been looked at through the
 * GUI, and the only sane reading of that is "everything already here is old" -
 * a first run against a catalogue of two hundred NPCs must not light all two
 * hundred up. Hence the seed. It happens once, ever, and explicitly not on
 * every start: an NPC rolled at the CLI while this server was down is
 * genuinely new and has to still be new after the next boot.
 *
 * A store that exists but will not parse is treated as an absent one and
 * re-seeded rather than ignored. There is nothing to recover from it, and the
 * alternative failure - falling through with an empty index - is the loud one
 * this whole function is arranged to avoid. A store written under a different
 * SEEN_VERSION goes the same way and for the same reason; see the constant.
 */
function ensureSeenLoaded() {
    if (seenLoaded) return;
    let raw;
    try {
        raw = fs.readFileSync(SEEN_FILE, 'utf8');
    } catch {
        seedSeen();
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.warn(`[${PLUGIN_ID}] ${SEEN_FILE} is not valid JSON, reseeding:`, err.message);
        seedSeen();
        return;
    }
    if (parsed?.version !== SEEN_VERSION) {
        console.warn(
            `[${PLUGIN_ID}] ${SEEN_FILE} is version ${parsed?.version}, not ${SEEN_VERSION}, reseeding`);
        seedSeen();
        return;
    }
    seenSeededAt = typeof parsed?.seededAt === 'number' ? parsed.seededAt : null;
    for (const [id, rec] of Object.entries(parsed?.seen || {})) {
        seenIndex.set(id, { at: typeof rec?.at === 'number' ? rec.at : Date.now() });
    }
    seenLoaded = true;
}

/**
 * Mark the whole current library seen and write the store.
 *
 * What this function refuses to do matters more than what it does.
 * loadManifest() answers `[]` for a manifest that is missing *and* for one
 * that is momentarily unreadable, and seeding a library-wide "already seen"
 * from that empty answer, in the unreadable case, would write an empty store -
 * after which the entire library lights up New on the next two-second poll,
 * silently and with no way back. So a read or parse error seeds nothing and
 * leaves seenLoaded false, and the next read tries again.
 *
 * A *missing* manifest is the opposite case and must not take the same route,
 * which is why ENOENT is picked out of that error rather than lumped in with
 * it. On a fresh install the manifest is gitignored and simply absent, so
 * deferring the seed there would leave it to run on the first /api/items poll
 * instead - by which time the user has generated their first NPCs, and the
 * manifest the seed reads is the one those NPCs just created, marking every
 * one of them already seen. That would make the first NPCs anyone ever
 * generates the only ones the New tag can never fire for. So ENOENT seeds an
 * empty set and persists it, which is the honest reading: a library with no
 * manifest holds nothing to have seen, and everything written afterwards is
 * genuinely new. A manifest that is present but empty means the same thing.
 */
function seedSeen() {
    let raw;
    try {
        raw = fs.readFileSync(config.npcManifestPath, 'utf8');
    } catch (err) {
        if (err.code !== 'ENOENT') return;
        raw = '{}';
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return;
    }
    const at = Date.now();
    seenIndex = new Map();
    for (const item of manifestItemsFrom(parsed)) seenIndex.set(item.id, { at });
    seenSeededAt = at;
    seenLoaded = true;
    saveSeen();
}

/**
 * Write the store, best-effort. Persistence here is worth strictly less than
 * serving the library, and the first write happens at module load, so a throw
 * would be a server that will not boot at all: point npcManifestPath at a
 * directory the generator has not created yet - the GUI configured ahead of
 * its first run, or a typo in config.json - and an ENOENT out of this function
 * takes the whole process down over a pill in the corner of a card. The parent
 * directory is created when it is merely missing, and anything past that warns
 * and leaves the in-memory index exactly as it was. A seen store that cannot
 * be persisted is a New tag that forgets itself across a restart, which is a
 * degradation the user can live with and be told about.
 */
function saveSeen() {
    try {
        fs.mkdirSync(path.dirname(SEEN_FILE), { recursive: true });
        fs.writeFileSync(SEEN_FILE, JSON.stringify({
            version: SEEN_VERSION,
            // Every entry whose `at` matches this was auto-seeded rather than
            // actually looked at. Nothing reads it back, but it is what makes
            // the file explain itself to whoever opens it wondering why an
            // existing library arrived with nothing flagged.
            seededAt: seenSeededAt,
            seen: Object.fromEntries(seenIndex),
        }, null, 2));
    } catch (err) {
        console.warn(`[${PLUGIN_ID}] could not write ${SEEN_FILE}:`, err.message);
    }
}

/**
 * Called from itemView, i.e. once per NPC on every two-second /api/items poll,
 * so it must stay an in-memory Map lookup - see the warning on read3dFolder
 * for what happens when something in that path starts reading the disk. The
 * ensureSeenLoaded() call is free after the first: it early-returns, and in
 * the one case where it does not (seeding deferred because the manifest is
 * unreadable) loadManifest() has returned no items, so there is nothing to
 * call this for anyway.
 */
function isSeen(id) {
    ensureSeenLoaded();
    return seenIndex.has(id);
}

/**
 * Mark ids seen, ignoring any the manifest does not know about. The filter is
 * not defensiveness for its own sake: a stale client tab posting the id of an
 * NPC that has since been deleted would otherwise re-mark it, and a re-marked
 * deleted id is exactly how a regenerated NPC loses the tag deleteItem went to
 * the trouble of clearing.
 */
function markSeen(ids) {
    ensureSeenLoaded();
    const known = new Set(knownIds());
    const at = Date.now();
    let changed = false;
    for (const id of ids) {
        if (!known.has(id) || seenIndex.has(id)) continue;
        seenIndex.set(id, { at });
        changed = true;
    }
    if (changed) saveSeen();
    return changed;
}

function markAllSeen() {
    return markSeen(knownIds());
}

/**
 * Every id the seen store may hold: the manifest's, and one per background
 * still on disk. Backgrounds have no manifest entry, so without the second
 * half markSeen would drop the id the detail sheet posts for one and its New
 * tag could never be cleared. The walk is a readdir per call, which is what
 * backgroundItemView pays on every gallery load anyway.
 */
function knownIds() {
    return [
        ...loadManifest().map((item) => item.id),
        ...walkBackgrounds().map((rel) => backgrounds.idFor(rel)),
    ];
}

/**
 * Drop ids back out of the store, so whatever wears them is new again.
 *
 * This exists for the create job, which measures what it produced over folder
 * paths while newness is keyed by manifest id - the two disagree exactly when
 * generate-npc.py rolls the same name and seed twice, since the id is minted
 * from those two alone while npc_folder() suffixes the colliding folder to
 * "Name (2)". The run then adds a folder under an id the store may already
 * hold, which is a real NPC on disk that itemView reports isNew false for: the
 * banner announces one new NPC while the grid draws no pill on anything,
 * /api/unseen lists nothing, and "Show new NPCs" lands on a grid with nothing
 * to find. A run's own output is new by definition, so the run un-sees it.
 *
 * Both folders share the one id and so both light up, which is the honest
 * answer available to an id-keyed store: the pair are two versions of one NPC
 * and the user has just asked for the comparison.
 */
function forgetSeen(ids) {
    ensureSeenLoaded();
    let changed = false;
    for (const id of ids) {
        if (seenIndex.delete(id)) changed = true;
    }
    if (changed) saveSeen();
    return changed;
}

/** Every id the user has not looked at yet, across all kinds. */
function unseenIds() {
    ensureSeenLoaded();
    return knownIds().filter((id) => !seenIndex.has(id));
}

// Seed (or load) at startup rather than lazily on the first request. Lazily
// would swallow anything generate-npc.py wrote between this process starting
// and the first page load - which, for a tool whose empty state tells you to
// go and run generate-npc.py, is not a corner case.
ensureSeenLoaded();

/* ------------------------------------------------------------------ */
/* Regenerate art                                                      */
/* ------------------------------------------------------------------ */

/**
 * Regen jobs, keyed by item id. Unlike an import job this server runs the
 * work itself (spawning generate-npc.py, which talks to ComfyUI directly) -
 * there's no Foundry-side poll queue for it. One entry lingers per item after
 * it finishes so a client that was mid-poll still sees the final status; a
 * new regen request for the same item just overwrites it.
 */
const regenJobsByItemId = new Map();

const REGEN_LOG_LIMIT = 4000; // chars of stdout+stderr kept for an error message

/**
 * Items with a `--apply-only` spawn in flight - the staged trait edits, which
 * are not jobs and deliberately have no map of their own: they finish in about
 * a second, the answer is the item view the route replies with, and nothing
 * polls for them.
 *
 * A set rather than nothing at all because a staged edit reads the whole
 * manifest entry, rolls, and writes the whole entry back. Two of them
 * overlapping lose the first, and they are fast enough (no ComfyUI in the
 * loop) that a user CAN get a second click inside the window. One at a time
 * per item, refused rather than queued - the refusal is a sentence in the
 * detail sheet and the click can simply be repeated.
 */
const stagingItemIds = new Set();

// A staged edit rolls and writes a JSON file; it never contacts ComfyUI. A
// minute is already far past "the interpreter is wedged", and the route holds
// its response open for the whole of it, so the cap is what stops a hung
// Python leaving the trait gutters disabled until the page is reloaded.
const STAGE_TIMEOUT_MS = 60000;

function startRegenJob(item, { which, seedMode, seed, rerollTrait, setTrait, release }) {
    const existing = regenJobsByItemId.get(item.id);
    if (existing?.status === 'running') return { ok: false, reason: 'already regenerating' };
    // kindFor(), not kindOf(): kindOf() falls back an UNRECOGNISED kind onto
    // npc, which is right for reading a legacy entry that has no `kind` at
    // all but wrong here - a garbage kind must not silently spawn the NPC
    // generator on someone else's data. A real, registered kind with
    // supports.regen false (none exist yet) is refused the same way.
    const kind = kindFor(KINDS, item.kind);
    if (!kind || !kind.supports.regen) {
        return { ok: false, reason: `regenerating art isn't supported for kind "${item.kind}" yet` };
    }
    if (!fs.existsSync(kind.script)) {
        return { ok: false, reason: `${path.basename(kind.script)} not found at ${kind.script}` };
    }
    // The mirror of startAnimateJob's refusal: a portrait re-rendered under a
    // running animation would leave a loop of a face no longer on the sheet,
    // recorded as if it matched.
    if (animateJobsByItemId.get(item.id)?.status === 'running') {
        return { ok: false, reason: 'the portrait is being animated - wait for it to finish' };
    }

    const newSeed = seedMode === 'specific' ? seed
        : seedMode === 'random' ? crypto.randomInt(0, 2 ** 32 - 1)
        : item.seed; // 'same' - exact reproduction

    // Built by the registry rather than inline here, so the NPC and
    // spaceship generators share one implementation of "which half, which
    // seed" instead of this function growing a second branch per kind - see
    // buildRegenArgs in lib/kinds.js.
    const args = kind.regenArgs({
        manifestPath: config.npcManifestPath, id: item.id, newSeed, which,
    });
    // The generator seeds the re-roll from --new-seed, so a reroll and its
    // render share one seed. That is what makes a reroll repeatable at the
    // command line; here it is why the route always asks for a random seed,
    // since clicking "reroll" twice on the same NPC should not hand back the
    // same haircut both times.
    if (rerollTrait) args.push('--reroll-trait', rerollTrait);
    // The pinned counterpart of --reroll-trait: that flag draws a new value,
    // this one names it. The generator refuses both together, so no caller may
    // send both.
    if (setTrait) args.push('--set-trait', `${setTrait.table}=${setTrait.value}`);
    // Only the traits the user ticked. The generator expands each to its whole
    // cascade, so what actually moves is wider than this list - which is why
    // it prints every trait that travelled rather than counting them.
    if (release && release.length) args.push('--release', release.join(','));

    const job = {
        status: 'running', which, seedMode, seed: newSeed,
        rerollTrait: rerollTrait || null,
        setTrait: setTrait || null, release: release || [],
        startedAt: Date.now(), log: '',
    };
    regenJobsByItemId.set(item.id, job);

    let child;
    try {
        child = spawn(config.pythonExecutable, args, { cwd: path.dirname(kind.script) });
    } catch (err) {
        job.status = 'error';
        job.error = err.message;
        return { ok: true, seed: newSeed }; // job was recorded; poll will surface the failure
    }

    const collect = (chunk) => {
        job.log = (job.log + chunk.toString()).slice(-REGEN_LOG_LIMIT);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => {
        job.status = 'error';
        job.error = err.message;
    });
    child.on('close', (code) => {
        if (job.status === 'error') return; // already failed via the 'error' event above
        job.doneAt = Date.now();
        if (code === 0) {
            job.status = 'done';
        } else {
            job.status = 'error';
            job.error = job.log.trim() || `generate-npc.py exited with code ${code}`;
        }
    });

    return { ok: true, seed: newSeed };
}

/* ------------------------------------------------------------------ */
/* 3D models                                                           */
/* ------------------------------------------------------------------ */

const { model3dArgs, classify3dFiles } = require('./lib/model3d');

/**
 * 3D build jobs, keyed by item id - the same shape regenJobsByItemId has, and
 * for the same reason: this server runs generate-3d.py itself, so there is no
 * Foundry-side queue to ask. One entry lingers per item after it finishes so a
 * client mid-poll still sees the final status.
 *
 * A reconstruction takes minutes rather than seconds, which is why `stage`
 * exists alongside `status`. generate-3d.py flushes a line as it enters each
 * stage ("A-pose render ...", "assembling ..."), and a spinner held for six
 * minutes with nothing behind it is indistinguishable from a hang.
 */
const model3dJobsByItemId = new Map();

const MODEL_3D_LOG_LIMIT = 8000; // chars of stdout+stderr kept for an error message

/** <NPC folder>/3d/ - where generate-3d.py writes, beside the portrait and token. */
function model3dDir(item) {
    return path.join(item.folderPath, '3d');
}

/**
 * The deliverables in one NPC's 3d/ folder, or empty if it has none.
 *
 * Deliberately NOT called from itemView: that runs for every NPC on every
 * /api/items poll, and a readdir each would be one directory read per NPC per
 * poll across a catalogue in the hundreds. itemView answers the one cheap
 * question the grid needs (does the folder exist) and this answers the
 * expensive one, only for the NPC whose overlay is open.
 */
function read3dFolder(item) {
    let names = [];
    try {
        names = fs.readdirSync(model3dDir(item));
    } catch { /* no 3d/ folder - no model, which is not an error */ }
    return classify3dFiles(names, item.name);
}

function startModel3dJob(item, { rig, overwrite }) {
    const existing = model3dJobsByItemId.get(item.id);
    if (existing?.status === 'running') {
        return { ok: false, status: 409, error: 'a 3D build is already running for this NPC' };
    }
    // Same capability read the GET side of the panel uses (see
    // /api/model-3d below) rather than a second `item.kind !== 'npc'` - the
    // two used to be able to disagree, since a hard-coded literal here and a
    // registry-backed check there had no way to be checked against each
    // other. Ships are refused because spaceship.supports.model3d is false.
    if (!kindOf(KINDS, item).supports.model3d) {
        return {
            ok: false, status: 400,
            error: `building a 3D model isn't supported for kind "${item.kind}" yet`,
        };
    }
    if (!fs.existsSync(GENERATE_3D_SCRIPT)) {
        return { ok: false, status: 400, error: `generate-3d.py not found at ${GENERATE_3D_SCRIPT}` };
    }

    let args;
    try {
        args = model3dArgs(GENERATE_3D_SCRIPT, { id: item.id, rig, overwrite });
    } catch (err) {
        return { ok: false, status: 400, error: err.message };
    }

    const job = {
        status: 'running', rig: !!rig, overwrite: !!overwrite,
        startedAt: Date.now(), log: '', stage: null,
    };
    model3dJobsByItemId.set(item.id, job);

    let child;
    try {
        child = spawn(config.pythonExecutable, args, { cwd: path.dirname(GENERATE_3D_SCRIPT) });
    } catch (err) {
        job.status = 'error';
        job.error = err.message;
        return { ok: true }; // job was recorded; the poll will surface the failure
    }

    const remember = (chunk) => {
        job.log = (job.log + chunk.toString()).slice(-MODEL_3D_LOG_LIMIT);
    };
    child.stdout.on('data', (chunk) => {
        remember(chunk);
        // Only stdout drives the stage line. stderr carries warnings the
        // generator prints mid-run ("! rigging failed"), which are worth
        // keeping in the log and wrong as a progress label.
        const lines = chunk.toString().split('\n').map((line) => line.trim()).filter(Boolean);
        if (lines.length) job.stage = lines[lines.length - 1];
    });
    child.stderr.on('data', remember);
    child.on('error', (err) => {
        job.status = 'error';
        job.error = err.message;
    });
    child.on('close', (code) => {
        if (job.status === 'error') return; // already failed via the 'error' event above
        job.doneAt = Date.now();
        job.stage = null;
        if (code === 0) {
            job.status = 'done';
        } else {
            job.status = 'error';
            job.error = job.log.trim() || `generate-3d.py exited with code ${code}`;
        }
    });

    return { ok: true };
}

/**
 * What the detail overlay's 3D panel shows: the files on disk, plus whatever
 * this server's own job for that NPC is doing.
 *
 * Turnarounds come back as URLs carrying the file's mtime, the same
 * cache-busting stamp itemView puts on portraitUrl - a rebuild overwrites the
 * PNGs in place, and without a moving URL the panel would keep showing the
 * previous model's renders for as long as the browser felt like it.
 */
function model3dView(item) {
    const found = read3dFolder(item);
    const job = model3dJobsByItemId.get(item.id);
    const dir = model3dDir(item);
    const versions = [found.shell, found.print, found.rigged, ...found.turnarounds]
        .filter(Boolean)
        .map((file) => fileVersion(path.join(dir, file)))
        .filter((version) => typeof version === 'number');

    return {
        ...found,
        turnaroundUrls: found.turnarounds.map((file) => '/api/model-3d-image'
            + `?id=${encodeURIComponent(item.id)}&file=${encodeURIComponent(file)}`
            + `&v=${fileVersion(path.join(dir, file))}`),
        // The newest deliverable, so the panel can say when this model was
        // built without generate-3d.py having to record it anywhere.
        builtAt: versions.length ? Math.max(...versions) : null,
        status: job ? job.status : null,
        stage: job?.status === 'running' ? job.stage : null,
        error: job?.status === 'error' ? job.error : null,
    };
}

/**
 * Whether `file` is a name this NPC's own 3d/ folder can serve, or null.
 *
 * Two refusals, and they are different answers on purpose. A name with a path
 * separator in it - or `..`, or an absolute path - is not a filename at all,
 * and is a 400. A well-formed name that simply is not one of this NPC's
 * deliverables is a 404: that covers the intermediates the generator leaves in
 * the same folder (`_shell.glb` is a 17 MB raw reconstruction that looks like
 * a finished model and is not one) and another NPC's files if a folder was
 * ever reused.
 *
 * This is the first route here that takes a caller-supplied filename at all -
 * /api/image picks the name off the manifest entry - so the check is new
 * rather than a restatement of one made elsewhere.
 */
function model3dFileError(item, file) {
    if (!file) return { status: 400, error: 'file is required' };
    if (file !== path.basename(file) || file.includes('/') || file.includes('\\')
        || file === '.' || file === '..' || path.isAbsolute(file)) {
        return { status: 400, error: 'file must be a plain filename in this NPC\'s 3d/ folder' };
    }
    const found = read3dFolder(item);
    const servable = [found.shell, found.print, found.rigged, ...found.turnarounds].filter(Boolean);
    if (!servable.includes(file)) return { status: 404, error: 'no such 3D deliverable' };
    return null;
}

/* ------------------------------------------------------------------ */
/* Animated portraits                                                  */
/* ------------------------------------------------------------------ */

/**
 * Animation jobs, keyed by item id - the shape regenJobsByItemId and
 * model3dJobsByItemId share, for the same reason: this server runs
 * animate-portrait.py itself. One entry lingers per item after it finishes
 * so a client mid-poll still sees the final status.
 *
 * `stage` for the reason the 3D job has one: a Wan render is minutes, and
 * the script prints a line as it uploads, queues and waits.
 */
const animateJobsByItemId = new Map();

const ANIMATE_LOG_LIMIT = 8000; // chars of stdout+stderr kept for an error message

/** The loop and its sidecar: beside the portrait, named from it. */
function animationPaths(item) {
    const files = animate.animationFiles(animate.animationBase(item));
    return {
        webp: path.join(item.folderPath, files.webp),
        sidecar: path.join(item.folderPath, files.sidecar),
    };
}

function readAnimationSidecar(item) {
    let text = '';
    try {
        text = fs.readFileSync(animationPaths(item).sidecar, 'utf8');
    } catch { /* no sidecar - no animation yet, which is not an error */ }
    return animate.parseSidecar(text);
}

function writeAnimationSidecar(item, record) {
    fs.writeFileSync(animationPaths(item).sidecar, JSON.stringify(record, null, 2));
}

/**
 * The Animation table's enabled bullets, read from the kind's tables file
 * on every call - the Tables tab edits that file, and a list cached at
 * startup would keep offering a bullet it had just switched off.
 */
function animationDescriptions(kind) {
    try {
        return animate.descriptionsFrom(tableBullets.readTables(kind.tables));
    } catch {
        return [];
    }
}

function animationSupported(item) {
    return !!kindOf(KINDS, item).supports.animate;
}

/**
 * Where the next loop's description comes from: what a Re-roll or Set...
 * staged, else what the last loop used, else null - and the caller draws.
 */
function chosenDescription(sidecar) {
    return sidecar.pending || sidecar.description || null;
}

function startAnimateJob(item, { seedMode, seed, pingpong = true }) {
    const existing = animateJobsByItemId.get(item.id);
    if (existing?.status === 'running') {
        return { ok: false, status: 409, error: 'this portrait is already being animated' };
    }
    if (!animationSupported(item)) {
        return {
            ok: false, status: 400,
            error: `animating a portrait isn't supported for kind "${item.kind}" yet`,
        };
    }
    if (!fs.existsSync(ANIMATE_PORTRAIT_SCRIPT)) {
        return {
            ok: false, status: 400,
            error: `animate-portrait.py not found at ${ANIMATE_PORTRAIT_SCRIPT}`,
        };
    }
    // The script uploads the portrait in its first second and never reads it
    // again, so the race is not on the file - it is that the loop would be of
    // the portrait a running regen is about to replace, and the sidecar would
    // record it as matching.
    if (regenJobsByItemId.get(item.id)?.status === 'running') {
        return { ok: false, status: 409, error: 'this NPC is being re-rendered; wait for it to finish' };
    }
    const portrait = itemFile(item, 'portrait');
    if (!portrait || !fs.existsSync(portrait)) {
        return { ok: false, status: 400, error: 'this NPC has no portrait on disk to animate' };
    }

    const kind = kindOf(KINDS, item);
    const sidecar = readAnimationSidecar(item);
    let description = chosenDescription(sidecar);
    if (!description) description = animate.pickDescription(animationDescriptions(kind));
    if (!description) {
        return {
            ok: false, status: 400,
            error: `${path.basename(kind.tables)} has no '## ${animate.ANIMATION_TABLE}' `
                + 'table to draw a description from',
        };
    }

    // 'same' with no loop yet is a fresh draw rather than an error: the panel
    // defaults to it, and the first click should simply work.
    const newSeed = seedMode === 'specific' ? seed
        : seedMode === 'same' && Number.isInteger(sidecar.seed) ? sidecar.seed
        : crypto.randomInt(0, 2 ** 32 - 1);

    const files = animationPaths(item);
    let args;
    try {
        args = animate.animateArgs(ANIMATE_PORTRAIT_SCRIPT, {
            portrait, out: files.webp, description, seed: newSeed, pingpong,
        });
    } catch (err) {
        return { ok: false, status: 400, error: err.message };
    }

    const job = {
        status: 'running', description, seed: newSeed, pingpong,
        startedAt: Date.now(), log: '', stage: null,
    };
    animateJobsByItemId.set(item.id, job);

    let child;
    try {
        child = spawn(config.pythonExecutable, args, { cwd: path.dirname(ANIMATE_PORTRAIT_SCRIPT) });
    } catch (err) {
        job.status = 'error';
        job.error = err.message;
        return { ok: true, seed: newSeed }; // job was recorded; the poll will surface the failure
    }

    const remember = (chunk) => {
        job.log = (job.log + chunk.toString()).slice(-ANIMATE_LOG_LIMIT);
    };
    child.stdout.on('data', (chunk) => {
        remember(chunk);
        // stdout only, as the 3D job does it: the script's progress lines go
        // there, and stderr is where a warning would land.
        const lines = chunk.toString().split('\n').map((line) => line.trim()).filter(Boolean);
        if (lines.length) job.stage = lines[lines.length - 1];
    });
    child.stderr.on('data', remember);
    child.on('error', (err) => {
        job.status = 'error';
        job.error = err.message;
    });
    child.on('close', (code) => {
        if (job.status === 'error') return; // already failed via the 'error' event above
        job.doneAt = Date.now();
        job.stage = null;
        if (code !== 0) {
            job.status = 'error';
            job.error = job.log.trim() || `animate-portrait.py exited with code ${code}`;
            return;
        }
        if (!fs.existsSync(files.webp)) {
            job.status = 'error';
            job.error = `animate-portrait.py exited clean but wrote no ${path.basename(files.webp)}`;
            return;
        }
        // Written only now, and only on success: the record describes the
        // loop on disk. A failed run leaves the last good record - the staged
        // description included - exactly as it was, so the next click retries
        // the same choice. `pending` is consumed here because the loop now
        // shows it.
        const { pending, ...kept } = readAnimationSidecar(item);
        void pending;
        try {
            // `pingpong` is recorded beside the seed for the same reason the
            // seed is: "Same seed" on the next click means "the loop I have,
            // again", and a loop that played one way and comes back
            // ping-ponged is not that loop.
            writeAnimationSidecar(item, {
                ...kept, description, seed: newSeed, pingpong,
                when: new Date().toISOString(),
                portraitVersion: fileVersion(portrait),
            });
        } catch (err) {
            job.status = 'error';
            job.error = `the loop was written but its record could not be: ${err.message}`;
            return;
        }
        job.status = 'done';
    });

    return { ok: true, seed: newSeed };
}

/**
 * Stage the description the next loop will use, without rendering. The
 * animation panel's Re-roll and Set... - the same edit-then-render split the
 * trait gutters have, for the same reason: a render is minutes and a choice
 * should be free to change until it is paid for.
 */
function stageAnimationDescription(item, { op, value }) {
    if (!animationSupported(item)) {
        return {
            ok: false, status: 400,
            error: `animating a portrait isn't supported for kind "${item.kind}" yet`,
        };
    }
    if (animateJobsByItemId.get(item.id)?.status === 'running') {
        return { ok: false, status: 409, error: 'this portrait is being animated; wait for it to finish' };
    }
    const kind = kindOf(KINDS, item);
    const descriptions = animationDescriptions(kind);
    if (!descriptions.length) {
        return {
            ok: false, status: 400,
            error: `${path.basename(kind.tables)} has no '## ${animate.ANIMATION_TABLE}' table to choose from`,
        };
    }
    const sidecar = readAnimationSidecar(item);
    let pending;
    if (op === 'reroll') {
        pending = animate.pickDescription(descriptions, { exclude: chosenDescription(sidecar) });
    } else if (!descriptions.includes(value)) {
        // Verbatim to the text encoder, so only what the table offers - the
        // same rule /api/stage-trait applies to a --set-trait value.
        return {
            ok: false, status: 400,
            error: `that is not a description the ${animate.ANIMATION_TABLE} table offers; `
                + 'the tables file may have changed since this list was loaded.',
        };
    } else {
        pending = value;
    }
    try {
        writeAnimationSidecar(item, { ...sidecar, pending });
    } catch (err) {
        return { ok: false, status: 500, error: `couldn't record the choice: ${err.message}` };
    }
    return { ok: true };
}

/**
 * What the Animated portrait panel shows: the loop on disk, its record, the
 * table it can choose from, and whatever this server's own job is doing.
 * Separate from itemView for the reason /api/model-3d is: it reads the
 * sidecar and the tables file, and the grid does not need either.
 */
function animationView(item) {
    const files = animationPaths(item);
    const sidecar = readAnimationSidecar(item);
    const job = animateJobsByItemId.get(item.id);
    const version = fileVersion(files.webp);
    const kind = kindOf(KINDS, item);
    return {
        supported: animationSupported(item),
        descriptions: animationDescriptions(kind),
        description: sidecar.description || null,
        pending: sidecar.pending || null,
        seed: Number.isInteger(sidecar.seed) ? sidecar.seed : null,
        // null for a loop made before the choice was recorded, so the panel
        // can tell "one way" from "unknown" and leave its checkbox alone.
        pingpong: typeof sidecar.pingpong === 'boolean' ? sidecar.pingpong : null,
        when: sidecar.when || null,
        file: version === null ? null : path.basename(files.webp),
        url: version === null ? null
            : `/api/animation-image?id=${encodeURIComponent(item.id)}&v=${version}`,
        builtAt: version,
        // Only ever true with a loop on disk - a stale nothing is nothing.
        stale: version !== null && animate.isStale(sidecar, fileVersion(itemFile(item, 'portrait'))),
        status: job ? job.status : null,
        stage: job?.status === 'running' ? job.stage : null,
        error: job?.status === 'error' ? job.error : null,
    };
}

/* ------------------------------------------------------------------ */
/* Backgrounds                                                         */
/* ------------------------------------------------------------------ */

const BACKGROUND_LOG_LIMIT = 20000;   // chars of stdout+stderr kept per job
const BACKGROUND_LIST_LIMIT = 200000; // chars of --list output kept per catalogue
const BACKGROUND_WALK_DEPTH = 6;
// Overridable so a test can pin a hung --list without a real 15s wait; a
// config.json value is a startup-time constant either way, the same as
// STAGE_TIMEOUT_MS.
const BACKGROUND_LIST_TIMEOUT_MS = Number(config.backgroundListTimeoutMs) || 15000;

const BACKGROUND_CONTENT_TYPES = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

/** Every render and animate job this tab has started, keyed by its own id. */
const backgroundJobs = new Map();

/** Which job is animating each still, so a second click on one is a 409. */
const backgroundAnimateByRel = new Map();

function backgroundCatalogueFiles() {
    try {
        return fs.readdirSync(BACKGROUND_PROMPTS_DIR)
            .filter((file) => backgrounds.isCatalogue(file))
            .sort();
    } catch {
        return [];
    }
}

/**
 * Which of the three pieces the tab needs are not here, as sentences. Checked
 * per request the way kinds.available() is and for the same reason: dropping
 * generate-art.py into place should not need a server restart to be noticed,
 * and this route is fetched on a tab visit, not polled.
 */
function backgroundsMissing() {
    const missing = [];
    if (!fs.existsSync(GENERATE_ART_SCRIPT)) {
        missing.push(`generate-art.py not found at ${GENERATE_ART_SCRIPT}`);
    }
    if (!fs.existsSync(ANIMATE_PORTRAIT_SCRIPT)) {
        missing.push(`animate-portrait.py not found at ${ANIMATE_PORTRAIT_SCRIPT}`);
    }
    if (!backgroundCatalogueFiles().length) {
        missing.push(`no *${backgrounds.CATALOGUE_SUFFIX} found in ${BACKGROUND_PROMPTS_DIR}`);
    }
    return missing;
}

function backgroundsAvailable() {
    return backgroundsMissing().length === 0;
}

/**
 * Why "Import into SillyTavern" cannot run right now, as a sentence, or null
 * when it can. Checked per request like backgroundsMissing() and for the
 * same reason: pointing config.json at the folder should not need a restart
 * to be noticed. A configured folder that is not there is an error and not
 * something to mkdir: SillyTavern only ever reads its own data/<user>/
 * backgrounds, so a typo in the path would otherwise fill a folder nothing
 * looks at while every import reported success.
 */
function sillyTavernUnavailable() {
    if (!SILLYTAVERN_BACKGROUNDS_DIR) {
        return 'set sillyTavernBackgroundsDir in config.json to SillyTavern\'s data/<user>/backgrounds folder';
    }
    let isDir = false;
    try {
        isDir = fs.statSync(SILLYTAVERN_BACKGROUNDS_DIR).isDirectory();
    } catch { /* not there */ }
    return isDir ? null : `sillyTavernBackgroundsDir is not a folder: ${SILLYTAVERN_BACKGROUNDS_DIR}`;
}

/**
 * What one still is called in SillyTavern's folder and whether it is there.
 * "Imported" is read off that folder rather than recorded here, so a
 * background deleted from inside SillyTavern stops being marked without an
 * index to reconcile; the loop's presence is not part of the answer because a
 * loop animated after the still went over is exactly the case a second click
 * exists for, and the pill should not go dark for it.
 */
function sillyTavernRecord(rel) {
    const names = backgrounds.sillyTavernNames(rel);
    const available = sillyTavernUnavailable() === null;
    return {
        ...names,
        imported: available && fs.existsSync(path.join(SILLYTAVERN_BACKGROUNDS_DIR, names.still)),
    };
}

/**
 * Copies a still and, when one sits beside it, its loop into SillyTavern's
 * backgrounds folder, overwriting either. Synchronous, and deliberately so:
 * these are a few megabytes at most, and a job with a poll for a copy would
 * be ceremony. SillyTavern regenerates a thumbnail when the file's mtime
 * moves past the cached one's, which copyFileSync guarantees, so an
 * overwrite shows up on the next open of its Backgrounds panel.
 */
function importBackgroundToSillyTavern(rel) {
    const still = backgrounds.resolveInside(BACKGROUNDS_DIR, rel);
    if (!still) return { ok: false, status: 400, error: 'rel must be a path inside the backgrounds folder' };
    let stillIsFile = false;
    try {
        stillIsFile = fs.statSync(still).isFile();
    } catch { /* not there */ }
    if (!stillIsFile || backgrounds.isAnimationFile(path.basename(still))) {
        return { ok: false, status: 404, error: 'no such background' };
    }
    const why = sillyTavernUnavailable();
    if (why) return { ok: false, status: 400, error: why };

    const names = backgrounds.sillyTavernNames(rel);
    const loop = backgroundAbs(backgrounds.animationFilesFor(rel).webp);
    const copies = [[still, names.still]];
    if (fs.existsSync(loop)) copies.push([loop, names.loop]);
    const copied = [];
    try {
        for (const [from, name] of copies) {
            fs.copyFileSync(from, path.join(SILLYTAVERN_BACKGROUNDS_DIR, name));
            copied.push(name);
        }
    } catch (err) {
        return { ok: false, status: 500, error: `copy failed after ${copied.length} file(s): ${err.message}` };
    }
    return { ok: true, dir: SILLYTAVERN_BACKGROUNDS_DIR, copied };
}

/**
 * One catalogue's entries, from the script's own --list rather than a second
 * markdown parser here - see lib/backgrounds.js's parseListOutput for why.
 * One child process per catalogue file; the route runs them concurrently.
 *
 * Every failure resolves to an empty list rather than rejecting: the picker
 * is the only thing that depends on this, and an empty entry list with a
 * visible "no entries" state beats a 500 on the whole tab.
 */
function readCatalogueEntries(file) {
    const full = path.join(BACKGROUND_PROMPTS_DIR, file);
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(config.pythonExecutable,
                [GENERATE_ART_SCRIPT, '--prompts', full, '--list'],
                { cwd: path.dirname(GENERATE_ART_SCRIPT) });
        } catch {
            return resolve([]);
        }
        let timer = null;
        let settled = false;
        // One funnel for every exit, the stageOne pattern: a timeout racing
        // the child's own close is a fresh way to double-resolve otherwise.
        const settle = (entries) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(entries);
        };
        let out = '';
        let errText = '';
        child.stdout.on('data', (chunk) => {
            if (out.length < BACKGROUND_LIST_LIMIT) out += chunk.toString();
        });
        // Kept, unlike before: an operator staring at "no entries" with zero
        // diagnostics has nowhere else to look. Bounded the same way a job's
        // own log is.
        child.stderr.on('data', (chunk) => { errText = (errText + chunk.toString()).slice(-BACKGROUND_LOG_LIMIT); });
        child.on('error', () => settle([]));
        child.on('close', () => {
            let text = '';
            try {
                text = fs.readFileSync(full, 'utf8');
            } catch { /* names and excerpts degrade to blank, which the client handles */ }
            const entries = backgrounds.attachHeadings(backgrounds.parseListOutput(out), text);
            if (!entries.length && errText.trim()) {
                console.warn(`[${PLUGIN_ID}] ${file} --list produced no entries: ${errText.trim()}`);
            }
            settle(entries);
        });
        // A hanging --list (a blocking import, a Python waiting on something)
        // would otherwise hang GET /api/backgrounds forever and leak the
        // child - this route is fetched on every tab visit and after every
        // job completion. Resolves to [] like every other failure here.
        timer = setTimeout(() => {
            child.kill();
            console.warn(`[${PLUGIN_ID}] ${file} --list did not finish within `
                + `${BACKGROUND_LIST_TIMEOUT_MS / 1000}s${errText.trim() ? `: ${errText.trim()}` : ''}`);
            settle([]);
        }, BACKGROUND_LIST_TIMEOUT_MS);
    });
}

/**
 * Every still under backgroundsDir, as '/'-separated relative paths.
 *
 * Depth-capped because this walks a folder a GM owns by hand and a link loop
 * there should not hang a page load. Dotfiles are skipped, which is what
 * keeps .backgrounds-manifest.json out of the gallery, and so is this
 * module's own animation output: a loop belongs on its still's card, not as a
 * card of its own.
 */
function walkBackgrounds(dir = BACKGROUNDS_DIR, rel = '', depth = 0, out = []) {
    if (depth > BACKGROUND_WALK_DEPTH) return out;
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            walkBackgrounds(path.join(dir, entry.name), childRel, depth + 1, out);
            continue;
        }
        if (!backgrounds.IMAGE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue;
        if (backgrounds.isAnimationFile(entry.name)) continue;
        out.push(childRel);
    }
    return out;
}

function backgroundAbs(rel) {
    return path.join(BACKGROUNDS_DIR, ...String(rel).split('/'));
}

function readBackgroundSidecar(sidecarRel) {
    try {
        return backgrounds.parseSidecar(fs.readFileSync(backgroundAbs(sidecarRel), 'utf8'));
    } catch {
        return {}; // no sidecar - no loop yet, which is not an error
    }
}

/**
 * One gallery card: the still, whatever loop sits beside it, and whatever
 * this server's own job is doing to it. Both urls carry the file's mtime as
 * the cache-buster /api/animation-image's does.
 */
function backgroundItemView(rel) {
    const mtime = fileVersion(backgroundAbs(rel));
    if (mtime === null) return null; // deleted between the walk and here
    const files = backgrounds.animationFilesFor(rel);
    const builtAt = fileVersion(backgroundAbs(files.webp));
    const sidecar = readBackgroundSidecar(files.sidecar);
    const jobId = backgroundAnimateByRel.get(rel);
    const job = jobId ? backgroundJobs.get(jobId) : null;
    return {
        rel,
        name: backgrounds.displayName(path.basename(rel)),
        mtime,
        url: `/api/backgrounds/image?rel=${encodeURIComponent(rel)}&v=${mtime}`,
        // Only ever present with a loop on disk - a stale nothing is nothing.
        animation: builtAt === null ? null : {
            webp: files.webp,
            url: `/api/backgrounds/image?rel=${encodeURIComponent(files.webp)}&v=${builtAt}`,
            description: sidecar.description || null,
            seed: Number.isInteger(sidecar.seed) ? sidecar.seed : null,
            builtAt,
            stale: backgrounds.isStale(sidecar, mtime),
        },
        status: job ? job.status : null,
        error: job && job.status === 'error' ? job.error : null,
        sillyTavern: sillyTavernRecord(rel),
    };
}

/**
 * The Import tab's category id for backgrounds. Not a registry kind: a kind
 * has a generator script, a manifest entry and traits, and a background has
 * none of those (see the `features` comment on /api/categories). It is a
 * category because the grid is the one place the user already goes to look
 * over generated art and throw some of it away, and backgrounds were the one
 * kind of art it could not show.
 */
const BACKGROUND_KIND = 'background';
const BACKGROUND_LABEL = 'Backgrounds';

/**
 * One still as an /api/items row, so the grid can draw it with the code it
 * draws NPCs and ships with. Every field the client reads off an item view is
 * present and answers honestly for a file that is only a file: no traits, no
 * seed, not importable, nothing to regenerate, and an empty `supports` so the
 * sheet's regen, 3D and animate panels all stay hidden. The still stands in
 * the portrait slot and the loop in the animation slot, which is where the
 * grid looks for a thumbnail and an "Animating…" badge. The gallery view
 * rides along under `background` for the sheet's own line about the loop.
 */
function backgroundGridItem(rel) {
    const view = backgroundItemView(rel);
    if (!view) return null;
    const id = backgrounds.idFor(rel);
    const files = backgrounds.animationFilesFor(rel);
    return {
        id, kind: BACKGROUND_KIND, name: view.name, callsign: '', traits: {}, seed: null,
        roleCategory: null, when: null, importable: false, imported: false,
        isNew: !isSeen(id), hasRawTraits: false, importedActorUuid: null, importedAt: null,
        jobStatus: null, jobError: null, regenStatus: null, regenError: null,
        has3d: false, model3dStatus: null, model3dError: null,
        hasAnimation: !!view.animation,
        animationUrl: view.animation ? view.animation.url : null,
        animationStatus: view.status, animationError: view.error,
        folderPath: path.dirname(backgroundAbs(rel)),
        portraitFile: path.basename(rel),
        tokenFile: view.animation ? path.basename(files.webp) : null,
        portraitUrl: view.url, tokenUrl: null, portraitPrompt: null, tokenPrompt: null,
        artStale: false, supports: {}, tokenHexes: null,
        // `available` rides on each row because /api/items carries nothing
        // else about the tab, and the sheet's button needs it per item.
        background: {
            rel,
            animation: view.animation,
            sillyTavern: { available: sillyTavernUnavailable() === null, ...view.sillyTavern },
        },
    };
}

/**
 * The still, its loop and the loop's record, and the seen-store entry for
 * the id - the same set deleteItem clears for an NPC, minus the manifest a
 * background never had. Caller has already resolved `still` inside the
 * folder and checked it is a file.
 */
function deleteBackground(rel, still) {
    const files = backgrounds.animationFilesFor(rel);
    for (const target of [still, backgroundAbs(files.webp), backgroundAbs(files.sidecar)]) {
        try {
            fs.rmSync(target, { force: true });
        } catch (err) {
            throw new Error(`couldn't delete files: ${err.message}`);
        }
    }
    backgroundAnimateByRel.delete(rel);
    ensureSeenLoaded();
    if (seenIndex.delete(backgrounds.idFor(rel))) saveSeen();
}

/**
 * The motion prompts, read off the tables file on every call - the Tables tab
 * edits that file, and a list cached at startup would keep offering a bullet
 * it had just switched off. The same reason animationDescriptions has.
 */
function backgroundMotionPrompts() {
    try {
        return backgrounds.motionPromptsFrom(tableBullets.readTables(BACKGROUND_TABLES_PATH));
    } catch {
        return [];
    }
}

/**
 * Spawns generate-art.py for one catalogue entry.
 *
 * The before/after snapshot is startCreateJob's technique, taken for the
 * reason it states: exit code 0 means the script did not crash, not that it
 * wrote anything, and ComfyUI can drop a job. A run that produced nothing
 * reports produced: 0 and a log tail rather than a success the gallery
 * cannot show.
 */
function startBackgroundRenderJob({
    catalogue, prefix, variants, seed, width, height, animateWhenDone,
}) {
    if (!fs.existsSync(GENERATE_ART_SCRIPT)) {
        return { ok: false, status: 400, error: `generate-art.py not found at ${GENERATE_ART_SCRIPT}` };
    }
    let args;
    try {
        args = backgrounds.renderArgs(GENERATE_ART_SCRIPT, {
            catalogue: path.join(BACKGROUND_PROMPTS_DIR, catalogue),
            prefix,
            backgroundsDir: BACKGROUNDS_DIR,
            variants,
            width,
            height,
            seed,
        });
    } catch (err) {
        return { ok: false, status: 400, error: err.message };
    }

    // --download-to creates the tree itself, but the snapshot below has to be
    // taken against a directory that exists or a first run reads as "one new
    // file appeared" for every file the script wrote plus nothing it did not.
    try {
        fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true });
    } catch (err) {
        return { ok: false, status: 500, error: `couldn't create ${BACKGROUNDS_DIR}: ${err.message}` };
    }
    const before = new Set(walkBackgrounds());

    const jobId = crypto.randomUUID();
    const job = {
        kind: 'render', status: 'running', startedAt: Date.now(), log: '',
        produced: null, chain: [], chainError: null,
    };
    backgroundJobs.set(jobId, job);

    let child;
    try {
        child = spawn(config.pythonExecutable, args, { cwd: path.dirname(GENERATE_ART_SCRIPT) });
    } catch (err) {
        job.status = 'error';
        job.error = err.message;
        return { ok: true, jobId };
    }

    const collect = (chunk) => { job.log = (job.log + chunk.toString()).slice(-BACKGROUND_LOG_LIMIT); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => { job.status = 'error'; job.error = err.message; });
    child.on('close', (code) => {
        if (job.status === 'error') return; // already failed via the 'error' event
        job.doneAt = Date.now();
        if (code !== 0) {
            job.status = 'error';
            job.error = job.log.trim() || `generate-art.py exited with code ${code}`;
            return;
        }
        const added = walkBackgrounds().filter((rel) => !before.has(rel));
        job.produced = added.length;
        // The Import tab's ids for what landed, so the banner can name the
        // run and "Show new Backgrounds" can find it; and un-seen, for the
        // reason the create job's forgetSeen gives - a still rendered over a
        // path the store already holds is this run's output all the same.
        job.producedIds = added.map((rel) => backgrounds.idFor(rel));
        forgetSeen(job.producedIds);
        if (animateWhenDone) chainAnimations(job, added, animateWhenDone);
        // Flipped LAST, deliberately. The client stops polling the moment this
        // stops being 'running', so a chain recorded after the flip would be
        // invisible to the run that started it - and the status route would
        // hand back a finished render with an empty chain.
        job.status = 'done';
    });

    return { ok: true, jobId };
}

/**
 * Spawns animate-portrait.py --background for one still.
 *
 * The sidecar is written on success only, and holds the still's mtime under
 * `portraitVersion` - the same key animate.isStale reads, which is why that
 * function needs no second version of itself here.
 */
function startBackgroundAnimateJob({ rel, description, seedMode, seed, pingpong }) {
    const still = backgrounds.resolveInside(BACKGROUNDS_DIR, rel);
    if (!still) {
        return { ok: false, status: 400, error: 'rel must be a path inside the backgrounds folder' };
    }
    // isFile, not existsSync: rel: '.' resolves to BACKGROUNDS_DIR itself (by
    // design - resolveInside returns the root for it), and existsSync is true
    // for that directory too. Without this, animate-portrait.py gets spawned
    // pointed at a directory instead of refusing with a 404.
    let stillIsFile = false;
    try {
        stillIsFile = fs.statSync(still).isFile();
    } catch { /* not there, which is the same 404 as before */ }
    if (!stillIsFile) return { ok: false, status: 404, error: 'no such background' };
    if (!fs.existsSync(ANIMATE_PORTRAIT_SCRIPT)) {
        return {
            ok: false, status: 400,
            error: `animate-portrait.py not found at ${ANIMATE_PORTRAIT_SCRIPT}`,
        };
    }
    const runningId = backgroundAnimateByRel.get(rel);
    if (runningId && backgroundJobs.get(runningId)?.status === 'running') {
        return { ok: false, status: 409, error: 'this background is already being animated' };
    }
    // chainAnimations always supplies a real one (it bails on an empty pool
    // itself, before ever calling this), so an empty description here is a
    // direct /api/backgrounds/animate call that simply left it out - not a
    // tables-file problem, and the message must not suggest otherwise.
    if (typeof description !== 'string' || !description) {
        return { ok: false, status: 400, error: 'description is required to animate a background' };
    }

    const files = backgrounds.animationFilesFor(rel);
    const out = backgroundAbs(files.webp);
    const sidecarPath = backgroundAbs(files.sidecar);
    const previous = readBackgroundSidecar(files.sidecar);

    // The same three modes as /api/regenerate and /api/animation. 'same' with
    // no loop yet is a fresh draw rather than an error: the panel defaults to
    // it, and the first click should simply work.
    const newSeed = seedMode === 'specific' ? seed
        : seedMode === 'same' && Number.isInteger(previous.seed) ? previous.seed
        : crypto.randomInt(0, 2 ** 32 - 1);

    let args;
    try {
        args = backgrounds.animateArgs(ANIMATE_PORTRAIT_SCRIPT, {
            still, out, description, seed: newSeed, pingpong: pingpong !== false,
        });
    } catch (err) {
        return { ok: false, status: 400, error: err.message };
    }

    const jobId = crypto.randomUUID();
    const job = {
        kind: 'animate', rel, status: 'running', startedAt: Date.now(), log: '',
        description, seed: newSeed,
    };
    backgroundJobs.set(jobId, job);
    backgroundAnimateByRel.set(rel, jobId);

    let child;
    try {
        child = spawn(config.pythonExecutable, args, { cwd: path.dirname(ANIMATE_PORTRAIT_SCRIPT) });
    } catch (err) {
        job.status = 'error';
        job.error = err.message;
        return { ok: true, jobId };
    }

    const collect = (chunk) => { job.log = (job.log + chunk.toString()).slice(-BACKGROUND_LOG_LIMIT); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => { job.status = 'error'; job.error = err.message; });
    child.on('close', (code) => {
        if (job.status === 'error') return;
        job.doneAt = Date.now();
        // The file has to be there, not merely an exit code of 0 - same
        // reason the render job counts rather than trusts.
        if (code !== 0 || !fs.existsSync(out)) {
            job.status = 'error';
            job.error = job.log.trim() || `animate-portrait.py exited with code ${code}`;
            return;
        }
        job.status = 'done';
        try {
            fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
            fs.writeFileSync(sidecarPath, JSON.stringify({
                description,
                seed: newSeed,
                when: new Date().toISOString(),
                portraitVersion: fileVersion(still),
            }, null, 2));
        } catch { /* the loop is on disk; a missing sidecar only loses the record */ }
    });

    return { ok: true, jobId };
}

/**
 * The opt-in chain: one animate job per still the render actually produced,
 * started from the render's own close handler on exit code 0.
 *
 * Each still gets its OWN motion prompt and its own seed rather than all
 * sharing the one the panel was showing. The variants are different images,
 * and giving them one description would spend the pool on the run where it is
 * least likely to fit all of them. What was actually used lands in that
 * still's own sidecar, so the gallery can always say what made each loop.
 *
 * The parent reports done once its own render finished; the client watches
 * these ids separately, so a failed loop is visible as itself rather than
 * retroactively failing a render that did produce a still.
 */
function chainAnimations(job, added, { pingpong }) {
    const pool = backgroundMotionPrompts();
    if (!pool.length) {
        job.chainError = `${path.basename(BACKGROUND_TABLES_PATH)} has no enabled `
            + `'## ${backgrounds.MOTION_TABLE}' bullets, so nothing was animated`;
        return;
    }
    let last = null;
    for (const rel of added) {
        const description = backgrounds.pickMotionPrompt(pool, { exclude: last });
        last = description;
        const started = startBackgroundAnimateJob({
            rel, description, seedMode: 'random', pingpong,
        });
        if (started.ok) job.chain.push({ rel, jobId: started.jobId });
        else job.chainError = started.error;
    }
}

/* ------------------------------------------------------------------ */
/* Create NPC                                                          */
/* ------------------------------------------------------------------ */

/**
 * Jobs spawned from the "Create NPC" panel, keyed by a fresh id - unlike a
 * regen job these aren't tied to an existing manifest entry (there isn't one
 * until the script finishes and writes it), so the GUI polls by jobId
 * instead and just refreshes the NPC list once a non-dry-run job finishes.
 */
const createJobs = new Map();
const CREATE_LOG_LIMIT = 20000;

const overrideTables = require('./lib/overrideTables');

// Derived from generate-npc.py's REQUIRED_TABLES rather than restated, because
// a restated copy drifted: Weapon, Theme, Height and Hair colour were all
// unreachable from the override dropdown, and Accent outlived its rename.
// Read once at startup - the generator does not change under a running server,
// and a per-request read would stat the script on every page load.
//
// The fallback is the list as it stood when this was derived, so a generator
// whose REQUIRED_TABLES cannot be parsed still yields a working dropdown
// rather than an empty one.
const OVERRIDE_TABLES_FALLBACK = [
    'Given names', 'Family names', 'Callsigns', 'Theme', 'Age', 'Build',
    'Height', 'Skin', 'Hair', 'Hair colour', 'Eyes', 'Feature', 'Demeanor',
    'Role', 'Faction', 'Outfit', 'Headgear', 'Weapon', 'Gear', 'Glow colour',
    'Backdrop', 'Weather', 'Stance',
];

/**
 * The four parses above (REQUIRED_TABLES minus Pronouns, REROLLABLE_TRAITS,
 * RAW_REROLLABLE_TRAITS, TRAIT_DEPENDENTS), read off EVERY kind's own
 * generator script rather than GENERATE_NPC_SCRIPT alone - a spaceship has
 * its own REQUIRED_TABLES and its own reroll lists, and offering it the
 * NPC's would name traits its script has never heard of. Built by looping
 * the registry once at startup, the same as OVERRIDE_TABLES used to be built
 * for npc alone.
 *
 * OVERRIDE_TABLES_FALLBACK applies to npc only, for the reason it always
 * did: it is a hand-derived snapshot of the NPC script's own list, and
 * guessing at a spaceship's REQUIRED_TABLES from it would be guessing about
 * a script this fallback has never read. A kind whose script cannot be read
 * or parsed gets [] for its tables and reroll lists and {} for dependents -
 * the safe way to be wrong: no override dropdown entries and no reroll
 * buttons, rather than offering ones the generator would refuse.
 */
const OVERRIDE_DATA_BY_KIND = (() => {
    const out = {};
    for (const [id, kindEntry] of Object.entries(KINDS)) {
        let source = null;
        try {
            source = fs.readFileSync(kindEntry.script, 'utf8');
        } catch (err) {
            console.warn(
                `Could not read ${kindEntry.script} (${err.message}) - `
                + `the ${id} override dropdown and reroll buttons will be empty.`,
            );
        }
        let tables = source ? overrideTables.overrideTablesFrom(source) : [];
        if (!tables.length && id === DEFAULT_KIND) {
            if (source) {
                console.warn(
                    `REQUIRED_TABLES in ${kindEntry.script} parsed to zero entries - `
                    + 'falling back to the hard-coded OVERRIDE_TABLES_FALLBACK list.',
                );
            }
            tables = OVERRIDE_TABLES_FALLBACK;
        }
        out[id] = {
            tables,
            rerollable: source ? overrideTables.rerollableTraitsFrom(source) : [],
            rawRerollable: source ? overrideTables.rawRerollableTraitsFrom(source) : [],
            dependents: source ? overrideTables.traitDependentsFrom(source) : {},
        };
    }
    return out;
})();

/**
 * Traits `--reroll-trait` accepts, derived from the generator's own two lists.
 *
 * Two, because the generator chooses between them per NPC rather than once:
 * reroll_trait() reads the manifest entry's rawTraits and takes
 * RAW_REROLLABLE_TRAITS when they are there, REROLLABLE_TRAITS when they are
 * not. An entry written before rawTraits existed stores its bullets with the
 * flags stripped, so only the eleven traits nothing else gates can be re-rolled
 * from it; an entry that recorded its raw bullets has those flags back and
 * re-rolls all twenty-two - everything but the two halves of the name and
 * Pronouns, which are refused for reasons raw bullets do not touch.
 *
 * Reading only the shorter list, as this server did before both were parsed
 * here, fails quietly rather than loudly, which is why it is worth naming:
 * Theme is on the raw list alone, so the single most useful re-roll in the
 * generator had no button on any modern NPC - and nor did Outfit, Weapon, Role,
 * Backdrop, Faction, Gear, Age, Hair colour, Weather or Stance, every one of
 * which the generator will re-roll from raw bullets. Which list applies is
 * decided per item, at both the offer (itemView, and openDetail in the
 * client) and the refusal (POST /api/reroll-trait), and those two have to agree:
 * a button that answers 400 is worse than no button.
 *
 * No hard-coded fallback for either, deliberately: which traits can be
 * re-rolled is a property of what the manifest stores, and guessing it here
 * would be guessing about the generator's internals. An empty list means the UI
 * offers no reroll buttons, which is a safe way to be wrong.
 *
 * TRAIT_DEPENDENTS comes off the same read, and it answers the question the
 * page asks second: not whether a trait can be re-rolled but how much of the
 * NPC goes with it. The two lists cannot answer that - inferring it from them,
 * by treating anything outside the legacy eleven as a cascade, warns about
 * Faction, Weather and Stance, which cascade to nothing at all, and can never
 * name what a real cascade carries. The map is read here rather than in the
 * client because the client cannot read a Python file, and it degrades to an
 * empty map on a parse miss like everything else in this block.
 */
/**
 * Whether this manifest entry recorded the raw bullets a wider re-roll needs.
 *
 * The emptiness half of the test is load-bearing rather than defensive, and it
 * mirrors generate-npc.py's own: reroll_trait() treats a recorded-but-empty
 * rawTraits as NO raw bullets on purpose, since pinning nothing would re-roll
 * the whole NPC under the name of one trait. A bare `!!item.rawTraits` would
 * send such an entry down the raw path here and offer it buttons the generator
 * is about to refuse.
 *
 * Presence and emptiness only - never the KEYS. A legacy entry can carry raw
 * bullets under names the generator renames on load (rename_legacy_traits),
 * and a missing bullet is something it already handles by warning and
 * re-rolling that trait along, so matching keys against the table list here
 * would be predicting the generator's repairs from the outside.
 */
function hasRawTraits(item) {
    return !!(item.rawTraits && Object.keys(item.rawTraits).length);
}

/**
 * The re-rollable list that applies to one item - see the pair above.
 *
 * Read off OVERRIDE_DATA_BY_KIND for the item's OWN kind, not npc's alone:
 * a spaceship has its own reroll lists, off its own script, and pairing a
 * ship's rawTraits with the NPC generator's REROLLABLE_TRAITS would offer or
 * refuse buttons for traits the ship script has never heard of.
 *
 * kindFor(), not kindOf() - same reasoning as startRegenJob's guard: an
 * item naming a kind the registry does not recognise gets an empty list
 * rather than npc's, which is the same "offer nothing rather than the wrong
 * thing" answer this function already gives a kind whose script cannot be
 * parsed. /api/reroll-trait has no capability check of its own ahead of
 * this call (unlike /api/set-trait and /api/stage-trait), so this is the
 * only thing standing between a garbage-kind item and the NPC's reroll list.
 */
function rerollableFor(item) {
    const kind = kindFor(KINDS, item.kind);
    if (!kind) return [];
    const data = OVERRIDE_DATA_BY_KIND[kind.id];
    return hasRawTraits(item) ? data.rawRerollable : data.rerollable;
}

/**
 * The manifest's entries of one kind as they stand right now - each one's
 * folder path and id - or null if we could not read them. Taken either side
 * of a create job so the job can report what it actually produced rather
 * than what was asked for; see `job.produced` and `job.producedIds` below.
 * Generic over kind rather than hard-coded to 'npc': startCreateJob() passes
 * whichever kind it was asked to create, npc from the /api/create-npc alias
 * and any other registered kind from POST /api/create. loadManifest() re-reads
 * the file fresh (and treats a missing one as empty, so a first-ever run
 * snapshots nothing and still counts correctly); it only throws on a hard read
 * error, and a transient one of those inside a 'close' handler would be an
 * unhandled throw taking the server with it, so it is swallowed here into "we do
 * not know".
 *
 * The difference is taken over folders rather than ids, because counting ids
 * quietly mis-reports an entire class of run.
 * generate-npc.py mints an id of "npc-<slug>-<seed>", derived from the name and
 * the seed and nothing else, while npc_folder() suffixes a colliding folder to
 * "Name (2)" - and the GUI never passes --overwrite. So pinning a name and a
 * seed, generating, tweaking an override and generating again writes a second
 * folder and a second manifest entry under an id that is already in the
 * before-snapshot: a real NPC on disk, which an id count would put at zero and
 * the client would report as a run that detected nothing. The manifest is keyed
 * by folder path, so counting its keys counts the entries the run actually
 * added.
 *
 * The ids ride along beside the folders because a count on its own is not enough
 * for the client to act on. The banner raised over a finished run carries one
 * dismiss button, and dismissing it clears the New tag - which it may only do
 * for the NPCs that banner is announcing, so the run has to be able to name
 * them. See the comment on `job.producedIds`.
 */
function entriesSnapshot(kind) {
    try {
        return loadManifest()
            .filter((item) => (item.kind || 'npc') === kind)
            .map((item) => ({ folderPath: item.folderPath, id: item.id }));
    } catch {
        return null;
    }
}

/**
 * Spawns `kindEntry`'s generator to create new items of that kind. Shared by
 * the /api/create-npc alias (which always passes KINDS.npc) and the generic
 * POST /api/create - the two differ only in which registry entry and which
 * `opts` they hand over; the spawn, the job bookkeeping and the produced-count
 * snapshot are the same machinery for either kind.
 */
function startCreateJob(kindEntry, opts) {
    if (!fs.existsSync(kindEntry.script)) {
        return { ok: false, reason: `${path.basename(kindEntry.script)} not found at ${kindEntry.script}` };
    }

    const args = kindEntry.createArgs(opts);

    // Snapshot before the child can write anything. `produced` and
    // `producedIds` stay null until the run ends and, for a dry run or an
    // unreadable manifest, forever: null means "not measured", which the client
    // tells apart from a measured zero (and from a measured empty list).
    const entriesBefore = entriesSnapshot(kindEntry.id);
    const foldersBefore = entriesBefore && new Set(entriesBefore.map((entry) => entry.folderPath));

    const jobId = crypto.randomUUID();
    const job = {
        status: 'running', kind: kindEntry.id, dryRun: !!opts.dryRun, startedAt: Date.now(), log: '',
        produced: null, producedIds: null,
    };
    createJobs.set(jobId, job);

    let child;
    try {
        child = spawn(config.pythonExecutable, args, { cwd: path.dirname(kindEntry.script) });
    } catch (err) {
        job.status = 'error';
        job.error = err.message;
        return { ok: true, jobId };
    }

    const collect = (chunk) => { job.log = (job.log + chunk.toString()).slice(-CREATE_LOG_LIMIT); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => { job.status = 'error'; job.error = err.message; });
    child.on('close', (code) => {
        if (job.status === 'error') return; // already failed via the 'error' event above
        job.doneAt = Date.now();
        job.status = code === 0 ? 'done' : 'error';
        if (code !== 0) {
            job.error = job.log.trim() || `${path.basename(kindEntry.script)} exited with code ${code}`;
        }
        // Exit code 0 only means the script did not crash - it can and does
        // finish having written fewer entries than asked for, or none at all,
        // when ComfyUI drops a job or a per-NPC error is swallowed mid-batch.
        // Count the manifest entries that are new since the snapshot so the
        // client can say what landed instead of what was requested. Not for a
        // dry run: it writes no manifest entries, and the client ignores the
        // number anyway.
        if (job.status === 'done' && !job.dryRun && foldersBefore) {
            const entriesAfter = entriesSnapshot(kindEntry.id);
            const added = entriesAfter
                && entriesAfter.filter((entry) => !foldersBefore.has(entry.folderPath));
            job.produced = added ? added.length : null;
            // Which NPCs those were, not merely how many. The client raises one
            // banner over a finished run and offers one × to be rid of it, and
            // that × also clears the New tag - which it may only do for the
            // NPCs the banner is announcing. A library can hold NPCs rolled at
            // the command line while this server was down, which the seed-once
            // store keeps flagged across a reboot precisely so they can be
            // found later, and there is nothing in the UI able to re-flag one:
            // a banner promising one NPC must not take those with it. Naming
            // the run's own NPCs is what lets the client clear exactly those.
            // De-duplicated because the same-name-same-seed re-roll described
            // above writes two folders under one id.
            job.producedIds = added ? [...new Set(added.map((entry) => entry.id))] : null;
            // And un-see them, for that same collision. `produced` counts
            // folders, isNew asks about ids, so a second folder under an id the
            // user has already opened is counted by one and dismissed by the
            // other - announced as new by the banner and drawn as old by the
            // grid. See forgetSeen.
            if (job.producedIds) forgetSeen(job.producedIds);
        }
    });

    return { ok: true, jobId };
}

/**
 * The validation both create routes share: /api/create-npc (which always
 * calls this with KINDS.npc, ignoring whatever kind the body names) and the
 * generic POST /api/create (which resolves kindEntry from the request).
 * Every check and every message below is copied verbatim from the route
 * that used to be the whole of /api/create-npc, so the alias stays a
 * byte-for-byte match for what it always did; the only things new here are
 * the kind-registry lookups and the person-only-field refusals a non-npc
 * kind takes before ever reaching them.
 *
 * Returns `{ status, body }`, ready to hand straight to sendJson().
 */
function handleCreateRequest(kindEntry, body) {
    if (!kindEntry.supports.create) {
        return { status: 400, body: { error: `creating a ${kindEntry.subject} isn't supported yet` } };
    }

    const count = Number.isInteger(body.count) && body.count > 0 ? body.count : 1;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name && count !== 1) {
        return { status: 400, body: { error: '--name only makes sense with a single NPC' } };
    }
    let seed = null;
    if (body.seed !== null && body.seed !== undefined && body.seed !== '') {
        seed = Number(body.seed);
        if (!Number.isInteger(seed) || seed < 0) {
            return { status: 400, body: { error: 'seed must be a non-negative integer' } };
        }
    }
    const overrides = (Array.isArray(body.overrides) ? body.overrides : [])
        .filter((o) => o && o.table && String(o.value ?? '').trim())
        .map((o) => ({ table: String(o.table), value: String(o.value).trim() }));
    const overrideTablesForKind = OVERRIDE_DATA_BY_KIND[kindEntry.id].tables;
    const unknownTable = overrides.find((o) => !overrideTablesForKind.includes(o.table));
    if (unknownTable) return { status: 400, body: { error: `unknown table "${unknownTable.table}"` } };
    if (body.noPortrait && body.noToken) {
        return {
            status: 400,
            body: { error: '--no-portrait and --no-token together leave nothing to generate' },
        };
    }

    // Person-only fields. createArgs() would silently drop either on a kind
    // that never reads it, and a dropped field is a request that appeared to
    // work and did not - the ship path refuses them outright instead.
    if (kindEntry.id !== DEFAULT_KIND) {
        if (body.pronouns) {
            return { status: 400, body: { error: `pronouns are not a ${kindEntry.subject} field` } };
        }
        if (body.unarmed) {
            return { status: 400, body: { error: `unarmed is not a ${kindEntry.subject} field` } };
        }
    }

    let requestedPronouns = null;
    if (kindEntry.id === DEFAULT_KIND) {
        requestedPronouns = typeof body.pronouns === 'string' && body.pronouns ? body.pronouns : null;
        if (requestedPronouns) {
            let known = [];
            try {
                known = pronouns.subjectsFrom(fs.readFileSync(kindEntry.tables, 'utf8'));
            } catch { /* fall through - an unreadable tables file is its own error later */ }
            if (known.length && !known.includes(requestedPronouns)) {
                return {
                    status: 400,
                    body: { error: `unknown pronoun "${requestedPronouns}". Available: ${known.join(', ')}` },
                };
            }
        }
    }

    const result = startCreateJob(kindEntry, {
        count,
        seed,
        name: name || null,
        pronouns: requestedPronouns,
        overrides,
        noPortrait: !!body.noPortrait,
        noToken: !!body.noToken,
        keepRawToken: !!body.keepRawToken,
        unarmed: kindEntry.id === DEFAULT_KIND ? !!body.unarmed : false,
        server: typeof body.server === 'string' && body.server ? body.server : null,
        dryRun: !!body.dryRun,
        // Always passed, kind-independent: npc's createArgs never reads
        // either field (see lib/kinds.js), so supplying them here changes
        // nothing about the alias's argv - only the ship path's createArgs
        // uses them, for --manifest and --out-root.
        manifestPath: config.npcManifestPath,
        outputRoot: config.spaceshipOutputRoot || null,
    });
    return { status: result.ok ? 202 : 409, body: result };
}

/* ------------------------------------------------------------------ */
/* Trait candidates (trait-import skill staging)                       */
/* ------------------------------------------------------------------ */

/*
 * Every function in this block takes the kind registry entry first rather
 * than reading a module-level staging directory, for the reason lib/paths.js
 * makes the two directories siblings instead of nesting one inside the
 * other: listStagedFiles reads *.json at the TOP level of the directory it is
 * given, so a ship staging directory under the NPC one would have every ship
 * run swept into the NPC listing the moment it was written.
 *
 * A staged candidate's `table` only means something paired with the file it
 * came from. Both tables files carry a '## Backdrop', so a candidate for it
 * belongs to whichever kind's staging directory held the run - which is why
 * the kind travels with the file all the way down to insertBulletIntoTables
 * rather than being resolved once at the route and then forgotten.
 */

function listStagedFiles(kind) {
    try {
        return fs.readdirSync(kind.stagedImportsDir).filter((f) => f.endsWith('.json')).sort();
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
}

function loadStagedFile(kind, file) {
    return JSON.parse(fs.readFileSync(path.join(kind.stagedImportsDir, file), 'utf8'));
}

function saveStagedFile(kind, file, data) {
    fs.writeFileSync(path.join(kind.stagedImportsDir, file), JSON.stringify(data, null, 2));
}

/* What the detail sheet can show. An extension off this list is not served at
 * all rather than guessed at: refs/ holds whatever the skill found in the
 * reference directory, and handing a browser some other file's bytes under an
 * image Content-Type helps nobody. */
const REF_IMAGE_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
};

/**
 * The copied reference image for one staged run and source filename, or null.
 *
 * Both halves are single filenames by contract - the run is a *.json sitting
 * directly in the staging directory, and source_image is a bare filename the
 * skill verified against a real directory listing - so anything carrying a
 * separator, a '..' or a drive letter is refused outright rather than
 * normalised and hoped about. This server binds to 127.0.0.1, but it is the
 * one place that returns raw file bytes, which is worth being literal-minded
 * about.
 */
function refImagePath(kind, file, sourceImage) {
    if (!file || !sourceImage) return null;
    if (path.basename(file) !== file || !file.endsWith('.json')) return null;
    if (path.basename(sourceImage) !== sourceImage) return null;
    if (!REF_IMAGE_TYPES[path.extname(sourceImage).toLowerCase()]) return null;
    const full = path.join(kind.stagedRefsDir, path.basename(file, '.json'), sourceImage);
    return fs.existsSync(full) ? full : null;
}

/** Every candidate in one kind's staged-imports files, flattened for the GUI. */
function allTraitCandidates(kind) {
    const out = [];
    for (const file of listStagedFiles(kind)) {
        let data;
        try {
            data = loadStagedFile(kind, file);
        } catch (err) {
            console.warn(`[${PLUGIN_ID}] ${file} is not valid JSON:`, err.message);
            continue;
        }
        for (const entry of data.entries || []) {
            out.push({
                file,
                id: entry.id,
                table: entry.table,
                bullet: entry.bullet,
                sourceImage: entry.source_image,
                // Whether refs/ holds a copy of that image, so the detail
                // sheet knows to ask for one. Runs staged before the skill
                // started copying - and any run whose copy has since been
                // deleted - report false and fall back to naming the file.
                hasSourceImage: !!refImagePath(kind, file, entry.source_image),
                placementHint: entry.placement_hint,
                bookkeepingNote: entry.bookkeeping_note,
                notes: entry.notes,
                imported: !!entry.imported,
                importedAt: entry.imported_at || null,
                generatedAt: data.generated_at || null,
            });
        }
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* Trait roll odds                                                     */
/* ------------------------------------------------------------------ */

/**
 * The cached odds run per kind: kind id -> { key, promise }. Each kind has
 * its own tables file, its own script and its own run, so a single shared
 * slot would have an NPC page load and a ship page load evict each other's
 * cache every time the two are opened alternately - a Map keyed by kind id
 * is what keeps the two independent, the way readTraitChoices' cache already
 * keys wider than a single slot for the same reason.
 *
 * A promise rather than a resolved value, so that concurrent callers of the
 * same kind share one spawn instead of starting two six-second Python
 * processes - a page load and a weight edit landing together do exactly
 * that. Only the newest key per kind is kept.
 */
const oddsCacheByKind = new Map();

const ODDS_LOG_LIMIT = 4000; // chars of stderr kept for an error message

/**
 * Roll the odds for one kind, or hand back the run already in flight or
 * just finished.
 *
 * Resolves to `{ ok: true, samples, tables }` or `{ ok: false, reason }` and
 * never rejects. The percentages are advisory: someone running this GUI purely
 * to review staged imports needs no Python interpreter at all, and must not be
 * shown a broken Tables page because they haven't got one. The page falls back
 * to its own local estimate and says so.
 *
 * Cached against the tables file's mtime and size, which is the whole of the
 * reactivity story: every input to these numbers lives in that file, and every
 * way of changing one - a weight edit, a toggle, a preset apply, a trait
 * import - rewrites it through this same server. So one stat() invalidates the
 * cache for all four and no write path has to remember to do anything.
 */
function readTraitOdds(kindEntry) {
    let key;
    try {
        key = traitOdds.cacheKeyFor(fs.statSync(kindEntry.tables), kindEntry.id);
    } catch (err) {
        return Promise.resolve({ ok: false, reason: `cannot read ${kindEntry.tables}: ${err.message}` });
    }
    const cached = oddsCacheByKind.get(kindEntry.id);
    if (cached && cached.key === key) return cached.promise;

    const promise = runTraitOdds(kindEntry).then((result) => {
        // A failed run is not worth caching: the cause is usually something
        // the user can fix (install Python, correct a path) without touching
        // the tables file, and a cached failure would survive the fix.
        if (!result.ok && oddsCacheByKind.get(kindEntry.id)?.key === key) {
            oddsCacheByKind.delete(kindEntry.id);
        }
        return result;
    });
    oddsCacheByKind.set(kindEntry.id, { key, promise });
    return promise;
}

function runTraitOdds(kindEntry) {
    if (!fs.existsSync(kindEntry.script)) {
        return Promise.resolve({
            ok: false, reason: `${path.basename(kindEntry.script)} not found at ${kindEntry.script}`,
        });
    }

    let args;
    try {
        args = traitOdds.oddsArgs(kindEntry.script, config.traitOddsSamples);
    } catch (err) {
        return Promise.resolve({ ok: false, reason: err.message });
    }

    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(config.pythonExecutable, args, { cwd: path.dirname(kindEntry.script) });
        } catch (err) {
            return resolve({ ok: false, reason: `could not run ${config.pythonExecutable}: ${err.message}` });
        }

        let out = '';
        let errText = '';
        child.stdout.on('data', (chunk) => { out += chunk.toString(); });
        child.stderr.on('data', (chunk) => { errText = (errText + chunk.toString()).slice(-ODDS_LOG_LIMIT); });
        child.on('error', (err) => resolve({ ok: false, reason: `could not run ${config.pythonExecutable}: ${err.message}` }));
        child.on('close', (code) => {
            if (code !== 0) {
                return resolve({
                    ok: false,
                    reason: errText.trim()
                        || `${path.basename(kindEntry.script)} --trait-odds exited with code ${code}`,
                });
            }
            try {
                const { samples, tables } = traitOdds.parseOddsOutput(out);
                return resolve({ ok: true, samples, tables });
            } catch (err) {
                return resolve({ ok: false, reason: err.message });
            }
        });
    });
}

/**
 * "Which values could this trait take on this NPC", cached per (tables file,
 * NPC, trait).
 *
 * One map for every NPC and trait rather than the single slot the odds cache
 * uses, because the odds have exactly one answer at a time and this has one
 * per trait per NPC - a user clicking down a detail sheet asks a dozen
 * different questions in a minute. Bounded because of that, and none of the
 * answers is large.
 */
const CHOICES_CACHE_LIMIT = 64;
const choicesCache = new Map();

function readTraitChoices(item, trait) {
    const kindEntry = kindOf(KINDS, item);
    let key;
    try {
        key = traitChoices.cacheKeyFor(fs.statSync(kindEntry.tables), item, trait);
    } catch (err) {
        return Promise.resolve({ ok: false, reason: `cannot read ${kindEntry.tables}: ${err.message}` });
    }
    if (choicesCache.has(key)) return choicesCache.get(key);

    const promise = runTraitChoices(item, trait).then((result) => {
        // Same reasoning as the odds cache: a failure is usually something the
        // user can fix without touching the tables file (install Python,
        // correct a path), and a cached failure would outlive the fix.
        if (!result.ok) choicesCache.delete(key);
        return result;
    });
    choicesCache.set(key, promise);
    // Insertion-ordered, so the first key is the oldest.
    while (choicesCache.size > CHOICES_CACHE_LIMIT) {
        choicesCache.delete(choicesCache.keys().next().value);
    }
    return promise;
}

/**
 * Spawns `generate-npc.py --trait-choices` and hands back what it printed.
 *
 * Structured like runTraitOdds() rather than sharing an abstraction with it:
 * the argv, the parser and the error wording all differ, and what is left over
 * is a spawn guard and two stream handlers. Resolves
 * `{ ok: true, data: <parsed> }` - nested rather than spread, because the
 * payload's keys come from the generator and a spread would let a future key
 * named `ok` or `reason` collide with the envelope.
 */
function runTraitChoices(item, trait) {
    const kindEntry = kindOf(KINDS, item);
    if (!fs.existsSync(kindEntry.script)) {
        return Promise.resolve({
            ok: false, reason: `${path.basename(kindEntry.script)} not found at ${kindEntry.script}`,
        });
    }

    let args;
    try {
        args = traitChoices.choicesArgs(
            kindEntry.script, config.npcManifestPath, item.id, trait);
    } catch (err) {
        return Promise.resolve({ ok: false, reason: err.message });
    }

    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(config.pythonExecutable, args, { cwd: path.dirname(kindEntry.script) });
        } catch (err) {
            return resolve({ ok: false, reason: `could not run ${config.pythonExecutable}: ${err.message}` });
        }

        let out = '';
        let errText = '';
        child.stdout.on('data', (chunk) => { out += chunk.toString(); });
        child.stderr.on('data', (chunk) => { errText = (errText + chunk.toString()).slice(-ODDS_LOG_LIMIT); });
        child.on('error', (err) => resolve({ ok: false, reason: `could not run ${config.pythonExecutable}: ${err.message}` }));
        child.on('close', (code) => {
            if (code !== 0) {
                return resolve({
                    ok: false,
                    reason: errText.trim()
                        || `${path.basename(kindEntry.script)} --trait-choices exited with code ${code}`,
                });
            }
            try {
                return resolve({ ok: true, data: traitChoices.parseChoicesOutput(out) });
            } catch (err) {
                return resolve({ ok: false, reason: err.message });
            }
        });
    });
}

/**
 * Spawns `generate-npc.py --apply-only` and hands back what it printed.
 *
 * Structured like runTraitChoices() above, and for the same reason it is not
 * folded into startRegenJob(): this is not a job. It renders nothing, contacts
 * no ComfyUI server, finishes in about a second and answers the request that
 * started it, so the caller awaits a result rather than polling a map for a
 * status. What it leaves behind is a rewritten manifest entry.
 *
 * Two things it has that runTraitChoices does not:
 *
 *   - the `stagingItemIds` guard, added before the spawn and dropped on every
 *     resolve path, because this one WRITES the entry (see the set above);
 *   - a deadline, because the route is holding a response open on it.
 *
 * Resolves `{ ok: true, data: <parsed>, log: <stderr tail> }` - the log
 * included rather than discarded because the generator's cascade report ("with
 * Hair colour: 'x' -> 'y'") goes to stderr under --apply-only, and it is the
 * only place that says what else travelled with the trait the user clicked.
 */
function runApplyTrait(item, { op, table, value, release, seed }) {
    const kindEntry = kindOf(KINDS, item);
    if (!fs.existsSync(kindEntry.script)) {
        return Promise.resolve({
            ok: false, reason: `${path.basename(kindEntry.script)} not found at ${kindEntry.script}`,
        });
    }

    let args;
    try {
        args = applyTrait.applyArgs(
            kindEntry.script, config.npcManifestPath, item.id,
            { op, table, value, release, seed });
    } catch (err) {
        return Promise.resolve({ ok: false, reason: err.message });
    }

    stagingItemIds.add(item.id);
    return new Promise((resolve) => {
        let timer = null;
        let settled = false;
        // One funnel for every exit, so the guard cannot be left set by a race
        // between the deadline firing and the child closing.
        const settle = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            stagingItemIds.delete(item.id);
            resolve(result);
        };

        let child;
        try {
            child = spawn(config.pythonExecutable, args, { cwd: path.dirname(kindEntry.script) });
        } catch (err) {
            return settle({ ok: false, reason: `could not run ${config.pythonExecutable}: ${err.message}` });
        }

        let out = '';
        let errText = '';
        child.stdout.on('data', (chunk) => { out += chunk.toString(); });
        child.stderr.on('data', (chunk) => { errText = (errText + chunk.toString()).slice(-ODDS_LOG_LIMIT); });
        child.on('error', (err) => settle({ ok: false, reason: `could not run ${config.pythonExecutable}: ${err.message}` }));
        child.on('close', (code) => {
            if (code !== 0) {
                return settle({
                    ok: false,
                    reason: errText.trim()
                        || `${path.basename(kindEntry.script)} --apply-only exited with code ${code}`,
                });
            }
            try {
                return settle({ ok: true, data: applyTrait.parseApplyOutput(out), log: errText });
            } catch (err) {
                return settle({ ok: false, reason: err.message });
            }
        });

        timer = setTimeout(() => {
            child.kill();
            settle({
                ok: false,
                timedOut: true,
                reason: `generate-npc.py --apply-only did not finish within ${STAGE_TIMEOUT_MS / 1000}s`,
            });
        }, STAGE_TIMEOUT_MS);
    });
}

/**
 * Appends one bullet to `kind.tables` under its exact '## <table>' heading,
 * right before the next heading (or EOF) - i.e. as the new last bullet in
 * that section. A heading that doesn't exist yet is refused rather than
 * invented; deciding where a brand-new table belongs in the file is a
 * judgment call this shouldn't make silently.
 *
 * kind.tables rather than the NPC tables file it used to write
 * unconditionally. Both files carry a '## Backdrop', so a ship candidate for
 * it landed as a new NPC backdrop - and the kind the caller resolved is the
 * only thing that says which of the two a staged bullet was ever about.
 */
function insertBulletIntoTables(kind, table, bullet) {
    const tablesPath = kind.tables;
    const lines = fs.readFileSync(tablesPath, 'utf8').split('\n');
    const headingRe = /^##\s+(?!#)\s*(.*?)\s*$/;

    let sectionStart = -1;
    let sectionEnd = lines.length;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(headingRe);
        if (!m) continue;
        if (sectionStart === -1) {
            if (m[1] === table) sectionStart = i;
            continue;
        }
        sectionEnd = i;
        break;
    }
    if (sectionStart === -1) {
        throw new Error(`no "## ${table}" heading in ${path.basename(tablesPath)} - add the heading by hand first`);
    }

    // Walk sectionEnd back past trailing blank lines, so the new bullet lands
    // directly after the section's last bullet rather than after a gap.
    let insertAt = sectionEnd;
    while (insertAt > sectionStart + 1 && lines[insertAt - 1].trim() === '') insertAt--;

    lines.splice(insertAt, 0, `- ${bullet}`);
    fs.writeFileSync(tablesPath, lines.join('\n'));
}

/* ------------------------------------------------------------------ */
/* Ship catalogue                                                      */
/* ------------------------------------------------------------------ */

/**
 * generate-spaceship.py --ship-catalogue - the ship types, size bands and
 * themes the Create Spaceship form needs to build its own controls, printed
 * as JSON and handed straight through (see the route below: no reshaping
 * happens here, deliberately - `sizes` prints as an array, not the map an
 * earlier design predicted, and passing it through unchanged lets the
 * client index it however it needs to rather than this server guessing).
 *
 * Cached by the script's own mtime, not a poll interval: the catalogue is
 * static data compiled into the generator, so nothing about it changes
 * except a new build of the script itself, and a stat is cheap enough to
 * check on every request.
 */
let shipCatalogueCache = null;

function readShipCatalogue() {
    const kind = KINDS.spaceship;
    let mtimeMs;
    try {
        ({ mtimeMs } = fs.statSync(kind.script));
    } catch (err) {
        return Promise.resolve({
            ok: false, reason: `${path.basename(kind.script)} not found at ${kind.script}`,
        });
    }
    if (shipCatalogueCache && shipCatalogueCache.key === mtimeMs) return shipCatalogueCache.promise;

    const promise = new Promise((resolve) => {
        let child;
        try {
            child = spawn(config.pythonExecutable, [kind.script, '--ship-catalogue'],
                { cwd: path.dirname(kind.script) });
        } catch (err) {
            return resolve({ ok: false, reason: `could not run ${config.pythonExecutable}: ${err.message}` });
        }

        let out = '';
        let errText = '';
        child.stdout.on('data', (chunk) => { out += chunk.toString(); });
        child.stderr.on('data', (chunk) => { errText = (errText + chunk.toString()).slice(-ODDS_LOG_LIMIT); });
        child.on('error', (err) => resolve({ ok: false, reason: `could not run ${config.pythonExecutable}: ${err.message}` }));
        child.on('close', (code) => {
            if (code !== 0) {
                return resolve({
                    ok: false,
                    reason: errText.trim()
                        || `${path.basename(kind.script)} --ship-catalogue exited with code ${code}`,
                });
            }
            try {
                return resolve({ ok: true, data: JSON.parse(out) });
            } catch (err) {
                return resolve({
                    ok: false,
                    reason: `could not parse --ship-catalogue output as JSON (${err.message})`,
                });
            }
        });
    }).then((result) => {
        // Same reasoning as the odds cache: a failure is usually something
        // the user can fix without a script rebuild, and a cached failure
        // would outlive the fix.
        if (!result.ok && shipCatalogueCache && shipCatalogueCache.key === mtimeMs) shipCatalogueCache = null;
        return result;
    });
    shipCatalogueCache = { key: mtimeMs, promise };
    return promise;
}

/* ------------------------------------------------------------------ */
/* HTTP plumbing                                                       */
/* ------------------------------------------------------------------ */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Import-Gui-Key',
    'Access-Control-Max-Age': '86400',
};

function sendJson(res, status, body, extraHeaders = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        ...extraHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
}

function readBody(req, limitBytes = 2 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limitBytes) {
                reject(new Error('payload too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function authorised(req, url) {
    if (!config.secret) return true;
    const provided = req.headers['x-import-gui-key'] ?? url.searchParams.get('key');
    return provided === config.secret;
}

/* ---- item view for the GUI ---- */

function itemView(item) {
    const job = jobsByItemId.get(item.id);
    const regenJob = regenJobsByItemId.get(item.id);
    const model3dJob = model3dJobsByItemId.get(item.id);
    const animateJob = animateJobsByItemId.get(item.id);
    const imported = importedIndex.get(item.id) || null;
    const portraitFile = itemFile(item, 'portrait');
    const tokenFile = itemFile(item, 'token');
    // One stat, not a sidecar read: the grid needs "is there a loop" and the
    // sheet asks /api/animation for the rest, the way the 3D panel does.
    const animationVersion = animationSupported(item) && item.folderPath
        ? fileVersion(animationPaths(item).webp) : null;
    return {
        id: item.id,
        kind: item.kind,
        name: item.name,
        callsign: item.callsign,
        traits: item.traits || {},
        // Only populated for kinds generate-npc.py's manifest records a seed
        // for - the GUI uses its presence to decide whether to offer Regenerate.
        seed: typeof item.seed === 'number' ? item.seed : null,
        // generate-npc.py sorts each NPC into <root>/<Role category>/<Name>/ based on
        // its rolled Role (see ROLE_CATEGORIES there) - the category itself isn't
        // duplicated into traits, so recover it from the folder it landed in.
        roleCategory: item.kind === 'npc' && item.folderPath
            ? path.basename(path.dirname(item.folderPath))
            : null,
        when: item.when,
        importable: isImportable(item),
        imported: !!imported,
        // Absent from the seen store, i.e. generated since the user last
        // opened this one - see the seen index above for why that is a set
        // membership test and emphatically not a comparison against `when`.
        // Reported honestly even for an imported item; the grid is what
        // decides not to draw a New pill on a card it has already dimmed.
        isNew: !isSeen(item.id),
        // Which of the generator's two re-rollable lists applies to this NPC -
        // see hasRawTraits above. The boolean and not the bullets: they run to
        // kilobytes per entry, the grid polls every item every two seconds, and
        // the importer contract deliberately never exposes trait text.
        hasRawTraits: hasRawTraits(item),
        importedActorUuid: imported?.actorUuid ?? null,
        importedAt: imported?.importedAt ?? null,
        jobStatus: job ? job.status : null,
        jobError: job?.error ?? null,
        regenStatus: regenJob ? regenJob.status : null,
        regenError: regenJob?.status === 'error' ? regenJob.error : null,
        // One existsSync, not a readdir - see read3dFolder for why the file
        // list lives on /api/model-3d instead. This drives the grid badge and
        // whether the panel's button reads "Create" or "Rebuild".
        has3d: fs.existsSync(model3dDir(item)),
        model3dStatus: model3dJob ? model3dJob.status : null,
        model3dError: model3dJob?.status === 'error' ? model3dJob.error : null,
        hasAnimation: animationVersion !== null,
        animationUrl: animationVersion !== null
            ? `/api/animation-image?id=${encodeURIComponent(item.id)}&v=${animationVersion}`
            : null,
        animationStatus: animateJob ? animateJob.status : null,
        animationError: animateJob?.status === 'error' ? animateJob.error : null,
        // Where the art actually sits on disk. The browser is served
        // /api/image URLs and cannot resolve a local path, so this is text for
        // the user to read and copy - it is how they find the source files
        // outside this page at all. Re-derived from the manifest key on every
        // poll rather than remembered: importing an NPC copies its files under
        // foundryDataRoot and repoints that key (see copyIntoFoundry), so a
        // captured path would start lying the moment the user imported. The
        // filenames come with it because the folder holds both, and naming
        // them beats repeating an 80-character prefix twice.
        //
        // Not part of the /importer/* contract, which carries Data-relative
        // paths Foundry can serve and no absolute ones.
        folderPath: item.folderPath || null,
        portraitFile: item.portrait || null,
        tokenFile: item.token || null,
        portraitUrl: item.portrait
            ? `/api/image?id=${encodeURIComponent(item.id)}&which=portrait&v=${fileVersion(portraitFile)}`
            : null,
        tokenUrl: item.token
            ? `/api/image?id=${encodeURIComponent(item.id)}&which=token&v=${fileVersion(tokenFile)}`
            : null,
        // Full assembled prompt text, saved alongside the individual rolled traits -
        // only present for entries written by a generate-npc.py new enough to record it.
        portraitPrompt: item.portraitPrompt || null,
        tokenPrompt: item.tokenPrompt || null,
        // generate-npc.py --apply-only sets this when a trait edit lands
        // without a render, and clears it on the next real render. The traits
        // and prompts above therefore describe the NPC; the images may not.
        // Coerced rather than passed through: the client reads it directly as
        // `hidden = !item.artStale` and as a badge arm, and an entry written
        // before the marker existed has to answer false rather than undefined.
        artStale: !!item.artStale,
        // What this item's kind can do - regen, setTrait, model3d and so on.
        // Read from the registry rather than inlined per-route, so a route
        // that wants to know whether to offer a button asks this instead of
        // adding another `item.kind === 'npc'` branch next to roleCategory's.
        supports: kindOf(KINDS, item).supports,
        // Grid units, NOT pixels. The manifest's tokenWidth/tokenHeight are
        // the rendered canvas in pixels; gridWidth/gridHeight are the hex
        // count Foundry sets token.width from. Confusing the two draws a
        // cruiser 1728 hexes wide.
        tokenHexes: Number.isInteger(item.gridWidth)
            ? { w: item.gridWidth, h: item.gridHeight ?? item.gridWidth }
            : null,
    };
}

/* ---- routing ---- */

const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    // No '..' segments - this only ever serves the fixed files this repo ships.
    if (rel.includes('..')) return sendJson(res, 400, { error: 'bad path' });
    const file = path.join(PUBLIC_DIR, rel);
    const type = STATIC_TYPES[path.extname(file)];
    if (!type || !fs.existsSync(file)) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    fs.createReadStream(file).pipe(res);
}

/**
 * A slug off a query string or a request body, or null when it must not be
 * allowed to reach path.join.
 *
 * The Create preset routes turn a slug straight into a filename, and the export
 * route additionally spells it into a Content-Disposition header, so an
 * unchecked slug is two holes at once: `../../../etc/passwd` reads any file on
 * the box that happens to parse as JSON, and a slug carrying a CR/LF injects
 * whatever headers it likes into that response.
 *
 * A whitelist rather than a hunt for '..' and separators, because slugify()
 * only ever emits lowercase letters, digits and hyphens - anything outside that
 * alphabet cannot have come from the save route, so refusing it outright costs
 * nothing and leaves no second encoding (%2e%2e, backslashes on Windows,
 * unicode lookalikes) to have to reason about later.
 */
function safeSlug(value) {
    if (typeof value !== 'string' || !value) return null;
    return /^[a-z0-9][a-z0-9-]*$/.test(value) ? value : null;
}

async function handleApi(req, res, url) {
    if (url.pathname === '/api/categories' && req.method === 'GET') {
        const byKind = new Map();
        for (const item of loadManifest()) {
            byKind.set(item.kind, (byKind.get(item.kind) || 0) + 1);
        }
        const categories = [...byKind.entries()].map(([id, count]) => {
            // Same fallback as the rest of the registry lookups: an id the
            // manifest actually holds is always 'npc' or 'spaceship' today,
            // but a garbage or missing kind must still resolve to something
            // rather than sending the client a category row with an
            // undefined label.
            const entry = kindFor(KINDS, id) || kindFor(KINDS, DEFAULT_KIND);
            return { id, count, label: entry.label };
        });
        // Which kinds this install can actually GENERATE, which is a different
        // question from which ones the manifest already holds - a fresh
        // install with generate-spaceship.py present has ships available and
        // no Spaceships category, and that is exactly the case the Create
        // Spaceship tab has to appear for. So it rides alongside `categories`
        // rather than filtering it: the grid's rows stay manifest-derived,
        // because hiding a category would hide content the user already has.
        //
        // available() reads the filesystem (two existsSync calls), which is
        // why it is answered per request rather than frozen at boot: dropping
        // generate-spaceship.py into place should not need a server restart to
        // be noticed, and this route is fetched once at page load, not polled.
        // After the manifest rows, and on the same terms as them: a folder
        // with stills in it is content the user already has, and stays listed
        // even when the render script has gone; an empty folder is listed only
        // while the tab that fills it is on offer, so a fresh install with the
        // feature sees where its renders will land and one without it sees
        // nothing about backgrounds at all.
        const backgroundCount = walkBackgrounds().length;
        if (backgroundCount > 0 || backgroundsAvailable()) {
            categories.push({ id: BACKGROUND_KIND, count: backgroundCount, label: BACKGROUND_LABEL });
        }
        return sendJson(res, 200, {
            categories,
            kinds: Object.keys(available(KINDS)),
            // Features are what kinds cannot be. A background has no manifest
            // entry, no traits and no registry row, so it cannot ride `kinds`
            // - but the question the client is asking is the same one, and so
            // is the per-request filesystem check that answers it.
            features: backgroundsAvailable() ? ['backgrounds'] : [],
        });
    }

    if (url.pathname === '/api/items' && req.method === 'GET') {
        const category = url.searchParams.get('category');
        if (!category) return sendJson(res, 400, { error: 'category is required' });
        if (category === BACKGROUND_KIND) {
            const items = walkBackgrounds().map(backgroundGridItem).filter(Boolean)
                .sort((a, b) => a.name.localeCompare(b.name));
            return sendJson(res, 200, { items });
        }
        const items = loadManifest()
            .filter((item) => item.kind === category)
            .map(itemView)
            .sort((a, b) => a.name.localeCompare(b.name));
        return sendJson(res, 200, { items });
    }

    if (url.pathname === '/api/unseen' && req.method === 'GET') {
        // Across every kind, deliberately, and not derived from whatever
        // /api/items last returned - which only ever holds the one category
        // the grid happens to be showing. Nothing in public/ calls this: the
        // page learns newness from the `isNew` on each item view it already
        // polls for. It is here for anything outside the bundled client that
        // wants the one-line answer, a shell script asking "is there anything
        // I have not looked at" being the obvious one.
        const ids = unseenIds();
        return sendJson(res, 200, { count: ids.length, ids });
    }

    if (url.pathname === '/api/seen' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        // `ids` is what the page posts, from the detail overlay one at a time
        // and from the batch banner a finished run's worth at once. `all` marks
        // the entire library and has no caller in public/, deliberately: the
        // banner names the ids of the run it is announcing, because a banner
        // that says "1 new NPC" must not clear the tag on every unlooked-at
        // NPC in the library. `all` stays because "I have looked at all of
        // this" is a coherent thing to ask of a library and there is no other
        // way to say it - but it wants a control that admits to its scope
        // before anything in the page reaches for it.
        //
        // A body that is neither is a 400 rather than a silently successful
        // no-op, so a client bug shows up as a client bug.
        if (body.all === true) {
            markAllSeen();
        } else if (Array.isArray(body.ids) && body.ids.every((id) => typeof id === 'string')) {
            markSeen(body.ids);
        } else {
            return sendJson(res, 400, { error: 'ids must be an array of item ids, or pass all: true' });
        }
        return sendJson(res, 200, { ok: true, unseen: unseenIds().length });
    }

    if (url.pathname === '/api/image' && req.method === 'GET') {
        const id = url.searchParams.get('id');
        const which = url.searchParams.get('which');
        const item = id && findItem(id);
        if (!item) return sendJson(res, 404, { error: 'unknown item' });
        const file = itemFile(item, which);
        if (!file || !fs.existsSync(file)) return sendJson(res, 404, { error: 'no such image' });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
        return;
    }

    if (url.pathname === '/api/import' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const ids = Array.isArray(body.ids) ? body.ids : [];
        const force = !!body.force;
        const results = ids.map((id) => {
            let item = findItem(id);
            if (!item) return { id, queued: false, reason: 'unknown item' };
            if (!isImportable(item)) return { id, queued: false, reason: 'source files missing on disk' };
            if (!isUnderFoundryRoot(item)) {
                const regenJob = regenJobsByItemId.get(item.id);
                if (regenJob?.status === 'running') {
                    return { id, queued: false, reason: 'art is regenerating - try again once it finishes' };
                }
                try {
                    copyIntoFoundry(item);
                } catch (err) {
                    return { id, queued: false, reason: `couldn't copy into Foundry: ${err.message}` };
                }
                item = findItem(id); // re-read: copyIntoFoundry() moved its manifest entry
            }
            return { id, ...queueImport(item, { force }) };
        });
        return sendJson(res, 200, { results });
    }

    if (url.pathname === '/api/delete' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const ids = Array.isArray(body.ids) ? body.ids : [];
        const results = ids.map((id) => {
            const rel = backgrounds.relOf(id);
            if (rel !== null) {
                // The same guards /api/backgrounds/image applies before it
                // opens anything: inside the folder, and a file rather than a
                // directory that happens to end in .png.
                const still = backgrounds.resolveInside(BACKGROUNDS_DIR, rel);
                let isFile = false;
                try {
                    isFile = !!still && fs.statSync(still).isFile();
                } catch { /* not there: the same 'unknown item' as a stale manifest id */ }
                if (!isFile) return { id, deleted: false, reason: 'unknown item' };
                const jobId = backgroundAnimateByRel.get(rel);
                const job = jobId ? backgroundJobs.get(jobId) : null;
                if (job?.status === 'running') {
                    return { id, deleted: false, reason: 'a loop is being made from it - try again once it finishes' };
                }
                try {
                    deleteBackground(rel, still);
                } catch (err) {
                    return { id, deleted: false, reason: err.message };
                }
                return { id, deleted: true };
            }
            const item = findItem(id);
            if (!item) return { id, deleted: false, reason: 'unknown item' };
            const job = jobsByItemId.get(id);
            if (job && (job.status === 'queued' || job.status === 'sent')) {
                return { id, deleted: false, reason: 'import is in progress - wait for it to finish or fail first' };
            }
            const regenJob = regenJobsByItemId.get(id);
            if (regenJob?.status === 'running') {
                return { id, deleted: false, reason: 'art is regenerating - try again once it finishes' };
            }
            try {
                deleteItem(item);
            } catch (err) {
                return { id, deleted: false, reason: err.message };
            }
            return { id, deleted: true };
        });
        return sendJson(res, 200, { results });
    }

    if (url.pathname === '/api/regenerate' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const item = body.id && findItem(body.id);
        if (!item) return sendJson(res, 404, { error: 'unknown item' });

        const which = ['portrait', 'token', 'both'].includes(body.which) ? body.which : 'both';
        const seedMode = ['same', 'specific', 'random'].includes(body.seedMode) ? body.seedMode : 'same';
        let seed;
        if (seedMode === 'specific') {
            seed = Number(body.seed);
            if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32 - 1) {
                return sendJson(res, 400, { error: 'seed must be an integer between 0 and 4294967295' });
            }
        }

        const result = startRegenJob(item, { which, seedMode, seed });
        return sendJson(res, result.ok ? 202 : 409, result);
    }

    if (url.pathname === '/api/model-3d' && req.method === 'GET') {
        const item = url.searchParams.get('id') && findItem(url.searchParams.get('id'));
        if (!item) return sendJson(res, 404, { error: 'unknown item' });
        // Same refusal startModel3dJob's POST handler always gave a ship,
        // just read off the registry's capability flag instead of a second
        // `item.kind !== 'npc'` - so the GET side of the panel agrees with
        // the POST side about what a kind supports without repeating the check.
        if (!kindOf(KINDS, item).supports.model3d) {
            return sendJson(res, 400, {
                error: `building a 3D model isn't supported for kind "${item.kind}" yet`,
            });
        }
        return sendJson(res, 200, model3dView(item));
    }

    if (url.pathname === '/api/model-3d' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const item = body.id && findItem(body.id);
        if (!item) return sendJson(res, 404, { error: 'unknown item' });

        const result = startModel3dJob(item, { rig: !!body.rig, overwrite: !!body.overwrite });
        return sendJson(res, result.ok ? 202 : result.status, result);
    }

    if (url.pathname === '/api/animation' && req.method === 'GET') {
        const item = url.searchParams.get('id') && findItem(url.searchParams.get('id'));
        if (!item) return sendJson(res, 404, { error: 'unknown item' });
        return sendJson(res, 200, animationView(item));
    }

    if (url.pathname === '/api/animation' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const item = body.id && findItem(body.id);
        if (!item) return sendJson(res, 404, { error: 'unknown item' });

        // The same three modes and the same validation as /api/regenerate.
        const seedMode = ['same', 'specific', 'random'].includes(body.seedMode) ? body.seedMode : 'same';
        let seed;
        if (seedMode === 'specific') {
            seed = Number(body.seed);
            if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32 - 1) {
                return sendJson(res, 400, { error: 'seed must be an integer between 0 and 4294967295' });
            }
        }
        // Opt-out only, as /api/backgrounds/animate reads it: absent is on.
        const result = startAnimateJob(item, { seedMode, seed, pingpong: body.pingpong !== false });
        return sendJson(res, result.ok ? 202 : result.status, result);
    }

    if (url.pathname === '/api/animation/description' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const item = body.id && findItem(body.id);
        if (!item) return sendJson(res, 404, { error: 'unknown item' });
        const op = body.op === 'reroll' || body.op === 'set' ? body.op : null;
        if (!op) return sendJson(res, 400, { error: 'op must be "reroll" or "set"' });
        const value = typeof body.value === 'string' ? body.value : '';
        if (op === 'set' && !value) return sendJson(res, 400, { error: 'value is required to set a description' });
        const result = stageAnimationDescription(item, { op, value });
        if (!result.ok) return sendJson(res, result.status, { error: result.error });
        return sendJson(res, 200, animationView(item));
    }

    if (url.pathname === '/api/animation-image' && req.method === 'GET') {
        const item = url.searchParams.get('id') && findItem(url.searchParams.get('id'));
        if (!item) return sendJson(res, 404, { error: 'unknown item' });
        if (!animationSupported(item)) return sendJson(res, 404, { error: 'no such image' });
        const file = animationPaths(item).webp;
        if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'no such image' });
        res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
        return;
    }

    if (url.pathname === '/api/backgrounds' && req.method === 'GET') {
        const missing = backgroundsMissing();
        if (missing.length) {
            // Answered rather than 404'd, so the client can say which piece is
            // missing instead of showing an empty tab with no explanation.
            return sendJson(res, 200, {
                available: false, missing, dir: BACKGROUNDS_DIR,
                sillyTavern: { available: false, dir: SILLYTAVERN_BACKGROUNDS_DIR },
                catalogues: [], motionPrompts: [], items: [],
            });
        }
        const files = backgroundCatalogueFiles();
        const entries = await Promise.all(files.map((file) => readCatalogueEntries(file)));
        return sendJson(res, 200, {
            available: true,
            missing: [],
            dir: BACKGROUNDS_DIR,
            // Whether "Import into SillyTavern" has somewhere to copy to.
            // Why not is left to the import route's own error, which is the
            // one place the answer is acted on.
            sillyTavern: { available: sillyTavernUnavailable() === null, dir: SILLYTAVERN_BACKGROUNDS_DIR },
            catalogues: files.map((file, i) => ({
                file, label: backgrounds.catalogueLabel(file), entries: entries[i],
            })),
            motionPrompts: backgroundMotionPrompts(),
            items: walkBackgrounds()
                .map((rel) => backgroundItemView(rel))
                .filter(Boolean)
                .sort((a, b) => b.mtime - a.mtime),
        });
    }

    if (url.pathname === '/api/backgrounds/image' && req.method === 'GET') {
        const file = backgrounds.resolveInside(BACKGROUNDS_DIR, url.searchParams.get('rel'));
        if (!file) return sendJson(res, 400, { error: 'rel must be a path inside the backgrounds folder' });
        const type = BACKGROUND_CONTENT_TYPES[path.extname(file).toLowerCase()];
        // existsSync alone is true for a directory too - backgroundsDir is a
        // folder the GM owns by hand, so a directory that happens to end in
        // .png is not exotic. isFile() is what a stream can actually open.
        let isFile = false;
        try {
            isFile = fs.statSync(file).isFile();
        } catch { /* not there, which is the same 404 as before */ }
        if (!type || !isFile) return sendJson(res, 404, { error: 'no such image' });
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        // A directory would still make createReadStream emit EISDIR even
        // after the isFile() check above lost a race with something deleting
        // and recreating the path; pipe() does not forward stream errors, and
        // nothing here installs an uncaughtException handler, so this stream
        // must catch its own.
        fs.createReadStream(file)
            .on('error', () => res.destroy())
            .pipe(res);
        return;
    }

    if (url.pathname === '/api/backgrounds/render' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }

        const catalogue = typeof body.catalogue === 'string' ? body.catalogue : '';
        if (!backgroundCatalogueFiles().includes(catalogue)) {
            return sendJson(res, 400, { error: `unknown catalogue "${catalogue}"` });
        }

        // Checked here too, not only inside startBackgroundRenderJob: without
        // the script, readCatalogueEntries' spawn cannot produce the entry
        // list below, and "unknown entry" would shadow the real problem.
        if (!fs.existsSync(GENERATE_ART_SCRIPT)) {
            return sendJson(res, 400, { error: `generate-art.py not found at ${GENERATE_ART_SCRIPT}` });
        }

        const variants = body.variants === undefined || body.variants === null
            ? 1 : Number(body.variants);
        if (!Number.isInteger(variants) || variants < 1 || variants > 8) {
            return sendJson(res, 400, { error: 'variants must be an integer between 1 and 8' });
        }

        const width = body.width === undefined || body.width === null ? 1920 : Number(body.width);
        const height = body.height === undefined || body.height === null ? 1080 : Number(body.height);
        if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
            return sendJson(res, 400, { error: 'width and height must be positive integers' });
        }

        // Two seed modes, not the three /api/regenerate has: a still is
        // rendered, never regenerated in place, so there is no previous seed
        // for "same" to mean. null omits the flag and the script rolls its own.
        let seed = null;
        if (body.seed !== null && body.seed !== undefined && body.seed !== '') {
            seed = Number(body.seed);
            // The same cap /api/backgrounds/animate and /api/animation
            // enforce: Number.isInteger(1e21) is true, but String(1e21) is
            // "1e+21", which argparse's int() rejects on the Python side, so
            // an unbounded seed turns into a crash instead of this 400.
            if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32 - 1) {
                return sendJson(res, 400, { error: 'seed must be an integer between 0 and 4294967295, or null' });
            }
        }

        // The prefix is checked against the script's own --list, which is the
        // only list that agrees with what --filter can select.
        const entries = await readCatalogueEntries(catalogue);
        const prefix = typeof body.prefix === 'string' ? body.prefix : '';
        if (!entries.some((entry) => entry.prefix === prefix)) {
            return sendJson(res, 400, { error: `unknown entry "${prefix}" in ${catalogue}` });
        }

        const result = startBackgroundRenderJob({
            catalogue, prefix, variants, seed, width, height,
            animateWhenDone: body.animateWhenDone ? { pingpong: body.pingpong !== false } : null,
        });
        return sendJson(res, result.ok ? 202 : result.status, result);
    }

    if (url.pathname === '/api/backgrounds/animate' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }

        // Coerced, not refused, exactly as /api/regenerate and /api/animation
        // treat an unrecognised mode - one rule for seed modes across the file.
        const seedMode = ['same', 'specific', 'random'].includes(body.seedMode) ? body.seedMode : 'same';
        let seed;
        if (seedMode === 'specific') {
            seed = Number(body.seed);
            if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32 - 1) {
                return sendJson(res, 400, { error: 'seed must be an integer between 0 and 4294967295' });
            }
        }

        const result = startBackgroundAnimateJob({
            rel: typeof body.rel === 'string' ? body.rel : '',
            description: typeof body.description === 'string' ? body.description.trim() : '',
            seedMode,
            seed,
            pingpong: body.pingpong !== false,
        });
        return sendJson(res, result.ok ? 202 : result.status, result);
    }

    if (url.pathname === '/api/backgrounds/import' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const result = importBackgroundToSillyTavern(typeof body.rel === 'string' ? body.rel : '');
        return sendJson(res, result.ok ? 200 : result.status, result);
    }

    if (url.pathname === '/api/backgrounds/status' && req.method === 'GET') {
        const jobId = url.searchParams.get('jobId');
        const job = jobId && backgroundJobs.get(jobId);
        if (!job) return sendJson(res, 404, { error: 'unknown job' });
        return sendJson(res, 200, {
            status: job.status,
            kind: job.kind,
            rel: job.rel ?? null,
            log: job.log,
            error: job.error ?? null,
            // How many stills landed, or null when it was not measured (still
            // going, or the run failed). Told apart from a measured zero.
            produced: job.produced ?? null,
            // The Import tab ids of those stills, null on the same terms.
            producedIds: job.producedIds ?? null,
            // The animate jobs this render started, each watched separately so
            // a failed loop is visible as itself rather than retroactively
            // failing a render that did produce a still.
            chain: job.chain ?? [],
            chainError: job.chainError ?? null,
        });
    }

    if (url.pathname === '/api/model-3d-image' && req.method === 'GET') {
        const item = url.searchParams.get('id') && findItem(url.searchParams.get('id'));
        if (!item) return sendJson(res, 404, { error: 'unknown item' });
        const file = url.searchParams.get('file');
        const refusal = model3dFileError(item, file);
        if (refusal) return sendJson(res, refusal.status, { error: refusal.error });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        fs.createReadStream(path.join(model3dDir(item), file)).pipe(res);
        return;
    }

    if (url.pathname === '/api/npc-tables' && req.method === 'GET') {
        // Route name kept as-is even though it now answers for any kind: a
        // cached older page still calls it, and renaming buys nothing over
        // just letting ?kind= default to npc the way every route here does.
        const kind = resolveKind(url, null);
        if (!kind) {
            return sendJson(res, 400, { error: `unknown kind "${url.searchParams.get('kind')}"` });
        }
        const data = OVERRIDE_DATA_BY_KIND[kind.id];
        // Both lists, because which one applies is a property of the item
        // rather than of the server - the client pairs them with each item's
        // hasRawTraits. `rerollable` keeps its name and its legacy meaning so
        // an older page served from a cache still works, just narrowly.
        //
        // `dependents` is the generator's cascade map, sent as its direct edges
        // rather than as a closure per trait: the closure is four lines in the
        // client and the edges are what the file actually says, so a shape sent
        // here can never be a stale flattening of one. The client warns before
        // a re-roll that reaches past its own trait, and names the traits it
        // reaches - neither of which it could do from the two lists alone.
        return sendJson(res, 200, {
            tables: data.tables,
            rerollable: data.rerollable,
            rawRerollable: data.rawRerollable,
            dependents: data.dependents,
        });
    }

    // Re-roll a trait AND re-render, in one 202'd job. The page's own buttons
    // now stage the edit instead (POST /api/stage-trait below) and leave the
    // rendering to Regenerate, so this is the one-shot equivalent: kept whole
    // because a browser tab served before that change still calls it, and
    // because "do the lot" is the right shape for a script.
    if (url.pathname === '/api/reroll-trait' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const item = body.id && findItem(body.id);
        if (!item) return sendJson(res, 404, { error: 'unknown item' });

        const table = typeof body.table === 'string' ? body.table : '';
        if (!table) return sendJson(res, 400, { error: 'table is required' });
        // The list this NPC gets, chosen the same way reroll_trait() chooses
        // it, so the refusal here can never disagree with the one the
        // generator would give a moment later.
        const allowed = rerollableFor(item);
        if (allowed.length && !allowed.includes(table)) {
            // Refused here as well as in the generator, so the UI gets a clean
            // 400 rather than a spawned process that exits with a message.
            // The generator stays the authority on the reason.
            //
            // The set named is the one that applies to THIS entry, never the
            // shorter one by default: printing the legacy eleven to the owner
            // of an NPC that can re-roll twenty-two would be a lie about their
            // own NPC, and it is the exact lie generate-npc.py refuses to tell
            // in the matching refusal.
            return sendJson(res, 400, {
                error: `"${table}" cannot be re-rolled on its own. Re-rollable: `
                    + allowed.join(', '),
            });
        }

        // Always a fresh seed: re-rolling a trait produces a different
        // character detail, so there is nothing to reproduce, and the
        // generator draws the new value from this same seed.
        const result = startRegenJob(item, {
            which: 'both', seedMode: 'random', rerollTrait: table,
        });
        return sendJson(res, result.ok ? 202 : 409, result);
    }

    // Pin a trait AND re-render, in one 202'd job - the counterpart of
    // /api/reroll-trait above, kept for the same two reasons.
    if (url.pathname === '/api/set-trait' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const item = body.id && findItem(body.id);
        if (!item) return sendJson(res, 404, { error: 'unknown item' });
        // kindFor(), not kindOf(): an item whose kind is not in the registry
        // at all must be refused rather than quietly treated as npc - see
        // the matching comment on startRegenJob. A spaceship's
        // supports.setTrait is true, so this only refuses a kind that
        // genuinely does not offer it (or names none the registry knows).
        const itemKind = kindFor(KINDS, item.kind);
        if (!itemKind || !itemKind.supports.setTrait) {
            return sendJson(res, 400, {
                error: `setting a trait isn't supported for kind "${item.kind}" yet`,
            });
        }
        if (!hasRawTraits(item)) {
            return sendJson(res, 400, {
                error: 'this NPC recorded no raw bullets, so there is nothing to '
                    + 'pin the rest of it to. Re-roll the NPC to record them.',
            });
        }

        const table = typeof body.table === 'string' ? body.table : '';
        const value = typeof body.value === 'string' ? body.value : '';
        if (!table || !value) return sendJson(res, 400, { error: 'table and value are required' });

        const allowed = rerollableFor(item);
        if (allowed.length && !allowed.includes(table)) {
            return sendJson(res, 400, {
                error: `"${table}" cannot be set on its own. Settable: ${allowed.join(', ')}`,
            });
        }

        // Re-checked against the generator rather than trusted, because
        // --set-trait takes its bullet VERBATIM and pastes it into an image
        // prompt: an arbitrary string arriving here would be rendered. The
        // client's list can also simply be stale, which a long-open detail
        // sheet makes easy. Goes through the cache the GET route filled, so
        // the ordinary open-choose-submit path spawns the generator once.
        const query = await readTraitChoices(item, table);
        if (!query.ok) return sendJson(res, 502, { error: query.reason });
        const choice = query.data.choices.find((c) => c.value === value);
        if (!choice) {
            return sendJson(res, 400, {
                error: `"${value}" is not a value the ${table} table offers; the `
                    + 'tables file may have changed since this list was loaded.',
            });
        }

        // The checkbox offers exactly this value's conflicts, so anything else
        // is a client that has drifted - and releasing a trait the set one
        // does not gate is a re-roll in disguise, which the generator refuses
        // too.
        const release = Array.isArray(body.release) ? body.release : [];
        const stray = release.filter((r) => !choice.conflicts.includes(r));
        if (stray.length) {
            return sendJson(res, 400, {
                error: `cannot release ${stray.join(', ')}: not in conflict with this value`,
            });
        }

        // Always a fresh seed, same as the re-roll route: pinning a value and
        // getting a byte-identical image back is not what the button promises.
        const result = startRegenJob(item, {
            which: 'both', seedMode: 'random', setTrait: { table, value }, release,
        });
        return sendJson(res, result.ok ? 202 : 409, result);
    }

    /*
     * POST /api/stage-trait - apply one trait edit to the stored NPC and
     * render nothing. { id, op: 'reroll' | 'set', table, value?, release? }.
     *
     * The two routes above start a render, which queues a portrait, a token
     * and a background-removal pass and takes minutes; the server refuses a
     * second regen while one runs, so trying three haircuts could not be done
     * back to back at all. This one writes the edit into the manifest entry in
     * about a second and answers with the item as it now stands. The entry is
     * the accumulator - edits compose because each one starts from what the
     * last one wrote - and rendering is the Regenerate button, unchanged.
     * `artStale` on the item view is what says the two have parted company.
     *
     * Synchronous, and so not a job: nothing polls for it, and the reply IS
     * the answer. The refusals below are the ones the two routes above give,
     * reused verbatim rather than reworded, so a button refused here can never
     * be refused differently there.
     */
    if (url.pathname === '/api/stage-trait' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const item = body.id && findItem(body.id);
        if (!item) return sendJson(res, 404, { error: 'unknown item' });
        // Kind-aware from birth, per the design: resolved from the ITEM,
        // never a hard-coded 'npc'. kindFor() rather than kindOf() for the
        // reason startRegenJob and /api/set-trait give it - an unrecognised
        // kind is refused rather than folded onto npc.
        const stageKind = kindFor(KINDS, item.kind);
        if (!stageKind || !stageKind.supports.stageTrait) {
            return sendJson(res, 400, {
                error: `setting a trait isn't supported for kind "${item.kind}" yet`,
            });
        }

        const op = body.op === 'reroll' || body.op === 'set' ? body.op : null;
        if (!op) return sendJson(res, 400, { error: 'op must be "reroll" or "set"' });

        const table = typeof body.table === 'string' ? body.table : '';
        if (!table) return sendJson(res, 400, { error: 'table is required' });

        const value = typeof body.value === 'string' ? body.value : '';
        const release = Array.isArray(body.release) ? body.release : [];

        // Ahead of the re-rollable check on purpose, and in the same order
        // /api/set-trait puts them: an entry with no raw bullets gets the
        // legacy list, so checking that first would refuse Outfit as
        // un-settable when the real answer - and the cure - is that the entry
        // recorded no bullets to pin the rest of it to.
        if (op === 'set' && !hasRawTraits(item)) {
            return sendJson(res, 400, {
                error: 'this NPC recorded no raw bullets, so there is nothing to '
                    + 'pin the rest of it to. Re-roll the NPC to record them.',
            });
        }

        // The list this NPC gets, chosen the same way the two routes above
        // choose it - and named in the refusal, so the set printed is the one
        // that applies to THIS entry rather than the shorter one by default.
        const allowed = rerollableFor(item);
        if (allowed.length && !allowed.includes(table)) {
            return sendJson(res, 400, {
                error: op === 'reroll'
                    ? `"${table}" cannot be re-rolled on its own. Re-rollable: ${allowed.join(', ')}`
                    : `"${table}" cannot be set on its own. Settable: ${allowed.join(', ')}`,
            });
        }

        if (op === 'reroll') {
            // --release only ever answers a pinned value's conflicts, so there
            // is nothing here for it to be in conflict with. Refused rather
            // than dropped: silently ignoring it would re-roll the one trait
            // while the client believed it had asked for more.
            if (release.length) {
                return sendJson(res, 400, {
                    error: 'release only applies when setting a value; a re-roll frees its own cascade',
                });
            }
        } else {
            if (!value) return sendJson(res, 400, { error: 'value is required to set a trait' });

            // Re-checked against the generator rather than trusted, exactly as
            // /api/set-trait does it and for the same reason: --set-trait takes
            // its bullet VERBATIM, and the staged entry is what the eventual
            // render reads, so an arbitrary string arriving here would be
            // rendered later rather than now. Goes through the same cache the
            // GET route filled.
            const query = await readTraitChoices(item, table);
            if (!query.ok) return sendJson(res, 502, { error: query.reason });
            const choice = query.data.choices.find((c) => c.value === value);
            if (!choice) {
                return sendJson(res, 400, {
                    error: `"${value}" is not a value the ${table} table offers; the `
                        + 'tables file may have changed since this list was loaded.',
                });
            }
            const stray = release.filter((r) => !choice.conflicts.includes(r));
            if (stray.length) {
                return sendJson(res, 400, {
                    error: `cannot release ${stray.join(', ')}: not in conflict with this value`,
                });
            }
        }

        // Both refusals below are about the entry being written underneath
        // this edit. A regen rewrites it wholesale at the end of its run, and
        // a second staged edit rewrites it immediately - either would swallow
        // whatever this one applied.
        if (regenJobsByItemId.get(item.id)?.status === 'running') {
            return sendJson(res, 409, {
                ok: false, reason: 'this NPC is being re-rendered; wait for it to finish',
            });
        }
        if (stagingItemIds.has(item.id)) {
            return sendJson(res, 409, { ok: false, reason: 'another edit is still being applied' });
        }

        // A fresh draw seed every time, for the reason the two routes above
        // ask for `seedMode: 'random'`: clicking Re-roll twice must not hand
        // back the same haircut both times. It is not written to the entry -
        // the entry's own seed still describes the noise of the stored image.
        const result = await runApplyTrait(item, {
            op, table, value, release, seed: crypto.randomInt(0, 2 ** 32 - 1),
        });
        if (!result.ok) {
            return sendJson(res, result.timedOut ? 504 : 502, { ok: false, reason: result.reason });
        }

        // Re-read rather than echoed: the generator's stdout says what it
        // rolled, and this says what is stored. They should agree, and the
        // stored one is the one the next click and the next render will use.
        const fresh = findItem(item.id);
        return sendJson(res, 200, {
            ok: true,
            item: fresh ? itemView(fresh) : null,
            // The generator's own "with Hair colour: 'x' -> 'y'" cascade
            // report, off stderr. It is the only place that says what
            // travelled, and a user who clicked one button and got four new
            // traits needs to be told.
            log: result.log || '',
        });
    }

    if (url.pathname === '/api/trait-choices' && req.method === 'GET') {
        // Which values one trait could take on one NPC, and what each would
        // cost - computed by generate-npc.py's own roller, never here. See
        // lib/traitChoices.js for why that division is not negotiable.
        const id = url.searchParams.get('id');
        const item = id && findItem(id);
        if (!item) return sendJson(res, 404, { error: 'unknown item' });
        // kindFor(), not kindOf() - same reasoning as /api/set-trait's guard,
        // which this offer has to agree with: an unrecognised kind is
        // refused rather than folded onto npc.
        const choiceKind = kindFor(KINDS, item.kind);
        if (!choiceKind || !choiceKind.supports.setTrait) {
            return sendJson(res, 400, {
                error: `choosing a trait value isn't supported for kind "${item.kind}" yet`,
            });
        }
        const trait = url.searchParams.get('trait') || '';
        if (!trait) return sendJson(res, 400, { error: 'trait is required' });

        // The same two gates the Set... button is drawn behind, so a button
        // that exists is a button that works. Same reasoning as the matching
        // refusal on /api/reroll-trait: the offer and the refusal have to
        // agree, because a control that answers 400 is worse than no control.
        if (!hasRawTraits(item)) {
            return sendJson(res, 400, {
                error: 'this NPC recorded no raw bullets, so there is nothing to '
                    + 'pin the rest of it to. Re-roll the NPC to record them.',
            });
        }
        const allowed = rerollableFor(item);
        if (allowed.length && !allowed.includes(trait)) {
            return sendJson(res, 400, {
                error: `"${trait}" cannot be chosen on its own. Choosable: ${allowed.join(', ')}`,
            });
        }

        const result = await readTraitChoices(item, trait);
        if (!result.ok) return sendJson(res, 502, { error: result.reason });
        // `label` is added here rather than by the generator or the client.
        // The '||' -> '·' convention belongs to lib/traitOptions.js, which the
        // Create form's dropdown already renders through; computing it a
        // second time in the browser would give the same bullet two spellings
        // depending on which control you met it in. `value` is untouched - it
        // is what gets posted back and pasted into a prompt verbatim.
        return sendJson(res, 200, {
            ...result.data,
            choices: result.data.choices.map((choice) => ({
                ...choice, label: traitOptions.readableLabel(choice.value),
            })),
        });
    }

    if (url.pathname === '/api/trait-options' && req.method === 'GET') {
        const kind = resolveKind(url, null);
        if (!kind) {
            return sendJson(res, 400, { error: `unknown kind "${url.searchParams.get('kind')}"` });
        }
        // Every table's bullets, keyed by base table name, for the Create
        // form's per-override value dropdown. Same source as
        // /api/table-bullets - the parsed tables file - but shaped for
        // picking one value rather than for editing the file, and with
        // per-pronoun variants folded into the base table the override
        // dropdown actually names. See lib/traitOptions.js for why an
        // option's value keeps its '||' flags.
        const parsed = tableBullets.readTables(kind.tables);
        return sendJson(res, 200, { options: traitOptions.traitOptionsFrom(parsed) });
    }

    if (url.pathname === '/api/pronouns' && req.method === 'GET') {
        const kind = resolveKind(url, null);
        if (!kind) {
            return sendJson(res, 400, { error: `unknown kind "${url.searchParams.get('kind')}"` });
        }
        // Read per request rather than cached at startup: the Tables tab can
        // disable a Pronouns bullet while the server is running, and a stale
        // dropdown would offer a set the generator will no longer roll.
        //
        // A kind whose tables file has no '## Pronouns' section at all - a
        // spaceship's - answers {subjects: []} the same as an npc tables file
        // with every Pronouns bullet disabled, and still 200: a shared helper
        // that 400s on "no such section" would be a trap for a kind whose
        // form never calls this at all.
        let subjects = [];
        try {
            subjects = pronouns.subjectsFrom(fs.readFileSync(kind.tables, 'utf8'));
        } catch { /* no tables file - the client rebuilds the <select> with only "Any" */ }
        return sendJson(res, 200, { subjects });
    }

    if (url.pathname === '/api/table-bullets' && req.method === 'GET') {
        const kind = resolveKind(url, null);
        if (!kind) {
            return sendJson(res, 400, { error: `unknown kind "${url.searchParams.get('kind')}"` });
        }
        const tables = tableBullets.readTables(kind.tables);
        const parents = tableBullets.groupParents(tables);
        // Grouped server-side so the ordering logic stays a testable pure
        // function in lib/ rather than becoming untestable DOM code. Only the
        // grouped shape is sent - `groups[].rows[].table` are the same table
        // objects as `tables` here, but that reference sharing does not
        // survive JSON.parse on the client, so a flat `tables` field would
        // give the client two independent copies of every table and silently
        // desync whichever one it doesn't mutate.
        // The flag vocabulary rides along with the tables rather than living
        // at its own endpoint: the client needs both to draw a single row, and
        // two fetches would let the checkboxes render against a table list
        // they do not match. It is a constant, so it costs one serialisation
        // and no disk read.
        // Keyed by the ACTUAL heading names being served, not by base table,
        // so a pronoun variant carries its base's vocabulary and the client
        // can look one up by the name it already has. 'Headgear (she) +' is
        // where the wide woven hat that prompted the 'crown' flag lives, so
        // a client that could not resolve a variant would have left exactly
        // that bullet without checkboxes.
        const flags = {};
        for (const table of tables) {
            const vocabulary = tableFlags.flagsFor(table.name, parents);
            if (vocabulary) flags[table.name] = vocabulary;
        }
        return sendJson(res, 200, {
            groups: tableGroups.groupTables(tables, kind.id),
            flags,
        });
    }

    if (url.pathname === '/api/table-odds' && req.method === 'GET') {
        const kind = resolveKind(url, null);
        if (!kind) {
            return sendJson(res, 400, { error: `unknown kind "${url.searchParams.get('kind')}"` });
        }
        // 200 either way - see readTraitOdds(). A page that can still edit
        // tables without percentages is worth more than a correct status code.
        return sendJson(res, 200, await readTraitOdds(kind));
    }

    if (url.pathname === '/api/table-bullets/toggle' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const kind = resolveKind(url, body);
        if (!kind) return sendJson(res, 400, { error: `unknown kind "${body.kind ?? url.searchParams.get('kind')}"` });
        const { table, text, enabled } = body;
        if (typeof table !== 'string' || !table || typeof text !== 'string' || typeof enabled !== 'boolean') {
            return sendJson(res, 400, { error: 'table (string), text (string), and enabled (boolean) are required' });
        }
        // kind.tables, never a fixed tables path: writing an npc-shaped edit
        // through the ship's kind and landing it in npc-generator-tables.md
        // (or the reverse) would corrupt a 252 KB hand-authored file the GM
        // never asked to touch.
        const result = tableBullets.toggleBulletOnDisk(kind.tables, table, text, enabled);
        if (!result.ok) return sendJson(res, 400, { error: result.error });
        return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/table-bullets/set-weight' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const kind = resolveKind(url, body);
        if (!kind) return sendJson(res, 400, { error: `unknown kind "${body.kind ?? url.searchParams.get('kind')}"` });
        const { table, text, weight } = body;
        if (typeof table !== 'string' || !table || typeof text !== 'string'
            || !Number.isInteger(weight) || weight < 1) {
            return sendJson(res, 400, { error: 'table (string), text (string), and weight (integer >= 1) are required' });
        }
        const result = tableBullets.setBulletWeightOnDisk(kind.tables, table, text, weight);
        if (!result.ok) return sendJson(res, 400, { error: result.error });
        return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/table-bullets/set-flag' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const kind = resolveKind(url, body);
        if (!kind) return sendJson(res, 400, { error: `unknown kind "${body.kind ?? url.searchParams.get('kind')}"` });
        const { table, text, flag, on } = body;
        if (typeof table !== 'string' || !table || typeof text !== 'string'
            || typeof flag !== 'string' || !flag || typeof on !== 'boolean') {
            return sendJson(res, 400, { error: 'table (string), text (string), flag (string), and on (boolean) are required' });
        }
        // kind.tables for the same reason toggle above uses it: the flag
        // vocabulary is keyed on heading name alone, so the ship file's own
        // '## Backdrop' draws the NPC Backdrop checkboxes, and a hardcoded
        // NPC_TABLES_PATH here would land a Spaceships-tab edit in
        // npc-generator-tables.md.
        const result = tableBullets.setBulletFlagOnDisk(kind.tables, table, text, flag, on);
        if (!result.ok) return sendJson(res, 400, { error: result.error });
        // The new text goes back because a flag edit CHANGES the bullet's id.
        // A client still holding the old string would fail its next toggle or
        // reweight against a bullet that no longer answers to that name.
        return sendJson(res, 200, { ok: true, text: result.text });
    }

    if (url.pathname === '/api/presets' && req.method === 'GET') {
        const kind = resolveKind(url, null);
        if (!kind) {
            return sendJson(res, 400, { error: `unknown kind "${url.searchParams.get('kind')}"` });
        }
        return sendJson(res, 200, { presets: presets.listPresets(kind.presetsDir) });
    }

    if (url.pathname === '/api/presets' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const kind = resolveKind(url, body);
        if (!kind) return sendJson(res, 400, { error: `unknown kind "${body.kind ?? url.searchParams.get('kind')}"` });
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) return sendJson(res, 400, { error: 'name is required' });
        const slug = presets.slugify(name);
        if (!slug) return sendJson(res, 400, { error: 'name must contain at least one letter or digit' });
        if (presets.presetExists(kind.presetsDir, slug)) {
            return sendJson(res, 409, { error: `a preset named "${name}" already exists` });
        }
        const parsed = tableBullets.readTables(kind.tables);
        const preset = { name, created: new Date().toISOString(), selected: presets.snapshotSelected(parsed) };
        presets.writePreset(kind.presetsDir, slug, preset);
        return sendJson(res, 200, { ok: true, slug });
    }

    if (url.pathname === '/api/presets/delete' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const kind = resolveKind(url, body);
        if (!kind) return sendJson(res, 400, { error: `unknown kind "${body.kind ?? url.searchParams.get('kind')}"` });
        // safeSlug rather than a bare string check. This reached
        // path.join(dir, slug + '.json') unguarded, so a slug of
        // '../../../../some/other' deleted any .json file the server process
        // could write to. slugify() only ever emits [a-z0-9-], so nothing a
        // preset saved through this app can be named is refused by the guard -
        // it costs no legitimate behaviour at all. Same fix on /export below.
        const slug = safeSlug(body.slug);
        const ok = slug && presets.deletePreset(kind.presetsDir, slug);
        return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'unknown preset' });
    }

    if (url.pathname === '/api/presets/export' && req.method === 'GET') {
        const kind = resolveKind(url, null);
        if (!kind) {
            return sendJson(res, 400, { error: `unknown kind "${url.searchParams.get('kind')}"` });
        }
        // Guarded for the reason /delete above is, and for one more of its
        // own: the slug is interpolated into a Content-Disposition header
        // below, so a CR or LF in it injects response headers. safeSlug's
        // character class excludes both without having to reason about it.
        const slug = safeSlug(url.searchParams.get('slug'));
        const preset = slug && presets.readPreset(kind.presetsDir, slug);
        if (!preset) return sendJson(res, 404, { error: 'unknown preset' });
        const payload = JSON.stringify(preset, null, 2);
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="${slug}.json"`,
            'Content-Length': Buffer.byteLength(payload),
        });
        return res.end(payload);
    }

    if (url.pathname === '/api/presets/import' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const kind = resolveKind(url, body);
        if (!kind) return sendJson(res, 400, { error: `unknown kind "${body.kind ?? url.searchParams.get('kind')}"` });
        if (!body || typeof body.selected !== 'object' || body.selected === null) {
            return sendJson(res, 400, { error: 'not a valid preset file - missing "selected"' });
        }
        const parsed = tableBullets.readTables(kind.tables);
        return sendJson(res, 200, presets.diffPresetAgainstTables(body.selected, parsed));
    }

    if (url.pathname === '/api/presets/apply' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const kind = resolveKind(url, body);
        if (!kind) return sendJson(res, 400, { error: `unknown kind "${body.kind ?? url.searchParams.get('kind')}"` });
        if (!body || typeof body.selected !== 'object' || body.selected === null) {
            return sendJson(res, 400, { error: 'not a valid preset file - missing "selected"' });
        }
        // Re-diff against the live file rather than trusting a preview the
        // client may have shown a while ago - the file could have changed.
        const parsed = tableBullets.readTables(kind.tables);
        const diff = presets.diffPresetAgainstTables(body.selected, parsed);

        // One batch, one read, one write. This used to be a call to
        // toggleBulletOnDisk() and setBulletWeightOnDisk() per changed
        // bullet - each re-reading, re-parsing and re-writing the whole
        // tables file, so a 40-bullet preset was 80 full rewrites and the
        // file was observably half-applied in between - and the {ok:false}
        // every one of those calls returned was thrown away, so a write a
        // guard rejected still came back to the client as a plain success.
        const edits = [
            // An enable carries its weight in the same edit, so the line is
            // rewritten once rather than toggled and then reweighted.
            ...diff.willEnable.map(({ table, text, weight }) => ({ table, text, enabled: true, weight })),
            ...diff.willReweight.map(({ table, text, weight }) => ({ table, text, weight })),
            ...diff.willDisable.map(({ table, text }) => ({ table, text, enabled: false })),
        ];
        const { failed } = tableBullets.applyEditsOnDisk(kind.tables, edits);
        return sendJson(res, 200, { ...diff, failed });
    }

    /* ---- Create NPC form presets ---- */

    // There is deliberately no /api/create-presets/apply beside the family
    // below, and its absence next to the Tables presets - which do have one -
    // is worth stating so nobody adds it back as an oversight. Applying a
    // Tables preset rewrites npc-generator-tables.md, which only the server can
    // do; applying a Create preset sets the value of a dozen form controls in
    // the browser and touches nothing on disk at all. A round trip for that
    // would be a route whose entire job is to hand its own request body back.
    // The import route below is where a preset last passes through here, and
    // the settings it returns are in the checkbox sense - the client flips
    // portrait/token into the generator's --no-portrait / --no-token when it
    // eventually posts /api/create-npc, which is also where the "both off
    // leaves nothing to generate" rule still lives, because a preset saved
    // half-edited is legitimate but a run made from it is not.

    if (url.pathname === '/api/create-presets' && req.method === 'GET') {
        const kind = resolveKind(url, null);
        if (!kind) {
            return sendJson(res, 400, { error: `unknown kind "${url.searchParams.get('kind')}"` });
        }
        return sendJson(res, 200, { presets: createPresets.listCreatePresets(kind.createPresetsDir) });
    }

    if (url.pathname === '/api/create-presets' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const kind = resolveKind(url, body);
        if (!kind) return sendJson(res, 400, { error: `unknown kind "${body.kind ?? url.searchParams.get('kind')}"` });
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) return sendJson(res, 400, { error: 'name is required' });
        const slug = createPresets.slugify(name);
        if (!slug) return sendJson(res, 400, { error: 'name must contain at least one letter or digit' });
        // The duplicate check comes before the settings check, matching
        // /api/presets, because "you already have one of those" is about the
        // request the user made and a field-level complaint is about the form
        // they are still holding - answering the second question first would
        // have them fix a value only to be told the save was never possible.
        if (createPresets.createPresetExists(kind.createPresetsDir, slug)) {
            return sendJson(res, 409, { error: `a preset named "${name}" already exists` });
        }
        // The ship schema behind the discriminator: no pronouns, no unarmed.
        const result = createPresets.normaliseSettings(body.settings, { ship: kind.id !== DEFAULT_KIND });
        // Passed through verbatim: normaliseSettings names the field it choked
        // on, and rewording that here into a generic "invalid settings" would
        // throw away the only part of the message a user can act on.
        if (!result.ok) return sendJson(res, 400, { error: result.error });
        // `kind` is the registry entry's own discriminator, not left for
        // writeCreatePreset to default - its default is the NPC one, which
        // would mislabel every ship preset as a Create NPC preset.
        createPresets.writeCreatePreset(kind.createPresetsDir, slug, {
            name,
            created: new Date().toISOString(),
            kind: kind.createPresetDiscriminator,
            settings: result.settings,
        });
        return sendJson(res, 200, { ok: true, slug });
    }

    if (url.pathname === '/api/create-presets/delete' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const kind = resolveKind(url, body);
        if (!kind) return sendJson(res, 400, { error: `unknown kind "${body.kind ?? url.searchParams.get('kind')}"` });
        // A slug that fails safeSlug answers 404 rather than 400, the same as
        // one that simply is not there. Separating the two would tell anyone
        // poking at this which of their guesses were at least the right shape,
        // and the honest client never sends either.
        const slug = safeSlug(body.slug);
        const ok = slug && createPresets.deleteCreatePreset(kind.createPresetsDir, slug);
        return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'unknown preset' });
    }

    if (url.pathname === '/api/create-presets/export' && req.method === 'GET') {
        const kind = resolveKind(url, null);
        if (!kind) {
            return sendJson(res, 400, { error: `unknown kind "${url.searchParams.get('kind')}"` });
        }
        const slug = safeSlug(url.searchParams.get('slug') || '');
        const preset = slug && createPresets.readCreatePreset(kind.createPresetsDir, slug);
        if (!preset) return sendJson(res, 404, { error: 'unknown preset' });
        const payload = JSON.stringify(preset, null, 2);
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="${slug}.json"`,
            'Content-Length': Buffer.byteLength(payload),
        });
        return res.end(payload);
    }

    if (url.pathname === '/api/create-presets/import' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        // Query string only, deliberately: this body IS the preset file, and
        // its own `kind` field already means something else entirely - the
        // preset's discriminator ('create-form' / 'create-form-spaceship'),
        // not which tab is importing it. Reading requestKind()'s body.kind
        // here would misread that discriminator as the route's own selector.
        const kind = resolveKind(url, null);
        if (!kind) {
            return sendJson(res, 400, { error: `unknown kind "${url.searchParams.get('kind')}"` });
        }
        const result = createPresets.validatePresetFile(body, { kind: kind.createPresetDiscriminator });
        if (!result.ok) return sendJson(res, 400, { error: result.error });
        // The override tables are checked here even though validatePresetFile
        // cannot - it has no view of the generator's REQUIRED_TABLES. A preset
        // naming a table that has since been renamed or dropped would otherwise
        // load into the form looking fine and then fail on Generate with this
        // exact message, at which point the user has lost the connection
        // between the file they imported and the row that is wrong.
        const unknown = result.preset.settings.overrides
            .find((o) => !OVERRIDE_DATA_BY_KIND[kind.id].tables.includes(o.table));
        if (unknown) return sendJson(res, 400, { error: `unknown table "${unknown.table}"` });
        // Nothing is written: import fills the form, and the user decides
        // whether it is worth saving under a name of their own.
        return sendJson(res, 200, { ok: true, name: result.preset.name, settings: result.preset.settings });
    }

    // The alias: hard-codes kind: 'npc' regardless of whatever the body
    // names, which is what keeps test/api.createArgs.test.js green byte for
    // byte, including its assertion that the NPC path passes no --manifest.
    // A cached older page, or a script written against this route, keeps
    // working exactly as it always did.
    if (url.pathname === '/api/create-npc' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const { status, body: respBody } = handleCreateRequest(KINDS[DEFAULT_KIND], body);
        return sendJson(res, status, respBody);
    }

    // The canonical route: `kind` in the body or `?kind=` on the URL,
    // defaulting to npc like everything else here. An unknown kind is a 400
    // rather than a silent fold onto npc - see resolveKind()'s own docs.
    if (url.pathname === '/api/create' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const kindEntry = resolveKind(url, body);
        if (!kindEntry) {
            return sendJson(res, 400, { error: `unknown kind "${body.kind ?? url.searchParams.get('kind')}"` });
        }
        const { status, body: respBody } = handleCreateRequest(kindEntry, body);
        return sendJson(res, status, respBody);
    }

    if (url.pathname === '/api/create-status' && req.method === 'GET') {
        const jobId = url.searchParams.get('jobId');
        const job = jobId && createJobs.get(jobId);
        if (!job) return sendJson(res, 404, { error: 'unknown job' });
        return sendJson(res, 200, {
            status: job.status,
            // Which registry entry this run created - 'npc' for every job the
            // alias ever started, and whatever POST /api/create was asked
            // for otherwise. Additive: existing callers that never look at
            // it are unaffected.
            kind: job.kind,
            dryRun: job.dryRun,
            log: job.log,
            error: job.error ?? null,
            // How many NPCs the run actually added to the manifest, or null if
            // it was not measured (dry run, unreadable manifest, still going).
            produced: job.produced ?? null,
            // And which ones, so the banner the client raises over this run can
            // clear the New tag on those NPCs alone when it is dismissed. Null
            // under exactly the conditions `produced` is null; a client that
            // cannot name the run's NPCs clears nothing rather than guessing.
            producedIds: job.producedIds ?? null,
        });
    }

    if (url.pathname === '/api/ship-catalogue' && req.method === 'GET') {
        const result = await readShipCatalogue();
        if (!result.ok) return sendJson(res, 502, { error: result.reason });
        // Handed through exactly as generate-spaceship.py printed it - see
        // readShipCatalogue()'s own docs for why `sizes` stays an array here
        // rather than being reshaped into a map.
        return sendJson(res, 200, result.data);
    }

    if (url.pathname === '/api/trait-candidates' && req.method === 'GET') {
        const kind = resolveKind(url, null);
        if (!kind) {
            return sendJson(res, 400, { error: `unknown kind "${url.searchParams.get('kind')}"` });
        }
        // One kind's staging directory, not both flattened together. A
        // candidate's table name is only meaningful paired with the file it
        // came from - '## Backdrop' exists in both tables files - so a merged
        // listing would be a list the GUI could not act on.
        return sendJson(res, 200, { candidates: allTraitCandidates(kind) });
    }

    if (url.pathname === '/api/trait-image' && req.method === 'GET') {
        const kind = resolveKind(url, null);
        if (!kind) {
            return sendJson(res, 400, { error: `unknown kind "${url.searchParams.get('kind')}"` });
        }
        const file = url.searchParams.get('file');
        const id = url.searchParams.get('id');
        // Resolved through the candidate listing rather than from the query
        // directly, so the filename served is one the staging directory
        // actually offered - a `file` that climbs out of it matches nothing
        // and never reaches the filesystem at all. Now also one kind's
        // listing: the two staging directories are siblings and a run in one
        // is not a run in the other, so a ship run named on ?kind=npc is as
        // unknown as a file that never existed.
        const candidate = file && id
            && allTraitCandidates(kind).find((c) => c.file === file && c.id === id);
        if (!candidate) return sendJson(res, 404, { error: 'unknown candidate' });
        const full = refImagePath(kind, candidate.file, candidate.sourceImage);
        if (!full) return sendJson(res, 404, { error: 'no reference image staged for this candidate' });
        res.writeHead(200, {
            'Content-Type': REF_IMAGE_TYPES[path.extname(full).toLowerCase()],
            'Cache-Control': 'no-store',
        });
        fs.createReadStream(full).pipe(res);
        return;
    }

    if (url.pathname === '/api/trait-candidates/import' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const kind = resolveKind(url, body);
        if (!kind) {
            return sendJson(res, 400, {
                error: `unknown kind "${body.kind ?? url.searchParams.get('kind')}"`,
            });
        }
        const items = Array.isArray(body.items) ? body.items : [];

        // The whole batch is one kind's. Reading the run, writing the bullet
        // and marking the entry imported all go to the same kind, which is
        // what stops a ship's '## Backdrop' candidate from being appended to
        // the NPC tables file and then recorded as imported in the ship run.
        const results = items.map(({ file, id }) => {
            let data;
            try {
                data = loadStagedFile(kind, file);
            } catch (err) {
                return { file, id, imported: false, reason: `couldn't read ${file}: ${err.message}` };
            }
            const entry = (data.entries || []).find((e) => e.id === id);
            if (!entry) return { file, id, imported: false, reason: 'no such candidate' };
            if (entry.imported) return { file, id, imported: false, reason: 'already imported' };
            try {
                insertBulletIntoTables(kind, entry.table, entry.bullet);
            } catch (err) {
                return { file, id, imported: false, reason: err.message };
            }
            entry.imported = true;
            entry.imported_at = new Date().toISOString();
            saveStagedFile(kind, file, data);
            return { file, id, imported: true };
        });
        return sendJson(res, 200, { results });
    }

    sendJson(res, 404, { error: `no route ${req.method} ${url.pathname}` });
}

async function handleImporter(req, res, url) {
    res.setHeader('Access-Control-Allow-Origin', CORS_HEADERS['Access-Control-Allow-Origin']);

    if (!authorised(req, url)) return sendJson(res, 401, { error: 'bad or missing X-Import-Gui-Key' });

    if (url.pathname === '/importer/pending' && req.method === 'GET') {
        return sendJson(res, 200, { jobs: pendingJobsForFoundry() });
    }

    if (url.pathname === '/importer/complete' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        const ok = completeJob(body);
        return sendJson(res, ok ? 200 : 409, { ok });
    }

    if (url.pathname === '/importer/reconcile' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }
        reconcile(Array.isArray(body.entries) ? body.entries : [], body.kinds);
        return sendJson(res, 200, { ok: true, tracked: importedIndex.size });
    }

    sendJson(res, 404, { error: `no route ${req.method} ${url.pathname}` });
}

async function handle(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
        return sendJson(res, 200, {
            ok: true,
            plugin: PLUGIN_ID,
            manifestItems: loadManifest().length,
            trackedImports: importedIndex.size,
            pendingJobs: [...jobsByItemId.values()].filter((j) => j.status !== 'done').length,
        });
    }

    if (url.pathname.startsWith('/importer/')) return handleImporter(req, res, url);
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    return serveStatic(req, res, url.pathname);
}

const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
        console.error(`[${PLUGIN_ID}] request failed:`, err);
        try {
            sendJson(res, 500, { error: 'internal error' });
        } catch { /* response already sent */ }
    });
});

server.listen(config.port, config.host, () => {
    console.log(`[${PLUGIN_ID}] listening on http://${config.host}:${config.port} (auth: ${config.secret ? 'on' : 'OFF'})`);
    console.log(`[${PLUGIN_ID}] manifest: ${config.npcManifestPath}`);
    console.log(`[${PLUGIN_ID}] Foundry Data root: ${config.foundryDataRoot}`);
});
