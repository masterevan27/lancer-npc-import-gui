# Art styles and Secret mode

## Prompt composer

On **Create NPC** in Secret mode, the Prompt composer updates as you change
trait overrides, art style, colour guidance, enabled secret tables, and disabled
default tables. Choose **Portrait** or **Token** to arrange each prompt separately.
Colored pills name their source tables; dashed pills contain the generator's
connecting prose. Unfixed values show **Random value from [table]**.

Drag a pill by its grip, use its arrow buttons, or focus the grip and press the
left/right arrow keys. **Add your text** inserts a movable, editable snippet;
its text is used literally, including braces. **Read as a prompt** shows the
resulting sequence. **Reset portrait/token** restores that image's original
order and removes its custom text. Review the connecting prose after moving
snippets, since reordering sentence pieces can change their grammar.

**Save current as secret preset** saves both orders and custom text with the
table selections. Generated records also retain them for regeneration and trait
rerolls. Unselected tables disappear from the preview but keep their saved
positions if enabled again. Newly appearing fragments are appended after the
saved sequence. Names, callsigns, and Theme do not add direct prompt text.

The preview uses a sample roll to apply the generator's conditional rules;
random values remain placeholders. Weather, headgear, glow and similar fragments
can change with the final roll. Set a seed and fixed values for a reproducible
composition. Previewing does not render images or write generation records.
This feature requires the companion generator version with `--prompt-preview`
and `--prompt-layout` support. Preview and custom composition are available only
after Secret login, and leaving Secret clears the composer.

The generator owns `art-styles.json`, next to `generate-npc.py`. Set `artStylesPath` in GUI `config.json` to use a different catalog. Records have `id`, `name`, `prompt`, and optional boolean `hidden` (or `secret`). The reserved `default` and `none` styles are always present, even with missing/blank catalogs; malformed catalogs fail validation. Default preserves the original prompts. **None (no art style)** removes house rendering clauses and adds no `Art style:` suffix. Custom prompts may be empty or whitespace-only for the same effect; names must remain nonblank. Hidden records are only returned after Secret login. Prompt text is never part of the style-list response.

The colour guidance catalog (`color-guidance.json`, override with `colorGuidancePath`) follows the same rules under a `guidance` key and is served by `/api/color-guidance`. The reserved `default` and `none` entries are always present; **None (no colour guidance)** omits the palette sentence from the prompt. It applies to NPC creation and regeneration only; hidden entries likewise require Secret login.

Choose styles in the NPC, spaceship, or background creation form. Cards and image
details show the recorded style. Marking a previously public style hidden excludes
its recorded images from public GUI lists and image routes. This does not relocate
old files or retract copies already exported to another application.

## Configure credentials

Credentials are separate from the Foundry importer's `secret`. No usable credentials ship with the GUI. In PowerShell 7, generate a salted password hash without including the password in command history:

```powershell
$secretPassword = Read-Host 'Secret password' -MaskInput
$secretPassword | node scripts/hash-secret-password.js
Remove-Variable secretPassword
```

Copy the hash into `config.json` and choose a username:

```json
{
  "secretMode": {
    "username": "your-chosen-name",
    "passwordHash": "paste-the-generated-scrypt-hash-here",
    "sessionMinutes": 60
  },
  "secretImagesDir": "G:/PrivateLancerImages"
}
```

Merge these keys into the existing configuration, then restart the GUI server. The default session lasts one hour, with configurable bounds of 1 minute to 24 hours. Login uses a server-held, expiring HttpOnly/SameSite cookie; Leave Secret invalidates that browser session. Failed logins are rate limited. Invalid or missing credentials disable login.

## Private storage and generation

Use a separate absolute storage directory, outside Foundry, SillyTavern, public output, staged references, presets, and the web root. The authenticated Settings dialog can change it immediately after active private jobs finish. Old roots remain recorded in `secretImageRoots` so their files continue to be excluded from public routes after a restart. Changing storage does not move existing images.

Private NPCs and ships use `manifest.json` under this root and their own `npcs/` and `spaceships/` trees. Backgrounds use `backgrounds/`. Every Secret generation is private, including Default and other public styles. Private job status, logs, images, and metadata require a current session and use `Cache-Control: no-store`. Private entries cannot be imported into Foundry or SillyTavern. Public path/settings changes cannot point at private storage. Normal settings writes require Secret authentication once credentials or private storage exist; if credentials are removed, restore them by editing the server config to regain settings access.

The generator receives `--art-style`, `--art-styles`, `--secret`, and `--secret-config` and must be updated together with the GUI. Private ComfyUI output uses a separate prefix. ComfyUI itself remains an operator-controlled backend with its own output/history access; the GUI session does not protect direct access to that service. Keep it accessible only to trusted operators. For network access, serve the GUI through HTTPS and a same-origin reverse proxy; do not expose the backend or private folder as static files.

Private browsing and creation are available; public-item editing, animation, and import controls are disabled while in Secret mode. Return to normal mode to use those public operations.

### Custom image dimensions

In Secret mode, **Create NPC** and **Create Spaceship** offer optional portrait
and token width/height fields. For a landscape portrait and square token, set
portrait width `1920`, height `1080`, and token width/height `1024`.
Set both fields in each pair; each must be a multiple of 8 from 64 to 8192.
Blank token fields follow the portrait size when set, otherwise the usual token
size. Token dimensions can also be set on their own. Leave all fields blank for
the usual portrait and token sizes. Background creation has its own size controls.

Secret NPC presets save these fields, and generated NPCs and ships retain the
sizes for regeneration. Older presets keep their shared-size behavior.
Update the companion generator together with the GUI for the `--token-width`
and `--token-height` flags. Custom sizes require a workflow with an
editable latent canvas; any additional resizing built into a custom workflow
still applies.

For an HTTPS reverse proxy, configure `publicOrigin` to the exact external origin, such as `https://lancer.example`. This enables HTTPS origin validation and Secure session cookies without trusting spoofable `X-Forwarded-*` request headers. Leave it blank for direct localhost HTTP use. Restart after changing this setting.

See [validation results and remaining verification limits](secret-mode-validation.md).

## Secret tables and disabled default tables

`secretTablesDir` (default `secret-tables/` beside `npcTablesPath`, gitignored by the generator repo) holds roll tables of your own. Each file is either the generator's markdown shape or its JSON twin, told apart by extension:

`secretPromptsDir` (default a `secret-prompts/` sibling of `secretTablesDir`) holds your own `.md` secret prompt templates, offered as the **Secret prompt** select on **Create NPC** in Secret mode.

```markdown
## camera_framing

- x3 low angle looking up
- eye level medium shot
```

```json
{ "camera_framing": [ { "value": "low angle looking up", "weight": 3 }, { "value": "eye level medium shot" } ] }
```

### Tags and gates

A private table can be *gated*: it rolls only when a value rolled (or fixed)
earlier carries one of its tags.

```markdown
## Styles
- x2 Rugged dockworker #man
- x2 Elegant courtesan #woman #noble

## Men's Attributes (when: man)
- heavy stubble #scarred
- broad shoulders

## Scars (when: scarred)
- a burn scar across one cheek

## Jewellery (when: woman, noble)
- a thin gold circlet
```

- `#tag`s at the very end of a bullet are removed from the value and name the
  gates it opens (letters, digits, `-`, `_`; case-insensitive). Any trailing
  `#word` is a tag, digits included - `Jersey number #7` rolls as `Jersey
  number`; put such text earlier in the line or drop the space before the `#`.
- `(when: a, b)` at the end of a heading gates the table; it opens on *any*
  listed tag. The table's name is the heading without the suffix, so
  `--extra-value "Men's Attributes=broad shoulders"`.
- Tables roll in order: files in `--extra-tables` order, then tables in file
  order. A gated table above every table that could open it is refused; a tag
  no loaded file carries simply keeps the gate shut.
- Fixing a value in a gated table narrows its single Random opener to the
  values that open it; if no table, or more than one, could open it the run
  stops with a message saying which.
- JSON: `{"value": "...", "tags": ["man"]}` on a row, and
  `"Men's Attributes": {"when": ["man"], "rows": [...]}` for a gated table.

In Create NPC:

- Gated tables are indented under the file's tables and labelled `when: #man`.
- A gated table nothing selected can open (its opener is unticked, or fixed to
  a value without its tags) is greyed out and left out of the run.
- With its opener on Random, a gated table notes `rolls only if Styles rolls #man`.
  Fixing a value in it limits that opener to matching values.
- Selections that cannot happen, such as two fixed gated tables that need
  different values of the same opener, are refused with the generator's own
  message.
- **Roll order and gates**, a closed panel at the top of the section, lists
  every table in roll order with its gate, what its tags open, and its live
  status.
- The folder is checked as a whole: a gated table above its opener marks that
  file with the error. Each `when:` tag is checked individually, and a tag no
  table in the folder carries also marks the file - unless a file in the
  folder has an error, in which case that check is skipped, since the missing
  tag might be inside the unreadable file.

After Secret login, **Create NPC** lists every file with a checkbox per table (the file's own box ticks them all) and shows the row count beside each. A ticked table rolls one value per NPC by weight; the values are appended to both prompts as one sentence after the line naming what the NPC carries, recorded on the private manifest entry as `extraTraits`, shown on the detail sheet, and reproduced by Regenerate. Nothing ticked is an ordinary private roll. A file the generator would refuse - not valid JSON, a table with no rows, a weight that is not a positive number, a table named like a default one - is listed with its reason and cannot be selected. Markdown bullets are taken whole: `|| flag` and `=> Name` mean nothing to a private table.

**Disable default tables** offers an independent checkbox for every default NPC table, including Backdrop, Callsigns, Role, Age, Pronouns, Hair colour and Glow placement. Disabling is prompt-only: the trait is still rolled, so the filters that read it and the seed behave exactly as before, and the detail sheet marks it "left out of the prompt". Tick Stance when one of your tables describes the pose. Backdrop removes the rolled framing and scene, using neutral portrait framing; Hair colour removes its base and colour tail while keeping the hairstyle; Glow placement leaves the colour available with a generic glow description. Age removes maturity and face-age wording, and Pronouns uses neutral narration without the gender description. Names, callsigns and Theme already add no direct prompt text, so those switches preserve their metadata and roll dependencies. The choices come from the configured generator; update it alongside the GUI and restart the GUI server to see the expanded list.

Each enabled table has a value selector. Leave it on **Random (weighted)** to roll as before, or select an exact value to use for every NPC in the batch. The server checks that fixed values still belong to the selected tables. **Collapse secret tables** is available at both ends of the section; the top button expands it again. Collapsing preserves all selections, including disabled default tables.

In Markdown files, use `##` for a table and `###` for categories within its
value dropdown:

```markdown
## Female Portrait Poses

### Portrait Kneeling Poses
- x1 kneeling upright
- x1 kneeling on a soft carpeted floor

### Portrait Lying Down Poses
- x1 lying on a couch
```

Categories label groups of choices; choose an entry beneath a label to fix
its value. **Random (weighted)** still rolls across the entire table.
Entries before the first category remain available without a group label.
Empty categories are omitted, and each new `##` heading resets the category.
Existing Markdown and JSON tables continue to work as before.

Each table has its own bordered card. Its enable checkbox and **Apply to:
Portrait / Token** controls share the card header, with its value dropdown
and full selected text directly underneath.

Value selectors stay within the form width. The full selected entry wraps below
its selector, so long descriptions remain readable on narrow screens.

The **Portrait** and **Token** checkboxes beside each table choose which image prompts receive its value. Both start ticked; untick either for a portrait-only or token-only table. An enabled table needs at least one target; use its main checkbox to turn the table off. A table used by both images rolls once and shares that value. Secret presets save these targets, and regeneration and trait rerolls preserve them. Older presets and NPCs use both images. Update the companion generator alongside the GUI for the `--extra-target` option.

**Secret presets**, below the section, saves the Create NPC recipe: count, seed, pronouns, generation switches, overrides, art style, workflow, color guidance, selected secret tables, fixed values, and disabled default tables. As with normal Create presets, the character name is not saved and loading never starts generation. Load restores the whole recipe; Delete removes the selected preset. Missing tables or values are reported when loading, rather than silently becoming random rolls.

Secret presets live in `presetsDir/secret-presets/`, normally `G:\GIT-REPOS\lancer-art-generator\prompts\presets\secret-presets`. The folder is created on the first save. They have a separate `secret-create-form` format and authenticated routes; normal preset lists and imports do not offer them.

These controls are Secret-mode only. The server refuses table selections on the public create path and resolves file names against its own folder listing. It passes the generator `--extra-tables`, `--extra-table`, `--extra-value TABLE=VALUE` and `--disable-table`; update the generator alongside the GUI. Normal Create presets do not store secret table selections.
# Workflow selection and private image editing

Creation and regeneration forms offer a Workflow selector alongside Art style.
The list comes from `workflows/api/` beside the configured NPC generator.
ComfyUI editor-format exports are excluded; use API-format JSON exports.
Files in `workflows/api/secret/` are automatically restricted to Secret mode.
Optional `workflows.json` beside the generator scripts can mark main-folder
files with `hidden: true` or `secret: true`. `UTIL_` workflows never appear.
Utility passes such as background removal and battlemap conversion keep their
own workflows. Default retains the generator's normal workflow behavior.

Secret NPC and spaceship detail sheets offer per-trait Re-roll controls.
These update traits and prompts; press Regenerate to render the changed art,
optionally selecting a different workflow, art style, image half, or seed.
Use Previous/Next or the arrow keys to browse the current filtered gallery,
and hover over a portrait or token to expand it. All these operations use
authenticated private routes and the private manifest.

To regenerate a saved dynamic background, open it on Create Background,
choose Load scene, select a workflow, and render the loaded scene again.
