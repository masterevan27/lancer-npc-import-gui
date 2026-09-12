/**
 * The kind registry: the one new abstraction the spaceship work introduces.
 *
 * Five things vary between an NPC and a spaceship - the generator script,
 * the tables file, the presets root, the Foundry subdirectory and the
 * capability set - and every one of them used to be read from a
 * module-level constant in server.js. buildKinds() resolves all five, per
 * kind, from the derived path set (lib/paths.js) and the loaded config, so a
 * route asks the registry instead of hard-coding a second branch.
 *
 * Pure module: no fs writes, no spawn. available() below does read the
 * filesystem (to check a script exists), but nothing here has a side
 * effect, so it is unit-tested exactly like lib/paths.js - no port, no temp
 * directory.
 */

const fs = require('node:fs');

const DEFAULT_KIND = 'npc';

// Both createArgs implementations build a --regen-manifest / --regen-id /
// --new-seed argv identical but for the script, which is exactly why this
// builder is shared rather than becoming an `if (kind === 'spaceship')` in
// server.js. Matches server.js:713-735, generalised to read its manifest
// path, item id, seed and which-half selector off `opts` instead of closing
// over `config`/`item`/`which` the way the inline version does.
function buildRegenArgs(script, opts) {
    const args = [
        script,
        '--regen-manifest', opts.manifestPath,
        '--regen-id', opts.id,
        '--new-seed', String(opts.newSeed),
    ];
    if (opts.which === 'portrait') args.push('--no-token');
    if (opts.which === 'token') args.push('--no-portrait');
    return args;
}

function buildKinds(paths, config) {
    const npcScript = paths.generateNpcScript;
    const shipScript = paths.generateSpaceshipScript;

    const npc = {
        id: 'npc',
        label: 'NPCs',
        subject: 'NPC',
        script: npcScript,
        tables: paths.npcTablesPath,
        presetsDir: paths.presetsDir,
        createPresetsDir: paths.createPresetsDir,
        createPresetDiscriminator: 'create-form',
        stagedImportsDir: paths.stagedImportsDir,
        stagedRefsDir: paths.stagedRefsDir,
        foundrySubdir: config.foundryNpcSubdir,
        foundryActorType: config.foundryNpcActorType,
        supports: {
            regen: true, setTrait: true, stageTrait: true, model3d: true,
            traitCandidates: true, tables: true, create: true, odds: true,
            animate: true, manifest: true, import: true, expressions: true,
        },
        // Moved verbatim from server.js's startCreateJob (server.js:1133-1148
        // at the time of writing). Note what it does NOT do: it never passes
        // --manifest, which silently depends on config.npcManifestPath
        // already equalling generate-npc.py's own DEFAULT_MANIFEST. That is
        // a latent bug, but fixing it here would change the argv
        // test/api.createArgs.test.js pins, so it is left exactly as it was.
        createArgs(opts) {
            const args = [npcScript, '--count', String(opts.count)];
            if (opts.seed !== null) args.push('--seed', String(opts.seed));
            if (opts.name) args.push('--name', opts.name);
            if (opts.pronouns) args.push('--pronouns', opts.pronouns);
            for (const { table, value } of opts.overrides) {
                args.push('--set-trait', `${table}=${value}`);
            }
            if (opts.noPortrait) args.push('--no-portrait');
            if (opts.noToken) args.push('--no-token');
            if (opts.keepRawToken) args.push('--keep-raw-token');
            if (opts.unarmed) args.push('--unarmed');
            if (opts.server) args.push('--server', opts.server);
            if (opts.dryRun) args.push('--dry-run');
            return args;
        },
        regenArgs(opts) {
            return buildRegenArgs(npcScript, opts);
        },
    };

    const spaceship = {
        id: 'spaceship',
        label: 'Spaceships',
        subject: 'spaceship',
        script: shipScript,
        tables: paths.spaceshipTablesPath,
        presetsDir: paths.spaceshipPresetsDir,
        createPresetsDir: paths.spaceshipCreatePresetsDir,
        createPresetDiscriminator: 'create-form-spaceship',
        stagedImportsDir: paths.spaceshipStagedImportsDir,
        stagedRefsDir: paths.spaceshipStagedRefsDir,
        foundrySubdir: config.foundrySpaceshipSubdir,
        foundryActorType: config.foundrySpaceshipActorType,
        // model3d is the one capability ships do not get in v1:
        // generate-3d.py imports generate-npc.py for its own DEFAULT_MANIFEST
        // and classify3dFiles (lib/model3d.js) matches exact NPC deliverable
        // names, so a ship pointed at the 3D panel today would misfile.
        // animate is off with it: the ## Animation table's prompts are
        // written for a person - hair, a scarf, a glance - and a hull given
        // one would be told to breathe.
        supports: {
            regen: true, setTrait: true, stageTrait: true, model3d: false,
            traitCandidates: true, tables: true, create: true, odds: true,
            animate: false, manifest: true, import: true, expressions: false,
        },
        // Deliberately NOT a copy of the NPC path's implicit manifest
        // coupling: --manifest is always passed explicitly here. No
        // --pronouns, no --unarmed - those are person-only concepts.
        createArgs(opts) {
            const args = [shipScript, '--count', String(opts.count)];
            if (opts.seed !== null && opts.seed !== undefined) {
                args.push('--seed', String(opts.seed));
            }
            if (opts.name) args.push('--name', opts.name);
            for (const { table, value } of opts.overrides) {
                args.push('--set-trait', `${table}=${value}`);
            }
            if (opts.noPortrait) args.push('--no-portrait');
            if (opts.noToken) args.push('--no-token');
            if (opts.keepRawToken) args.push('--keep-raw-token');
            if (opts.manifestPath) args.push('--manifest', opts.manifestPath);
            // --out-root, not --out: --out names a single run folder, so a
            // configured --out would pin every ship run to one directory.
            if (opts.outputRoot) args.push('--out-root', opts.outputRoot);
            if (opts.server) args.push('--server', opts.server);
            if (opts.dryRun) args.push('--dry-run');
            return args;
        },
        regenArgs(opts) {
            return buildRegenArgs(shipScript, opts);
        },
    };

    const expression = {
        id: 'expression',
        label: 'Expressions',
        subject: 'expression',
        tables: paths.expressionTablesPath,
        presetsDir: paths.expressionPresetsDir,
        supports: {
            regen: false, setTrait: false, stageTrait: false, model3d: false,
            traitCandidates: false, tables: true, create: false, odds: false,
            animate: false, manifest: false, import: false, expressions: false,
        },
    };

    return { npc, spaceship, expression };
}

/** The registry entry for `id`, or null if it names no known kind. */
function kindFor(kinds, id) {
    return (id && kinds[id]) || null;
}

/** The kind an existing manifest entry belongs to; missing `kind` is npc. */
function kindOf(kinds, item) {
    return kindFor(kinds, item && item.kind) || kindFor(kinds, DEFAULT_KIND);
}

/** body.kind wins, then ?kind= on the URL, then the default. */
function requestKind(url, body) {
    if (body && typeof body.kind === 'string' && body.kind) return body.kind;
    const fromQuery = url.searchParams.get('kind');
    if (fromQuery) return fromQuery;
    return DEFAULT_KIND;
}

/**
 * Kinds that can offer an installed affordance. Generator kinds still need
 * their script; a deliberately scriptless tables-only kind needs its table.
 *
 * Drives the `kinds` field of /api/categories, which the client turns into
 * the two ship affordances it hides: the Create Spaceship tab button and the
 * Spaceships option on the Tables kind select. A GUI pointed at a generator
 * repo without generate-spaceship.py therefore offers neither, instead of a
 * tab whose first fetch reads a tables file that is not there and 500s.
 *
 * Deliberately NOT what filters /api/categories' own rows: those are counts
 * of what the manifest already holds, and a library that has ships in it must
 * keep showing them even if the script that made them has since moved.
 */
function available(kinds) {
    const result = {};
    for (const [id, entry] of Object.entries(kinds)) {
        if (entry.script ? fs.existsSync(entry.script)
            : entry.supports.tables && fs.existsSync(entry.tables)) result[id] = entry;
    }
    return result;
}

module.exports = { DEFAULT_KIND, buildKinds, kindFor, kindOf, requestKind, available };
