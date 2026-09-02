# Lancer NPC Import GUI

A local web tool for turning NPCs rolled by `generate-npc.py` (from the
`lancer-art-generator` repo — a local sibling clone, not a GitHub repository:
`G:\GIT-REPOS\lancer-art-generator`) into Foundry VTT Actors — and for
curating the roll tables that generator draws from — instead of hand-copying
files through Foundry's file picker and hand-editing markdown.

It is a companion to
[foundryvtt-to-sillytavern-nhp-uplink](https://github.com/masterevan27/foundryvtt-to-sillytavern-nhp-uplink),
whose Foundry module contains the half that actually creates the Actors. It has
no dependency on that project's SillyTavern narration relay and works whether or
not you use SillyTavern at all.

## What you need

- **Node 20 or newer.** No dependencies — this is Node stdlib only, and there is
  no `package.json`.
- **Python and `generate-npc.py`**, from the `lancer-art-generator` repo — a
  local sibling clone, not a GitHub repository: `G:\GIT-REPOS\lancer-art-generator`.
  This tool reads that script's `.generated-npcs.json` run log directly
  off disk, and reads and writes its `npc-generator-tables.md`.
- **The Foundry module**, installed and configured — see
  [Point Foundry at this server](#point-foundry-at-this-server).

## Install

```bash
git clone https://github.com/masterevan27/lancer-npc-import-gui
cd lancer-npc-import-gui
cp config.example.json config.json
```

Edit `config.json`. Only these four matter:

```json
{
  "port": 5089,
  "host": "127.0.0.1",
  "secret": "",
  "npcManifestPath": "<path to generate-npc.py's .generated-npcs.json>",
  "foundryDataRoot": "<path to your Foundry install's Data directory>"
}
```

Everything else in `config.example.json` is optional and derived by default:

- `pythonExecutable` / `generateNpcScript` — how to invoke the generator for
  **Create NPC** and **Regenerate**. Default `python`, and the script bundled
  alongside `npcManifestPath`.
- `foundryNpcSubdir` — the folder imports are nested under inside
  `foundryDataRoot`. Default `LancerNPCs`.
- `npcTablesPath` / `stagedImportsDir` — where the generator's own
  `npc-generator-tables.md` and its `npc-trait-import` skill's staged candidates
  live, for the **Tables** and **Trait Imports** tabs.
- `presetsDir` — where saved table presets are written.

Then:

```bash
node server.js
```

and open <http://127.0.0.1:5089>.

## The four tabs

- **Import Generated Art** — pick a category, click a card to preview its
  portrait and token, check the ones you want, and **Import Selected**.
  Importing copies the files into `foundryDataRoot` for you if they aren't
  there already, so nothing needs pre-staging under your Foundry Data folder by
  hand. Sort and filter the grid, see when each NPC was generated and the prompt
  that produced its art, regenerate art on any of them, and **Delete Selected**
  to remove an NPC's generated files entirely (blocked while an import or regen
  is in flight; never touches an Actor already created in Foundry).
- **Create NPC** — a form over `generate-npc.py`'s roll options (count, seed,
  name, pronouns, per-table trait overrides, portrait/token toggles,
  dry-run-vs-generate) that rolls new NPCs into the same review flow as the CLI.
- **Trait Imports** — lists reference-image trait candidates staged by the
  `npc-trait-import` skill, sortable and dated, and appends the ones you approve
  as new bullets in `npc-generator-tables.md`.
- **Tables** — shows every bullet in every table of `npc-generator-tables.md`.
  Disable ones you don't want rolled without deleting them, set per-bullet roll
  weights, and save the whole selection as a named preset. Download a preset,
  hand it to another GM, and they can import it, preview exactly what it would
  change, and apply it.

Only NPCs exist as generated content today — mechs and spaceships have no
generator yet, so their categories won't appear until something writes manifest
entries in the same shape.

## Point Foundry at this server

In Foundry: **Game Settings → Configure Settings → FoundryVTT to SillyTavern NHP
Uplink**. Set **Import GUI server URL** to this server's address (default
`http://127.0.0.1:5089`), and **Import GUI shared secret** to match
`config.secret` if you set one.

The module's primary GM client polls this server and creates the Actors; a badge
on each card flips to **Imported** once that's done. Deleting the Actor in
Foundry clears the badge again on the next poll, so re-importing later is safe.

The wire format between the two is fixed and documented in
[docs/foundry-importer-contract.md](docs/foundry-importer-contract.md). Read it
before changing any `/importer/*` route — the client ships inside a released
`module.zip`.

## Development

```bash
node --test
```

Expect `pass 62`, `fail 0`. No install step; the suite spawns real `server.js`
child processes against synthetic fixture directories, never your real
`config.json` or tables. Each test file binds a **fixed, distinct** port because
`node --test` runs files concurrently — a new test file needs a port no other
file uses.

Parked technical debt is in [docs/known-issues.md](docs/known-issues.md). The
design behind the Tables and Presets features is in
[docs/tables-editor-and-presets-design.md](docs/tables-editor-and-presets-design.md).

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).

LANCER is a trademark of Massif Press. This is an unofficial community tool with
no affiliation to Massif Press, Foundry Gaming LLC, or the SillyTavern project.
