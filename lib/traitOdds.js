/**
 * The pure half of "how often does this bullet actually get rolled".
 *
 * The odds themselves are not computed here, and deliberately so. Working
 * them out would mean reimplementing generate-npc.py's filter chain in
 * JavaScript, and the two would drift silently - nothing would break, the
 * percentages would simply stop being true. `generate-npc.py --trait-odds`
 * samples its own roller instead and prints the answer as JSON; this module
 * builds the command line, validates what comes back, and keys the cache.
 *
 * The same reasoning put REQUIRED_TABLES in overrideTables.js rather than in
 * a list of our own: where the generator already knows something, ask it.
 *
 * See docs/superpowers/specs/2026-09-04-trait-roll-odds-display-design.md.
 */

/** The argv for one odds run. Separate so a test can assert on it without spawning. */
function oddsArgs(scriptPath, samples) {
    if (!Number.isInteger(samples) || samples < 1) {
        throw new Error(`traitOddsSamples must be a whole number of 1 or more, got ${samples}`);
    }
    return [scriptPath, '--trait-odds', String(samples)];
}

/**
 * A cache key for one state of the tables file.
 *
 * mtime and size together, rather than hashing the contents: every input to
 * the odds lives in that one file, so a stat is enough to know the answer is
 * stale. Size is in there because a same-millisecond rewrite is not
 * far-fetched - the weight editor debounces to 400ms but a preset apply
 * rewrites many bullets in one pass.
 *
 * Takes the stat rather than the path so the caller decides how to handle a
 * missing file, and so this stays synchronous and testable.
 */
function cacheKeyFor(stat) {
    return `${stat.mtimeMs}:${stat.size}`;
}

/**
 * The generator's stdout -> { samples, tables }, or a thrown error saying why not.
 *
 * Strict about the shape rather than trusting it: this is parsed straight into
 * percentages shown to someone tuning their tables, and a silently malformed
 * response would show up as plausible-looking wrong numbers. A thrown error
 * becomes an `ok: false` reason the page can display instead.
 */
function parseOddsOutput(stdout) {
    const text = String(stdout).trim();
    if (!text) throw new Error('generate-npc.py --trait-odds printed nothing');

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        // The first line is far more useful than the parser's offset - a
        // Python traceback or a stray warning is immediately recognisable.
        throw new Error(`could not parse --trait-odds output as JSON (${text.split('\n')[0].slice(0, 200)})`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('--trait-odds output was not a JSON object');
    }
    if (!Number.isFinite(parsed.samples) || parsed.samples < 1) {
        throw new Error('--trait-odds output has no usable "samples" count');
    }
    if (!parsed.tables || typeof parsed.tables !== 'object' || Array.isArray(parsed.tables)) {
        throw new Error('--trait-odds output has no "tables" object');
    }
    for (const [table, bullets] of Object.entries(parsed.tables)) {
        if (!bullets || typeof bullets !== 'object' || Array.isArray(bullets)) {
            throw new Error(`--trait-odds output: "${table}" is not an object of bullets`);
        }
        for (const [bullet, probability] of Object.entries(bullets)) {
            if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
                throw new Error(`--trait-odds output: "${table}" / "${bullet.slice(0, 60)}" is not a probability`);
            }
        }
    }
    return { samples: parsed.samples, tables: parsed.tables };
}

module.exports = { oddsArgs, cacheKeyFor, parseOddsOutput };
