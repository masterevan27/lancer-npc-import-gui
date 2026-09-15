# Dynamic backgrounds and battlemaps

On **Create Background**, choose **Dynamic traits**. Pick an environment, then
**Randomize unlocked** to roll a scene without starting ComfyUI. Each trait has a
picker, a lock and a reroll button. **Update preview** uses the displayed seed;
**Randomize unlocked** and individual rerolls choose a fresh seed. Layout notes
add your own requirements to the scene.

### Scene life

**Populate with people** starts enabled. Choose **Sparse**, **Natural** (default)
or **Lively** population. People have everyday activities, varied heights, builds,
faces, hair, skin tones, sexes and clothing. Prompts favor young adults (median
around 20–25) alongside some older adults, with children exceptionally rare.
Uniforms may match; individual appearances should remain distinct. These are
directions to the image model, so generated crowd sizes and appearances can vary.

**Vegetation** starts at **Balanced**, with **Lush** and **Off** options. Outdoors,
the choices include wild plants, large trees, medium and small shrubs, orchids,
flowers and cultivated large/medium bonsai. Indoors, they include potted plants,
orchids and small bonsai. **Indoor pets & aquariums** starts enabled and chooses
a small cat, cute dog, fox or fish tank. Use the **Vegetation**, **Interior life**
and **Activity** trait pickers below to choose, omit, lock or reroll details.
The prompt gives the setting priority: abandoned scenes use sparse visitors,
and pets or tanks are omitted in sterile, hazardous or unattended locations.

Changing a setting marks the preview as needing an update; **Render scenes**
always applies the current settings. Disabled features retain their chosen traits
for when you turn them back on. Space disables greenery and indoor life and uses
suited workers. Top-down views disable people and pets, keeping planting as terrain
and cover. Switching back restores your choices. Scene-life settings are saved
beside each image and restored by **Load saved traits**; older scenes load with
the new additions off. Animation prompts retain people's identities and use small
gestures, with gentle movement for existing pets or fish.

These controls apply to **Dynamic traits**. **Bespoke catalogue** continues to
render its authored prompts.

**Render scenes** uses the first preview and rolls unlocked traits for additional
scenes. Lock all for seed variations of the same scene; unlock selected traits
for new combinations. A fixed seed, unchanged pools and the same selected traits
produce reproducible prompts. **Animate generated scenes** uses each scene's own
compatible motion prompt. A still render and its subsequent animation report
their outcomes separately.

Choose **Bespoke catalogue** to keep using authored scene prompts. Both modes
appear in the same gallery. Click a generated scene and **Load saved traits** to
restore its choices and seed, initially all locked. Generation metadata lives in
`<image stem>.background.json` beside each image.

**Tables → Backgrounds** edits `prompts/background-generator-tables.md` in the
generator project. Entries can be enabled, disabled and weighted using the
existing editor. Use **Refresh pools** in Create Background after editing tables.
The generator validates context flags and rejects incompatible pinned choices;
an empty eligible pool produces an explanatory error rather than an unrelated
fallback. Changing the environment clears incompatible choices and their locks.
Changing Weather/Motion or Time/Lighting releases the related trait when it is
unlocked. Locked conflicts must be resolved explicitly in the pickers. Top-down
previews omit sky, distant features and animation motion from the prompt.

To create an orthographic map, select **Top-down battlemap** in the scene form,
or open an existing background and use **Create battlemap**. The add-on uses that
image as a reference and saves a separate PNG. Width, height, seed and optional
layout notes control the new map. Maps omit a baked-in grid so Foundry can supply
its own square or hex grid; they are images, not automatically configured Foundry
Scenes or wall data. Open/download the map and use it as a Foundry Scene background.
The image model interprets unseen geometry; a perspective source does not encode
an exact floor plan. The add-on requires the Qwen image-edit models used by the
generator's existing expression workflow. Deleting a source through the Import
page also deletes its scene metadata and associated maps.

The GUI derives these optional config values automatically:

| Key | Default |
| --- | --- |
| `generateBackgroundScript` | `generate-background.py` beside the NPC generator |
| `dynamicBackgroundTablesPath` | `background-generator-tables.md` beside the NPC tables |
| `backgroundPresetsDir` | `backgrounds/` under the table presets directory |

The existing `backgroundTablesPath` still controls the bespoke animation pool.
`backgroundsDir` remains the shared image output/gallery directory.
