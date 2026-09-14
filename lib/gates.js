/**
 * The generator's gate maps - which Roles a gate flag admits - as the Tables
 * tab edits them.
 *
 * generate-npc.py keeps five maps as Python literals: ROLE_CATEGORIES (which
 * bucket each Role bullet belongs to), ROLE_LOCKS (a Gear or Headgear flag ->
 * the Roles or buckets that may roll it), BACKDROP_ROLES (the same for a
 * Backdrop scene), WEAPON_ROLES (the reverse: a Role that may roll ONLY
 * bullets carrying the flag) and UNAFFILIATED_ROLES (Roles cut to the
 * 'unaffiliated' Factions). The GUI does not rewrite those literals. It reads
 * them as DEFAULTS - parsed with a regex, the way lib/overrideTables.js reads
 * REQUIRED_TABLES - and writes the user's edits to a JSON sidecar beside the
 * tables file, which the generator's load_gates() applies over the literals.
 *
 * The sidecar's name and shape are the generator's contract (gates_path() and
 * GATE_MAPS there): `<tables>.gates.json`, an object whose keys are the five
 * camelCase names below, each replacing its map whole. A key the file omits
 * keeps the Python default, so a sidecar written today still loads after a
 * sixth map is added.
 */
const fs = require('node:fs');
const path = require('node:path');

/** The sidecar keys, in the order the panel shows them. */
const GATE_KEYS = ['roleCategories', 'roleLocks', 'backdropRoles', 'weaponRoles', 'unaffiliatedRoles'];

/** Which flag map each table's gate flags live in. Tables absent here have no gates. */
const GATE_TABLES = {
    Gear: 'roleLocks',
    Headgear: 'roleLocks',
    Backdrop: 'backdropRoles',
    Weapon: 'weaponRoles',
};

/** A flag the tables file can carry: one word after `||`, and not a theme tag. */
const FLAG_RE = /^[a-z][a-z0-9_-]*$/;

function gatesPathFor(tablesPath) {
    const parsed = path.parse(tablesPath);
    return path.join(parsed.dir, `${parsed.name}.gates.json`);
}

// A top-level literal runs to the first `}` in column 0, which Python's own
// indentation guarantees is the end of it. Whole comment lines are cut first:
// the maps are two thirds prose by volume and the prose quotes names.
const COMMENT_LINE_RE = /^[ \t]*#.*$/gm;
const NAME_RE = /"([^"]+)"/g;

function blockOf(source, constant) {
    const re = new RegExp(`^${constant}\\s*=\\s*(?:frozenset\\()?\\{([\\s\\S]*?)^\\}`, 'm');
    const block = source.match(re);
    return block ? block[1].replace(COMMENT_LINE_RE, '') : null;
}

function tupleDictFrom(source, constant) {
    const body = blockOf(source, constant);
    if (body === null) return null;
    const out = {};
    for (const [, flag, names] of body.matchAll(/"([^"]+)"\s*:\s*\(([^)]*)\)/g)) {
        out[flag] = [...names.matchAll(NAME_RE)].map((m) => m[1]);
    }
    return out;
}

function stringDictFrom(source, constant) {
    const body = blockOf(source, constant);
    if (body === null) return null;
    const out = {};
    for (const [, key, value] of body.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) out[key] = value;
    return out;
}

function stringSetFrom(source, constant) {
    const body = blockOf(source, constant);
    if (body === null) return null;
    return [...body.matchAll(NAME_RE)].map((m) => m[1]);
}

/**
 * The five maps as generate-npc.py declares them. A map that cannot be found
 * is null rather than {} - the caller must not offer an editor over a guess,
 * and must not write an empty map that would erase the generator's own.
 */
function defaultGatesFrom(pythonSource) {
    return {
        roleCategories: stringDictFrom(pythonSource, 'ROLE_CATEGORIES'),
        roleLocks: tupleDictFrom(pythonSource, 'ROLE_LOCKS'),
        backdropRoles: tupleDictFrom(pythonSource, 'BACKDROP_ROLES'),
        weaponRoles: tupleDictFrom(pythonSource, 'WEAPON_ROLES'),
        unaffiliatedRoles: stringSetFrom(pythonSource, 'UNAFFILIATED_ROLES'),
    };
}

/**
 * The effective gates for a tables file: its sidecar's maps over the Python
 * defaults. `overridden` lists which keys came from the sidecar, so the panel
 * can say so and offer a reset. A sidecar that cannot be read is reported in
 * `error` and ignored, which is what the generator would refuse to roll with -
 * the panel shows the defaults and the message rather than nothing.
 */
function readGates(tablesPath, pythonSource) {
    const gates = defaultGatesFrom(pythonSource || '');
    const sidecar = gatesPathFor(tablesPath);
    const overridden = [];
    let error;
    if (fs.existsSync(sidecar)) {
        try {
            const data = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                throw new Error('not a JSON object');
            }
            for (const key of GATE_KEYS) {
                if (key in data) {
                    gates[key] = data[key];
                    overridden.push(key);
                }
            }
        } catch (err) {
            error = `${path.basename(sidecar)} could not be read (${err.message}); showing the generator's defaults`;
        }
    }
    return { gates, overridden, error };
}

function isStringArray(value) {
    return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Every reason `gates` cannot be written, as messages, or [] when it can.
 *
 * `roles` are the live Role bullets (flag-stripped) and `buckets` the
 * category names that exist - a gate may admit either, and a name that is
 * neither would admit nobody, silently, which is the failure the generator's
 * own test_role_lock.py exists to catch after the fact. Checked here instead,
 * before the write.
 */
function validateGates(gates, { roles, buckets }) {
    const errors = [];
    if (!gates || typeof gates !== 'object' || Array.isArray(gates)) return ['gates must be an object'];
    const roleSet = new Set(roles);
    const bucketSet = new Set(buckets);
    const admitted = (key, flag, names) => {
        for (const name of names) {
            if (!roleSet.has(name) && !bucketSet.has(name)) {
                errors.push(`${key}.${flag} names "${name}", which is neither a Role in the tables nor a category`);
            }
        }
    };
    for (const [key, value] of Object.entries(gates)) {
        if (!GATE_KEYS.includes(key)) {
            errors.push(`"${key}" is not a gate map the generator reads`);
            continue;
        }
        if (key === 'unaffiliatedRoles') {
            if (!isStringArray(value)) { errors.push('unaffiliatedRoles must be a list of Role names'); continue; }
            for (const name of value) {
                if (!roleSet.has(name)) errors.push(`unaffiliatedRoles names "${name}", which is not a Role in the tables`);
            }
            continue;
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            errors.push(`${key} must be an object`);
            continue;
        }
        if (key === 'roleCategories') {
            for (const [role, bucket] of Object.entries(value)) {
                if (typeof bucket !== 'string' || !bucket.trim()) {
                    errors.push(`roleCategories."${role}" must name one category`);
                } else if (!roleSet.has(role)) {
                    errors.push(`roleCategories names "${role}", which is not a Role in the tables`);
                }
            }
            continue;
        }
        for (const [flag, names] of Object.entries(value)) {
            if (!FLAG_RE.test(flag)) {
                errors.push(`${key}: "${flag}" is not a flag the tables file can carry (one lowercase word)`);
                continue;
            }
            if (!isStringArray(names)) {
                errors.push(`${key}.${flag} must be a list of Role or category names`);
                continue;
            }
            admitted(key, flag, names);
        }
    }
    return errors;
}

/**
 * The gate flags as a flag vocabulary, keyed by base table, for
 * lib/tableFlags.js's `extra` parameter: each gate flag becomes a checkbox on
 * the table it gates, glossed with who it admits right now. That is how a
 * gate defined on the panel is offered on the bullets a moment later, and
 * how the set-flag route accepts it.
 */
function gateFlagVocabulary(maps) {
    const out = {};
    for (const [table, key] of Object.entries(GATE_TABLES)) {
        const map = maps && maps[key];
        if (!map || typeof map !== 'object') continue;
        const glossed = {};
        for (const [flag, names] of Object.entries(map)) {
            const who = Array.isArray(names) && names.length ? names.join(', ') : 'nobody';
            glossed[flag] = key === 'weaponRoles'
                ? `Gate: ${who} can roll ONLY bullets carrying this flag.`
                : `Gate: only ${who} can roll a bullet carrying this flag.`;
        }
        if (Object.keys(glossed).length) out[table] = glossed;
    }
    return out;
}

/** Writes the whole sidecar. Callers validate first; this only serialises. */
function writeGates(tablesPath, gates) {
    const out = {};
    for (const key of GATE_KEYS) if (key in gates) out[key] = gates[key];
    fs.writeFileSync(gatesPathFor(tablesPath), `${JSON.stringify(out, null, 2)}\n`);
    return gatesPathFor(tablesPath);
}

module.exports = {
    GATE_KEYS, GATE_TABLES, gatesPathFor, defaultGatesFrom, readGates, validateGates, writeGates,
    gateFlagVocabulary,
};
