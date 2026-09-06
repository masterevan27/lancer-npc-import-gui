/**
 * The `||` flag vocabulary of npc-generator-tables.md, per table.
 *
 * Two separate things live here, and conflating them is how a flag editor
 * corrupts the file:
 *
 *   1. WHERE a table keeps its flags. Most bullets are `text || flags`, but
 *      Backdrop, Hair colour and Faction are `a || b || flags` - two segments
 *      of prose and a third of flags. Writing flags into the second segment of
 *      one of those would overwrite a Backdrop's scene sentence, a Hair
 *      colour's tail or a Faction's visual, all of which reach the prompt.
 *      This mirrors generate-npc.py's flags_for()/split_backdrop()/
 *      split_hair_colour()/split_faction() exactly; if that list ever grows,
 *      THREE_SEGMENT_TABLES has to grow with it.
 *
 *   2. WHICH flags mean anything on a given table. The generator matches flags
 *      literally and ignores an unrecognized one rather than reporting it, so
 *      `|| Figure` or `|| hand` reads as no flag at all - a mistake that fails
 *      quietly in the render rather than loudly at the console. That is the
 *      argument for a checkbox per known flag instead of a free-text box.
 *
 * A theme tag (`@neosamurai`) is deliberately NOT modelled here. It is a
 * different kind of thing - an open set the tables file grows freely, read on
 * seven tables - and the editor leaves any it finds untouched rather than
 * offering to toggle it. See splitBulletFlags() for how they are preserved.
 */

/**
 * Tables whose bullets carry `a || b || flags` rather than `text || flags`.
 *
 * Kept as a literal set rather than inferred from segment count, because the
 * count is not a reliable signal: a two-segment Backdrop bullet has a scene
 * and NO flags, and guessing from arity would read that scene as a flag list.
 */
const THREE_SEGMENT_TABLES = new Set(['Backdrop', 'Hair colour', 'Faction']);

/** How many `||`-separated prose segments a table's bullets carry before flags. */
function proseSegments(tableName) {
    return isThreeSegment(tableName) ? 2 : 1;
}

/**
 * The behavioural flags each table actually reads, with the one-line gloss the
 * GUI shows on hover.
 *
 * Sourced from the `||` conventions section of npc-generator-tables.md. A
 * table absent from here has no flag vocabulary and gets no checkboxes - which
 * is the correct treatment for Skin, Eyes, Demeanor, Glow colour, Height and
 * the name tables, whose bullets carry no `||` segment at all and whose text
 * is dropped into the prompt exactly as written. A stray `|| updo` under
 * `## Eyes` would ship the literal text to the image model.
 */
const TABLE_FLAGS = {
    'Role': {
        mil: 'An active-duty military or paramilitary occupation.',
    },
    'Age': {
        young: 'A teenager - drops the adult-figure Build bullets.',
    },
    'Build (she)': {
        figure: "Describes an adult woman's figure; never pairs with a 'young' Age.",
    },
    'Hair': {
        updo: 'Mass sits on top of the skull - a topknot, high ponytail, space buns. Dropped under a helmet or a crowning hat.',
        covered: 'The cut names something WORN - a headscarf, a cap. Forces the Headgear roll to the bare bullet.',
    },
    'Hair colour': {
        older: 'A shade that reads as age - restricted to older Age rolls.',
    },
    'Headgear': {
        hardtech: 'Modern head technology - helmets, visor and sensor rigs, breather masks, anything cabled. Dropped by a notac Outfit.',
        helmet: 'The head is actually INSIDE a helmet. Drops updo Hair and carried-helmet Gear.',
        crown: 'Sits ON TOP of the skull without enclosing it - any hat or cap, a wide brim, a rig clamped over the crown. Drops updo Hair only.',
        bare: 'The single bullet that leaves the head uncovered. Exactly one bullet should carry it.',
    },
    'Outfit': {
        civ: 'Plainly civilian dress. Dropped for a mil Role.',
        mil: 'An issued uniform. Dropped for a civilian Role.',
        notac: 'Elaborate or traditional dress that must not pair with mil Weapon/Gear or hardtech Headgear.',
        dressy: 'Ceremonial, formal or finely made. Dropped for a Role whose work is manual or dirty.',
    },
    'Faction': {
        civ: 'A civilian affiliation. Dropped for a mil Role.',
        mil: 'A military affiliation. Dropped for a civilian Role.',
        dressy: 'Finely made - keeps its place for a plain Role but loses its visual segment.',
        palette: 'The faction asserts colours of its own, so glow reads as the only OTHER saturated colour.',
    },
    'Weapon': {
        weapon: 'An actual weapon, as opposed to merely military-issue equipment.',
        simple: 'A weapon small and pocketable - a knife, one holstered pistol.',
        sidearm: 'Includes a holstered or openly worn pistol. A mil Role is restricted to these.',
        blade: "An edged weapon. A Role named in WEAPON_ROLES can reach nothing else - this outranks 'sidearm'.",
        gun: 'An actual firearm held in hand.',
        hands: 'Occupies at least one hand or arm.',
        mil: 'Military-issue. Dropped by a notac Outfit.',
        none: 'The single empty bullet - how an NPC rolls unarmed. Read directly by the Stance filter.',
    },
    'Gear': {
        hands: 'Occupies at least one hand or arm. Yields to a hands Weapon.',
        mil: 'Military-issue equipment. Dropped by a notac Outfit.',
        helmet: 'A helmet CARRIED rather than worn. Dropped when the Headgear roll is a worn helmet.',
        admin: 'A role lock - reachable only by a colonial administrator. The one hard filter in the tables.',
    },
    'Stance': {
        hands: 'The pose needs both hands free.',
        armed: 'The pose references a weapon of any kind. Unreachable when the Weapon roll came up empty.',
        gun: 'The pose describes aiming, firing or handling a firearm.',
    },
    'Glow placement': {
        scene: 'The light is out in the environment, so it needs a Backdrop that casts it.',
    },
    'Weather': {
        clear: 'No weather at all - the bullet that leaves the scene dry.',
    },
    'Backdrop': {
        nogear: "The scene already puts something in the subject's hands.",
        weather: 'Outdoors, so a Weather roll can land in it.',
        cockpit: 'Occupation gate: at a flight station or in pilot gear. Pilots.',
        ownmech: "Occupation gate: the machine in the scene is the subject's own. Pilots.",
        mechwork: 'Occupation gate: hands on the machine. Pilots, Technicians, Laborers.',
        mechyard: "Occupation gate: inside a machine's reach without working on it. Pilots, Technicians, Laborers.",
        warzone: 'Occupation gate: a war engine fighting, or its wreck. Pilots, Soldiers, Criminals, Laborers.',
        frontline: 'Occupation gate: the subject is fighting. Pilots, Soldiers, Criminals.',
        vacuum: 'Occupation gate: a sealed EVA suit in vacuum. Pilots, Technicians, Support.',
        swordwork: 'Occupation gate: a drawn or worn blade as the weapon of record. Soldiers, Criminals.',
        deskwork: 'Occupation gate: operating a command, plot or watch station. Every bucket but Laborers and Technicians.',
        ceremony: 'Occupation gate: the subject presides. Pilots, Soldiers, Officials, Criminals.',
        inspection: 'Occupation gate: an inspection or survey. Officials, Technicians.',
        salvage: 'Occupation gate: breaking down or recovering wreckage. Laborers, Technicians, Criminals.',
        clergy: 'Occupation gate: a rite or congregation. The scavenger-priest.',
        medic: 'Occupation gate: triage or a clinic. The field medic.',
        barkeep: 'Occupation gate: behind the bar. The bar owner.',
    },
};

/**
 * A heading's base table name: 'Hair (she) +' -> 'Hair'.
 *
 * Duplicated from lib/tableGroups.js rather than imported, to keep this module
 * dependency-free - it is required by both the server and, in spirit, mirrored
 * in public/app.js.
 */
function baseNameOf(name) {
    const paren = String(name).indexOf(' (');
    return paren === -1 ? String(name) : String(name).slice(0, paren);
}

/**
 * The flags a table reads, resolving a pronoun variant to its base table.
 *
 * '<Table> (she) +' is ADDED to the shared pool rather than replacing it, so
 * its bullets are drawn from the same roll and read by the same filters - a
 * flag readable on 'Headgear' is readable on 'Headgear (she) +'. Deriving that
 * rather than listing each variant is what stops the two from drifting: the
 * first version of this module listed Hair, Outfit and Stance variants by hand
 * and simply forgot 'Headgear (she) +', which is where the wide woven hat that
 * prompted the 'crown' flag actually lives - so the one bullet the feature was
 * built for would have been the one bullet with no checkboxes.
 */
function flagsFor(tableName) {
    return TABLE_FLAGS[tableName] || TABLE_FLAGS[baseNameOf(tableName)] || null;
}

/** Every flag name the GUI knows about for a table, variants included. */
function knownFlags(tableName) {
    return Object.keys(flagsFor(tableName) || {});
}

/** Whether this table has any flag vocabulary at all. */
function hasFlags(tableName) {
    return knownFlags(tableName).length > 0;
}

/**
 * Segment arity follows the base table too: 'Hair colour (she) +' is three
 * segments exactly as 'Hair colour' is.
 */
function isThreeSegment(tableName) {
    return THREE_SEGMENT_TABLES.has(tableName)
        || THREE_SEGMENT_TABLES.has(baseNameOf(tableName));
}

/**
 * A bullet's text -> { body, flags, themes }.
 *
 * `body` is every prose segment, rejoined with ' || ' exactly as it was, so a
 * Backdrop keeps its shot AND its scene. `flags` are the behavioural flags;
 * `themes` are the `@tag` ones, split out so the editor can rewrite the
 * former while preserving the latter untouched.
 *
 * A bullet with fewer segments than its table's prose arity has no flags at
 * all - a two-segment Backdrop is a shot and a scene, not a shot and a flag
 * list - which is exactly the reading generate-npc.py's splitters take.
 */
function splitBulletFlags(tableName, text) {
    const prose = proseSegments(tableName);
    const parts = String(text).split('||').map((p) => p.trim());
    const body = parts.slice(0, prose).join(' || ');
    const tokens = parts.length > prose
        ? parts.slice(prose).join(' ').split(/\s+/).filter(Boolean)
        : [];
    return {
        body,
        flags: tokens.filter((t) => !t.startsWith('@')),
        themes: tokens.filter((t) => t.startsWith('@')),
    };
}

/**
 * The inverse: { body, flags, themes } -> a bullet's text.
 *
 * Emits no `||` segment at all when nothing is left to put in it, so clearing
 * a bullet's last flag restores the plain line rather than leaving a dangling
 * ' || '. The one exception is a three-segment table, where a bullet that
 * already carries a prose tail keeps its separator count: `base || tail`
 * stays two segments when it has no flags.
 *
 * Theme tags are emitted last, matching how the live file is written.
 */
function joinBulletFlags(tableName, body, flags, themes = []) {
    const tokens = [...flags, ...themes];
    if (!tokens.length) return body;
    return `${body} || ${tokens.join(' ')}`;
}

/**
 * A bullet's text with one flag turned on or off.
 *
 * Rejects a flag the table does not read, rather than writing one that would
 * fail quietly in the render. Order within the flag segment is normalised to
 * the vocabulary's own order so a bullet's flags read consistently however
 * they were clicked - the generator matches them as an unordered set, so this
 * is purely for the file's legibility.
 */
function setBulletFlag(tableName, text, flag, on) {
    if (!knownFlags(tableName).includes(flag)) {
        return { ok: false, error: `"${flag}" is not a flag the ${tableName} table reads` };
    }
    const { body, flags, themes } = splitBulletFlags(tableName, text);
    const has = flags.includes(flag);
    if (has === Boolean(on)) return { ok: true, text: String(text) };
    const next = on ? [...flags, flag] : flags.filter((f) => f !== flag);
    const order = knownFlags(tableName);
    // Unknown flags are kept rather than dropped: this editor is not the only
    // thing that writes the file, and silently deleting a flag added by hand
    // ahead of the vocabulary would be a nasty surprise. They sort last.
    next.sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
    });
    return { ok: true, text: joinBulletFlags(tableName, body, next, themes) };
}

module.exports = {
    TABLE_FLAGS, THREE_SEGMENT_TABLES,
    baseNameOf, flagsFor, proseSegments, isThreeSegment, knownFlags, hasFlags,
    splitBulletFlags, joinBulletFlags, setBulletFlag,
};
