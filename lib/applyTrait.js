/**
 * The pure half of "apply one trait edit to the stored NPC and render nothing".
 *
 * The same division lib/traitChoices.js makes, one verb over. A staged edit is
 * `generate-npc.py --apply-only`: it re-rolls or pins a single trait, writes
 * the result back onto the manifest entry, marks the stored art stale and
 * prints the updated traits as JSON. This module builds the command line and
 * checks what comes back; the route does the spawning.
 *
 * The manifest entry is the accumulator - there is no pending-edit map here or
 * in the server. Each click reads the entry the last click wrote, so a run of
 * edits composes by construction and the trait-choices query, the cascade
 * report and every filter stay true across the whole sequence. Rendering stays
 * where it was: the Regenerate button, which now draws the NPC the entry
 * already describes.
 *
 * See docs/superpowers/specs/2026-09-06-trait-editing-fixes-design.md.
 */

/** The argv for one staged edit. Separate so a test can assert on it without spawning. */
function applyArgs(scriptPath, manifestPath, npcId, { op, table, value, release, seed }) {
    if (!npcId || typeof npcId !== 'string') {
        throw new Error(`npcId must be a non-empty string, got ${JSON.stringify(npcId)}`);
    }
    if (!table || typeof table !== 'string') {
        throw new Error(`table must be a non-empty string, got ${JSON.stringify(table)}`);
    }
    if (!Number.isInteger(seed)) {
        throw new Error(`seed must be an integer, got ${JSON.stringify(seed)}`);
    }
    const args = [scriptPath, '--regen-manifest', manifestPath,
        '--regen-id', npcId, '--apply-only',
        // A draw seed, not the entry's seed. --apply-only never writes it: the
        // entry's `seed` describes the noise of the STORED image, and a staged
        // edit does not make an image. Without a fresh one here, re-rolling the
        // same trait twice would draw the same value both times, because the
        // generator falls back to the entry's recorded seed.
        '--new-seed', String(seed)];
    if (op === 'reroll') {
        args.push('--reroll-trait', table);
    } else if (op === 'set') {
        if (!value || typeof value !== 'string') {
            throw new Error(`value must be a non-empty string to set a trait, got ${JSON.stringify(value)}`);
        }
        // Verbatim, flags and all. The bullet came off --trait-choices and goes
        // back to --set-trait untouched; the flags after '||' are what the
        // downstream filters read, so tidying one here would change the NPC.
        args.push('--set-trait', `${table}=${value}`);
        if (release && release.length) args.push('--release', release.join(','));
    } else {
        throw new Error(`op must be "reroll" or "set", got ${JSON.stringify(op)}`);
    }
    return args;
}

const APPLY_KEYS = ['id', 'traits', 'artStale'];

/**
 * The generator's stdout, checked into the shape the route answers with.
 *
 * Validated for the reason parseChoicesOutput is, plus one this path has of
 * its own: --apply-only's diagnostics ("re-rolled Hair: ...", the cascade
 * report) go to stderr precisely so stdout stays parseable, and a generator
 * that ever prints one of them here would arrive as a JSON.parse failure. That
 * is worth naming loudly rather than swallowing into an empty trait table.
 */
function parseApplyOutput(stdout) {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    } catch (err) {
        throw new Error(`--apply-only did not print JSON: ${err.message}`);
    }
    for (const key of APPLY_KEYS) {
        if (!parsed || typeof parsed !== 'object' || !(key in parsed)) {
            throw new Error(`--apply-only output is missing "${key}"`);
        }
    }
    if (!parsed.traits || typeof parsed.traits !== 'object' || Array.isArray(parsed.traits)) {
        throw new Error('--apply-only printed traits that are not an object');
    }
    return parsed;
}

module.exports = { applyArgs, parseApplyOutput };
