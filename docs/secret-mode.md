# Art styles and Secret mode

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

For an HTTPS reverse proxy, configure `publicOrigin` to the exact external origin, such as `https://lancer.example`. This enables HTTPS origin validation and Secure session cookies without trusting spoofable `X-Forwarded-*` request headers. Leave it blank for direct localhost HTTP use. Restart after changing this setting.

See [validation results and remaining verification limits](secret-mode-validation.md).

## Secret tables and disabled default tables

`secretTablesDir` (default `secret-tables/` beside `npcTablesPath`, gitignored by the generator repo) holds roll tables of your own. Each file is either the generator's markdown shape or its JSON twin, told apart by extension:

```markdown
## camera_framing

- x3 low angle looking up
- eye level medium shot
```

```json
{ "camera_framing": [ { "value": "low angle looking up", "weight": 3 }, { "value": "eye level medium shot" } ] }
```

After Secret login, **Create NPC** lists every file with a checkbox per table (the file's own box ticks them all) and shows the row count beside each. A ticked table rolls one value per NPC by weight; the values are appended to both prompts as one sentence after the line naming what the NPC carries, recorded on the private manifest entry as `extraTraits`, shown on the detail sheet, and reproduced by Regenerate. Nothing ticked is an ordinary private roll. A file the generator would refuse - not valid JSON, a table with no rows, a weight that is not a positive number, a table named like a default one - is listed with its reason and cannot be selected. Markdown bullets are taken whole: `|| flag` and `=> Name` mean nothing to a private table.

**Disable default tables** offers an independent checkbox for every default NPC table, including Backdrop, Callsigns, Role, Age, Pronouns, Hair colour and Glow placement. Disabling is prompt-only: the trait is still rolled, so the filters that read it and the seed behave exactly as before, and the detail sheet marks it "left out of the prompt". Tick Stance when one of your tables describes the pose. Backdrop removes the rolled framing and scene, using neutral portrait framing; Hair colour removes its base and colour tail while keeping the hairstyle; Glow placement leaves the colour available with a generic glow description. Age removes maturity and face-age wording, and Pronouns uses neutral narration without the gender description. Names, callsigns and Theme already add no direct prompt text, so those switches preserve their metadata and roll dependencies. The choices come from the configured generator; update it alongside the GUI and restart the GUI server to see the expanded list.

Each enabled table has a value selector. Leave it on **Random (weighted)** to roll as before, or select an exact value to use for every NPC in the batch. The server checks that fixed values still belong to the selected tables. **Collapse secret tables** is available at both ends of the section; the top button expands it again. Collapsing preserves all selections, including disabled default tables.

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
