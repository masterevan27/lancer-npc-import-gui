/**
 * The pure half of "which values could this trait take on this NPC".
 *
 * The legality is not computed here, and deliberately so - the same argument
 * lib/traitOdds.js makes for the odds, one question over. Working it out in
 * JavaScript would mean reimplementing generate-npc.py's filter chain, and the
 * two would drift silently: nothing would break, the list would simply stop
 * being true, which is the worst failure available for a control whose entire
 * job is to say what is possible.
 *
 * `generate-npc.py --trait-choices` runs the roller's own filters and prints
 * the answer as JSON. This module builds the command line, validates what
 * comes back, and keys the cache. The route hands the result to the client;
 * the client only renders it.
 *
 * See docs/superpowers/specs/2026-09-06-set-trait-value-picker-design.md.
 */

const crypto = require('crypto');

/** The argv for one query. Separate so a test can assert on it without spawning. */
function choicesArgs(scriptPath, manifestPath, npcId, trait) {
    if (!trait || typeof trait !== 'string') {
        throw new Error(`trait must be a non-empty string, got ${JSON.stringify(trait)}`);
    }
    if (!npcId || typeof npcId !== 'string') {
        throw new Error(`npcId must be a non-empty string, got ${JSON.stringify(npcId)}`);
    }
    return [scriptPath, '--regen-manifest', manifestPath,
        '--regen-id', npcId, '--trait-choices', trait];
}

const CHOICE_KEYS = ['value', 'heading', 'allowed', 'current', 'conflicts', 'releases'];

/**
 * The generator's stdout, checked into the shape the client is written against.
 *
 * Validated rather than trusted because a half-written stdout parses as
 * nothing, and a *changed* generator parses as something subtly wrong - a
 * choice list missing `releases` would render a checkbox promising to re-roll
 * an empty set. Better a visible error than a dialog that lies.
 *
 * Nothing here touches a value's text. The bullet is posted straight back to
 * --set-trait, which takes it verbatim, flags included, and those flags are
 * what the downstream filters read; tidying one here would change the NPC.
 */
function parseChoicesOutput(stdout) {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    } catch (err) {
        throw new Error(`--trait-choices did not print JSON: ${err.message}`);
    }
    if (!parsed || typeof parsed.trait !== 'string' || !Array.isArray(parsed.choices)
        || !Array.isArray(parsed.dependents)) {
        throw new Error('--trait-choices printed JSON of an unexpected shape');
    }
    for (const choice of parsed.choices) {
        for (const key of CHOICE_KEYS) {
            if (!choice || !(key in choice)) {
                throw new Error(`--trait-choices choice is missing "${key}"`);
            }
        }
    }
    return parsed;
}

/**
 * A cache key for one state of the tables file AND one state of the NPC.
 *
 * lib/traitOdds.js keys on the tables file alone, which is right for it: every
 * input to the odds lives in that file. This answer has a second input. A
 * regen rewrites the entry's raw bullets without touching the tables, so a key
 * over the file alone would hand back the legal values of the NPC as it was
 * before the last re-roll - stale in exactly the situation the picker is most
 * likely to be opened in, since re-rolling and then wanting to choose is the
 * whole reason this feature exists.
 *
 * The bullets are hashed rather than concatenated because rawTraits is two
 * dozen sentences, and sorted first so a re-serialised entry with the same
 * content keys the same.
 */
function cacheKeyFor(stat, item, trait) {
    const raw = item.rawTraits || {};
    const canonical = Object.keys(raw).sort().map((k) => `${k}=${raw[k]}`).join('\n');
    const fingerprint = crypto.createHash('sha1').update(canonical).digest('hex').slice(0, 16);
    return `${stat.mtimeMs}:${stat.size}:${item.id}:${trait}:${fingerprint}`;
}

module.exports = { choicesArgs, parseChoicesOutput, cacheKeyFor };
