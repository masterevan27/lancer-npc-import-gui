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
function proseSegments(tableName, parents = {}) {
    return isThreeSegment(tableName, parents) ? 2 : 1;
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
        // Last, so the two bullets that carry it - one of them '|| civ
        // unaffiliated' - keep the order they are already written in.
        unaffiliated: 'Marks an entry that is NOT an affiliation. A marker, not a preference: nothing is dropped for it, and a Role whose own words say it works for nobody is cut to these bullets and nothing else.',
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
    // 'scene' is the reachability gate and the five below are PROP GATES,
    // which is why it is listed first: every flagged bullet in the live table
    // carries 'scene' and then one gate, and writing them in that order leaves
    // the existing lines byte-identical after an edit. The gates are matched
    // against the rolled Backdrop's scene sentence by PLACEMENT_REQUIRES - or,
    // for 'air', PLACEMENT_FORBIDS - in generate-npc.py.
    'Glow placement': {
        scene: 'The light is out in the environment, so it needs a Backdrop that casts it.',
        ground: 'Prop gate: the light pools on the floor, so the scene has to give the subject a verb that puts their weight on one - and must not be a weightless scene.',
        wall: 'Prop gate: an interior surface behind the subject - a corridor, a bay, an alley, a room.',
        air: 'Prop gate, inverted: the glow hangs as a haze, so the scene must NOT be hard vacuum, which has no atmosphere to scatter it.',
        screens: 'Prop gate: a stacked display wall - monitors, readouts, consoles, a board.',
        signage: 'Prop gate: a lit skyline - signage, neon, billboards.',
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
function flagsFor(tableName, parents = {}) {
    // Own name, then base name, then the table that references it as a
    // group: a '## Flight suits' Outfit enters through '- => Flight suits'
    // holds Outfit-shaped bullets and reads Outfit's flags. The map comes
    // from the caller because this module is deliberately file-blind.
    const own = TABLE_FLAGS[tableName] || TABLE_FLAGS[baseNameOf(tableName)];
    if (own) return own;
    const parent = parents[tableName] || parents[baseNameOf(tableName)];
    return parent ? flagsFor(parent, {}) : null;
}

/** Every flag name the GUI knows about for a table, variants included. */
function knownFlags(tableName, parents = {}) {
    return Object.keys(flagsFor(tableName, parents) || {});
}

/** Whether this table has any flag vocabulary at all. */
function hasFlags(tableName, parents = {}) {
    return knownFlags(tableName, parents).length > 0;
}

/**
 * Segment arity follows the base table too: 'Hair colour (she) +' is three
 * segments exactly as 'Hair colour' is.
 *
 * It also follows a GROUP's parent, the same one-level `parents` lookup
 * flagsFor() above uses, and for the same reason: a group referenced from a
 * three-segment table reads three-segment bullets, not one. '## Skies'
 * referenced from '## Backdrop' is neither in THREE_SEGMENT_TABLES nor named
 * 'Backdrop', so without this a Skies bullet's second prose segment - the
 * scene sentence itself - would be read and written as a flag list. Recursing
 * with a fresh, empty `parents` mirrors flagsFor()'s own recursion: a parent
 * name is always a referencing table's OWN base, never itself a group, so one
 * level is all the chain ever has.
 */
function isThreeSegment(tableName, parents = {}) {
    if (THREE_SEGMENT_TABLES.has(tableName) || THREE_SEGMENT_TABLES.has(baseNameOf(tableName))) {
        return true;
    }
    const parent = parents[tableName] || parents[baseNameOf(tableName)];
    return parent ? isThreeSegment(parent) : false;
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
 *
 * `parents` is optional and defaults to none, which is right for every
 * ordinary table - it only matters for a GROUP table, whose own name carries
 * no clue to its arity at all.
 */
function splitBulletFlags(tableName, text, parents = {}) {
    const prose = proseSegments(tableName, parents);
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
 *
 * A theme tag (`@grimdark`) skips the knownFlags() vocabulary gate entirely
 * and is toggled in the THEMES list instead of the flags one. It is
 * deliberately ungated for the same reason the module docstring gives for not
 * modelling it as a checkbox at all - it is an open set the tables file grows
 * freely - and a reference bullet's writer needs exactly this path: a
 * reference's only legal flag is a theme tag (see
 * lib/tableBullets.js's setBulletFlagInText, which refuses every other kind on
 * one), so refusing '@' here as "not a flag the table reads" would make that
 * one legal write impossible.
 */
function setBulletFlag(tableName, text, flag, on, parents = {}) {
    const isTheme = flag.startsWith('@');
    if (!isTheme && !knownFlags(tableName, parents).includes(flag)) {
        return { ok: false, error: `"${flag}" is not a flag the ${tableName} table reads` };
    }
    const { body, flags, themes } = splitBulletFlags(tableName, text, parents);
    if (isTheme) {
        const has = themes.includes(flag);
        if (has === Boolean(on)) return { ok: true, text: String(text) };
        const nextThemes = on ? [...themes, flag] : themes.filter((t) => t !== flag);
        return { ok: true, text: joinBulletFlags(tableName, body, flags, nextThemes) };
    }
    const has = flags.includes(flag);
    if (has === Boolean(on)) return { ok: true, text: String(text) };
    const next = on ? [...flags, flag] : flags.filter((f) => f !== flag);
    const order = knownFlags(tableName, parents);
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
