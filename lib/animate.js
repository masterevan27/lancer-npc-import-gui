/**
 * The pure half of the detail overlay's Animated portrait panel.
 *
 * Same split as lib/model3d.js and for the same reason: nothing here touches
 * the filesystem or spawns anything, so the argv the server builds for
 * animate-portrait.py, the two filenames it writes beside the portrait and
 * the description draw can all be asserted on without a Python interpreter,
 * a ComfyUI server or the three minutes a Wan render takes.
 *
 * What the panel remembers lives in a JSON sidecar beside the .webp rather
 * than in the manifest entry. generate-npc.py rewrites the whole manifest at
 * the end of a regen and a Create run, minutes after it read it, so a record
 * written there mid-run would be lost; a file in the NPC's own folder is
 * deleted with the folder (deleteItem) and copied with it (copyIntoFoundry)
 * and touched by nothing else.
 */

/** The heading in npc-generator-tables.md whose bullets are the prompts. */
const ANIMATION_TABLE = 'Animation';

/** The pseudo-trait the sheet shows the description under. */
const ANIMATION_TRAIT = 'Animation';

const SUFFIX = ' Animated Portrait';

/**
 * The name the two files are built from. The portrait's own filename minus
 * its ` Portrait.png`, when it has that shape, so whatever generate-npc.py's
 * _safe() did to the name for the portrait is done here too; the manifest
 * name otherwise.
 */
function animationBase(item) {
    const portrait = item && typeof item.portrait === 'string' ? item.portrait : '';
    const m = portrait.match(/^(.+) Portrait\.png$/i);
    return m ? m[1] : String((item && item.name) || '');
}

/**
 * The two files an animation is: the loop itself and the record of what made
 * it. Named from the NPC's own name the way `<Name> Portrait.png` is, so a
 * folder listing reads as one set.
 */
function animationFiles(npcName) {
    return { webp: `${npcName}${SUFFIX}.webp`, sidecar: `${npcName}${SUFFIX}.json` };
}

/**
 * The argv for one animate-portrait.py run. `-d` rather than `--roll`: the
 * draw happens here, where it can be shown, re-rolled and pinned before the
 * render is paid for, and the sidecar records exactly what was sent.
 *
 * Every field is required. The script defaults --out to beside the source
 * and --seed to a random one, but a run this server cannot name the output
 * of, or cannot record the seed of, is a run the panel cannot show.
 */
function animateArgs(scriptPath, { portrait, out, description, seed } = {}) {
    if (typeof portrait !== 'string' || !portrait) throw new Error('animateArgs needs the portrait path');
    if (typeof out !== 'string' || !out) throw new Error('animateArgs needs the output path');
    if (typeof description !== 'string' || !description) throw new Error('animateArgs needs a description');
    if (!Number.isInteger(seed) || seed < 0) throw new Error('animateArgs needs a non-negative integer seed');
    return [scriptPath, portrait, '--out', out, '-d', description, '--seed', String(seed)];
}

/**
 * The enabled bullets of the Animation table, from tableBullets.readTables'
 * output. Disabled bullets are left out - the Tables tab switched them off,
 * and offering one here would be the one place the switch did not reach.
 */
function descriptionsFrom(tables) {
    const table = (tables || []).find((t) => t.name === ANIMATION_TABLE);
    if (!table) return [];
    return table.bullets.filter((b) => b.enabled).map((b) => b.text);
}

/**
 * One description at random, not the one already showing when there is any
 * other to give. Clicking Re-roll and getting the same sentence back reads as
 * a button that did nothing; a pool of one is the only time it is honest.
 */
function pickDescription(descriptions, { exclude = null, random = Math.random } = {}) {
    const pool = (descriptions || []).filter(Boolean);
    if (!pool.length) return null;
    const others = pool.filter((d) => d !== exclude);
    const from = others.length ? others : pool;
    return from[Math.min(from.length - 1, Math.floor(random() * from.length))];
}

/**
 * The sidecar, parsed leniently. A missing or unreadable file is an empty
 * record rather than an error: the panel's first state is "no animation
 * yet", and a hand-deleted sidecar beside a surviving .webp should still show
 * the loop.
 */
function parseSidecar(text) {
    if (!text) return {};
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Whether the portrait has been re-rendered since the loop was made from it.
 *
 * The sidecar records the portrait's mtime at render time; a later mtime on
 * the portrait means Regenerate ran, and the loop is of a face that is no
 * longer on the sheet. Unknown either side is "not stale" - a sidecar from
 * before this field existed should not flag every old animation.
 */
function isStale(sidecar, portraitVersion) {
    const then = sidecar && sidecar.portraitVersion;
    if (typeof then !== 'number' || typeof portraitVersion !== 'number') return false;
    return portraitVersion > then;
}

module.exports = {
    ANIMATION_TABLE, ANIMATION_TRAIT, animationBase, animationFiles, animateArgs,
    descriptionsFrom, pickDescription, parseSidecar, isStale,
};
