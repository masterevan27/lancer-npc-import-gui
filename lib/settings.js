/**
 * The Settings dialog's half of config.json: which keys it edits, how a
 * submitted form is checked, and how the result is written back.
 *
 * server.js reads config.json once, at startup, and nearly every value is
 * baked into a constant from there - derived paths, the kind registry, the
 * port it listens on. Swapping them under a running server would mean
 * rebuilding all of that mid-request, so the dialog does not try: it writes
 * the file and says a restart is needed, which is what editing the file by
 * hand has always meant too.
 *
 * The write is a merge into whatever the file already holds, never a
 * replacement with the form's fields. A key this list does not know about -
 * one added by hand, or by a newer server - survives a save untouched. A
 * field left blank is removed from the file rather than written as "", so the
 * default (or the path lib/paths.js derives) applies exactly as it does for a
 * key that was never set.
 */

const fs = require('node:fs');
const path = require('node:path');
const { derivePaths } = require('./paths');

// type: 'text' | 'path' | 'number' | 'secret'. `derived` names the
// lib/paths.js output a blank path field falls back to, so the dialog can
// show where it will actually point.
const SETTINGS_GROUPS = [
    {
        id: 'required',
        label: 'Required paths',
        fields: [
            { key: 'npcManifestPath', type: 'path', required: true, label: 'Generated manifest',
                help: 'The art generator\'s .generated-npcs.json. Most other paths are derived from its folder.' },
            { key: 'foundryDataRoot', type: 'path', required: true, label: 'Foundry Data folder',
                help: 'Foundry\'s Data directory; imported art is copied beneath it.' },
        ],
    },
    {
        id: 'server',
        label: 'Server',
        fields: [
            { key: 'port', type: 'number', min: 1, max: 65535, label: 'Port' },
            { key: 'host', type: 'text', label: 'Host',
                help: '127.0.0.1 is this machine only; 0.0.0.0 opens the GUI to your network.' },
            { key: 'secret', type: 'secret', label: 'Shared secret',
                help: 'Authorises the Foundry module. Must match the module\'s setting.' },
        ],
    },
    {
        id: 'scripts',
        label: 'Python and generator scripts',
        fields: [
            { key: 'pythonExecutable', type: 'text', label: 'Python executable',
                help: 'Command or full path used to run every generator script.' },
            { key: 'generateNpcScript', type: 'path', derived: 'generateNpcScript', label: 'generate-npc.py' },
            { key: 'generateSpaceshipScript', type: 'path', derived: 'generateSpaceshipScript', label: 'generate-spaceship.py' },
            { key: 'generate3dScript', type: 'path', derived: 'generate3dScript', label: 'generate-3d.py' },
            { key: 'animatePortraitScript', type: 'path', derived: 'animatePortraitScript', label: 'animate-portrait.py' },
            { key: 'generateArtScript', type: 'path', derived: 'generateArtScript', label: 'generate-art.py' },
            { key: 'generateExpressionsScript', type: 'path', derived: 'generateExpressionsScript', label: 'generate-expressions.py' },
        ],
    },
    {
        id: 'foundry',
        label: 'Foundry import',
        fields: [
            { key: 'foundryNpcSubdir', type: 'text', label: 'NPC subfolder',
                help: 'Folder under the Foundry Data folder that imported NPCs are copied into.' },
            { key: 'foundrySpaceshipSubdir', type: 'text', label: 'Spaceship subfolder' },
            { key: 'foundryNpcActorType', type: 'text', label: 'NPC actor type',
                help: 'Blank sends no type, and the module creates a plain npc Actor.' },
            { key: 'foundrySpaceshipActorType', type: 'text', label: 'Spaceship actor type' },
        ],
    },
    {
        id: 'sillytavern',
        label: 'SillyTavern',
        fields: [
            { key: 'sillyTavernBackgroundsDir', type: 'path', label: 'Backgrounds folder',
                help: 'SillyTavern\'s data/<user>/backgrounds. Blank turns "Import into SillyTavern" off.' },
            { key: 'sillyTavernCharactersDir', type: 'path', label: 'Characters folder',
                help: 'SillyTavern\'s data/<user>/characters, for importing expression sprites.' },
        ],
    },
    {
        id: 'npc',
        label: 'NPC tables and presets',
        fields: [
            { key: 'npcTablesPath', type: 'path', derived: 'npcTablesPath', label: 'NPC tables file' },
            { key: 'stagedImportsDir', type: 'path', derived: 'stagedImportsDir', label: 'Staged trait imports' },
            { key: 'stagedRefsDir', type: 'path', derived: 'stagedRefsDir', label: 'Staged reference images' },
            { key: 'presetsDir', type: 'path', derived: 'presetsDir', label: 'Presets folder' },
            { key: 'createPresetsDir', type: 'path', derived: 'createPresetsDir', label: 'Create NPC presets' },
        ],
    },
    {
        id: 'spaceship',
        label: 'Spaceship tables and presets',
        fields: [
            { key: 'spaceshipTablesPath', type: 'path', derived: 'spaceshipTablesPath', label: 'Spaceship tables file' },
            { key: 'spaceshipStagedImportsDir', type: 'path', derived: 'spaceshipStagedImportsDir', label: 'Staged trait imports' },
            { key: 'spaceshipStagedRefsDir', type: 'path', derived: 'spaceshipStagedRefsDir', label: 'Staged reference images' },
            { key: 'spaceshipPresetsDir', type: 'path', derived: 'spaceshipPresetsDir', label: 'Presets folder' },
            { key: 'spaceshipCreatePresetsDir', type: 'path', derived: 'spaceshipCreatePresetsDir', label: 'Create Spaceship presets' },
            { key: 'spaceshipOutputRoot', type: 'path', label: 'Spaceship output root',
                help: 'Passed to generate-spaceship.py as --out-root. Blank uses the generator\'s own default.' },
        ],
    },
    {
        id: 'expressions',
        label: 'Expressions',
        fields: [
            { key: 'expressionTablesPath', type: 'path', derived: 'expressionTablesPath', label: 'Expression tables file' },
            { key: 'expressionPresetsDir', type: 'path', derived: 'expressionPresetsDir', label: 'Expression presets' },
        ],
    },
    {
        id: 'backgrounds',
        label: 'Backgrounds',
        fields: [
            { key: 'backgroundsDir', type: 'path', derived: 'backgroundsDir', label: 'Rendered backgrounds' },
            { key: 'backgroundPromptsDir', type: 'path', derived: 'backgroundPromptsDir', label: 'Background prompt catalogues' },
            { key: 'backgroundTablesPath', type: 'path', derived: 'backgroundTablesPath', label: 'Background animation tables' },
        ],
    },
    {
        id: 'advanced',
        label: 'Advanced',
        fields: [
            { key: 'traitOddsSamples', type: 'number', min: 100, max: 1000000, label: 'Trait odds samples',
                help: 'Rolls behind each percentage on the Tables page. More is steadier but slower.' },
            { key: 'backgroundListTimeoutMs', type: 'number', min: 1000, max: 600000, label: 'Background list timeout (ms)' },
            { key: 'importedIndexPath', type: 'path', label: 'Imported-Actor cache file',
                help: 'Blank keeps .imported.json beside server.js.' },
        ],
    },
];

const SETTINGS_FIELDS = SETTINGS_GROUPS.flatMap((g) => g.fields);

// Defaults the dialog shows as placeholders for keys DEFAULT_CONFIG in
// server.js does not carry.
const EXTRA_DEFAULTS = { backgroundListTimeoutMs: 15000 };

// Environment variables loadConfig() lets win over the file.
const ENV_OVERRIDES = {
    port: 'IMPORT_GUI_PORT',
    host: 'IMPORT_GUI_HOST',
    secret: 'IMPORT_GUI_SECRET',
};

/** The file as JSON, {} when absent. Throws on unreadable or invalid JSON. */
function readConfigFile(file) {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('config.json does not hold a JSON object');
    }
    return parsed;
}

/**
 * manifestPath is the preferred alias server.js resolves ahead of
 * npcManifestPath. The dialog shows one field, and writes back to whichever
 * name the file already uses so a hand-kept file does not grow a second one.
 */
function manifestKey(fileConfig) {
    return fileConfig.manifestPath ? 'manifestPath' : 'npcManifestPath';
}

/**
 * What the dialog renders: each field's value as the file holds it, and the
 * placeholder a blank field falls back to. The secret's value is never sent -
 * only whether one is set.
 */
function settingsView(fileConfig, defaults, env = process.env) {
    const values = {};
    for (const field of SETTINGS_FIELDS) {
        if (field.type === 'secret') continue;
        const raw = field.key === 'npcManifestPath'
            ? fileConfig[manifestKey(fileConfig)]
            : fileConfig[field.key];
        values[field.key] = raw === undefined || raw === null ? '' : String(raw);
    }

    const effective = { ...defaults, ...fileConfig };
    effective.npcManifestPath = fileConfig.manifestPath || fileConfig.npcManifestPath || '';
    const derived = effective.npcManifestPath ? derivePaths(effective) : {};

    const placeholders = {};
    for (const field of SETTINGS_FIELDS) {
        if (field.derived && derived[field.derived]) {
            placeholders[field.key] = derived[field.derived];
        } else {
            const fallback = field.key in defaults ? defaults[field.key] : EXTRA_DEFAULTS[field.key];
            if (fallback !== undefined && fallback !== '') placeholders[field.key] = String(fallback);
        }
    }

    const envOverrides = {};
    for (const [key, name] of Object.entries(ENV_OVERRIDES)) {
        if (env[name] !== undefined) envOverrides[key] = name;
    }

    return {
        groups: SETTINGS_GROUPS,
        values,
        placeholders,
        secretSet: typeof fileConfig.secret === 'string' && fileConfig.secret !== '',
        envOverrides,
    };
}

/**
 * Checks a submitted form and merges it into the file's current contents.
 *
 * `submitted.values` carries the form's fields as strings; a key it omits is
 * left as the file has it. `submitted.secret` is undefined to keep the secret,
 * or a string to replace it - "" removes it.
 *
 * Returns { errors } keyed by field, or { next } - the object to write.
 */
function applySettings(fileConfig, submitted) {
    const values = submitted && typeof submitted.values === 'object' && submitted.values
        ? submitted.values : {};
    const errors = {};
    const next = { ...fileConfig };

    for (const field of SETTINGS_FIELDS) {
        if (field.type === 'secret') continue;
        if (!(field.key in values)) continue;
        const raw = values[field.key];
        if (raw !== null && typeof raw !== 'string' && typeof raw !== 'number') {
            errors[field.key] = 'must be text';
            continue;
        }
        const text = raw === null ? '' : String(raw).trim();
        const target = field.key === 'npcManifestPath' ? manifestKey(fileConfig) : field.key;

        if (!text) {
            if (field.required) {
                errors[field.key] = 'is required - the server will not start without it';
                continue;
            }
            delete next[target];
            continue;
        }

        if (field.type === 'number') {
            if (!/^\d+$/.test(text)) {
                errors[field.key] = 'must be a whole number';
                continue;
            }
            const n = Number(text);
            if (n < field.min || n > field.max) {
                errors[field.key] = `must be between ${field.min} and ${field.max}`;
                continue;
            }
            next[target] = n;
        } else {
            if (/[\r\n\0]/.test(text)) {
                errors[field.key] = 'must be a single line';
                continue;
            }
            next[target] = text;
        }
    }

    if (submitted && submitted.secret !== undefined) {
        if (typeof submitted.secret !== 'string') {
            errors.secret = 'must be text';
        } else if (submitted.secret === '') {
            delete next.secret;
        } else {
            next.secret = submitted.secret;
        }
    }

    return Object.keys(errors).length ? { errors } : { next };
}

/**
 * Set path fields that point at nothing. Not errors: a GM may be configuring
 * ahead of a first generator run, and the server already reports a missing
 * folder at the point it is used.
 */
function missingPathWarnings(fileConfig) {
    const warnings = {};
    for (const field of SETTINGS_FIELDS) {
        if (field.type !== 'path') continue;
        const value = field.key === 'npcManifestPath'
            ? fileConfig[manifestKey(fileConfig)]
            : fileConfig[field.key];
        if (typeof value === 'string' && value && !fs.existsSync(value)) {
            warnings[field.key] = 'nothing exists at this path yet';
        }
    }
    return warnings;
}

/**
 * Writes via a temp file and a rename, so a crash mid-write cannot leave a
 * half-written config.json that stops the server starting. The previous file
 * is kept as config.json.bak first.
 */
function writeConfigFile(file, next) {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tmp, file);
}

/** A comparable snapshot of the fields the dialog edits, for "restart needed". */
function settingsFingerprint(fileConfig) {
    const snapshot = {};
    for (const field of SETTINGS_FIELDS) {
        const value = field.key === 'npcManifestPath'
            ? fileConfig.manifestPath || fileConfig.npcManifestPath
            : fileConfig[field.key];
        snapshot[field.key] = value === undefined || value === '' ? null : value;
    }
    return JSON.stringify(snapshot);
}

/**
 * Whether a request may change settings. pythonExecutable and the script
 * paths are commands this server runs, so writing them from the network is
 * running code on this machine - a GUI bound to 0.0.0.0 with no secret would
 * otherwise hand that to anyone on the LAN. Loopback requests may always
 * save; anyone else needs the shared secret, and with no secret set, cannot.
 */
function settingsWriteAllowed({ remoteAddress, secret, providedKey }) {
    if (isLoopback(remoteAddress)) return true;
    return typeof secret === 'string' && secret !== '' && providedKey === secret;
}

function isLoopback(address) {
    if (typeof address !== 'string') return false;
    return address === '::1'
        || address.startsWith('127.')
        || address.startsWith('::ffff:127.');
}

module.exports = {
    SETTINGS_GROUPS,
    SETTINGS_FIELDS,
    readConfigFile,
    settingsView,
    applySettings,
    missingPathWarnings,
    writeConfigFile,
    settingsFingerprint,
    settingsWriteAllowed,
};
