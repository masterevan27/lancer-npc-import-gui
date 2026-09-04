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
  is in flight; never touches an Actor already created in Foundry). The detail
  sheet a card opens supports the keyboard: **←/→** step to the previous/next
  NPC in the grid's current filtered and sorted order (clamped at either end,
  not wrapping), and **Esc** closes whatever overlay is topmost — a zoomed
  image, a delete confirmation, the trait list, a preset preview — before
  closing the sheet itself.
- **Create NPC** — a form over `generate-npc.py`'s roll options (count, seed,
  name, pronouns, per-table trait overrides, portrait/token toggles,
  dry-run-vs-generate) that rolls new NPCs into the same review flow as the CLI.
  An **Unarmed run** checkbox maps to the generator's `--unarmed`; it does not
  disarm everyone — military and criminal roles keep their weapons.
  When a generate run finishes, a banner appears above the tabs — on whichever
  tab you are standing on — with a **Show new NPCs** button that jumps to the
  Import tab and reloads the list. The list also refreshes in place if you were
  already looking at it, so the new NPCs never need a manual page reload.
  Each trait override offers a **dropdown of that table's own bullets**
  alongside the free-text box, grouped by the heading each came from so a
  per-pronoun variant is visibly one. The option's value is the raw bullet
  *including its `||` flags* — `--set-trait` takes a bullet verbatim, and those
  flags gate the Weapon, Gear and Backdrop rolls that follow, so a value typed
  without them quietly changes what the rest of the roll may do. Bullets
  disabled on the Tables tab are still listed, marked `[disabled]`, since
  `--set-trait` bypasses the roll pool anyway. Pick **Custom value…** to type
  something that is in no table at all.
  An NPC's detail sheet lists its rolled traits, and each trait the generator
  can re-roll on its own gets a **Re-roll** button. The buttons lead their rows,
  stacked in one gutter down the left of the trait table rather than trailing a
  value that runs to a couple of hundred characters on Backdrop or Stance, so
  the one you want is a glance rather than a scan. They are always present —
  dim and borderless at rest, painting in a border and a full-contrast label on
  hover or focus, so the column reads as a gutter until you look at it. Clicking
  one re-rolls just that trait and re-renders the NPC in place — same folder,
  same manifest id, fresh seed. Not every trait is offered: the manifest stores
  bullets with their flags stripped, so a trait gated by *another* trait's
  flags (Outfit by Role's `mil`, Stance by the Weapon's `hands`) cannot be
  re-rolled correctly from a stored entry and is left without a button. The
  list is derived from `generate-npc.py`'s own `REROLLABLE_TRAITS` rather than
  restated here.
- **Trait Imports** — lists reference-image trait candidates staged by the
  `npc-trait-import` skill, sortable and dated, and appends the ones you approve
  as new bullets in `npc-generator-tables.md`.
- **Tables** — shows every bullet in every roll table of
  `npc-generator-tables.md`. Headings are grouped as Identity, Body,
  Appearance, Kit and Scene (a table the generator adds later that fits none
  of those falls into a trailing Other rather than disappearing), with
  per-pronoun variants like `Hair (she) +` nested under the `Hair` heading
  they extend. The generator's own documentation sections — `How the script
  reads this file` and `Prompt templates` — read like tables (they use `- `
  bullets to explain the format) but aren't served as ones, so a stray click
  can't comment out a paragraph of prose or prefix it with a roll weight.
  Disable bullets you don't want rolled without deleting them, set per-bullet
  roll weights, and save the whole selection as a named preset. Download a
  preset, hand it to another GM, and they can import it, preview exactly what
  it would change, and apply it.

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
node --test "test/*.test.js"
```

Expect `pass 137`, `fail 0`. No install step; the suite spawns real `server.js`
child processes against synthetic fixture directories, never your real
`config.json` or tables. Each test file binds a **fixed, distinct** port because
`node --test` runs files concurrently — a new test file needs a port no other
file uses.

Ports are written two ways, which is worth knowing before you pick one: most
files pass `port: 5199` inline at each `startTestServer` call, but at least one
(`importerContract.test.js`) declares `const PORT = 5196` and passes that. So
grep for both before claiming a number — a collision does not fail loudly, it
hangs the run until the whole suite times out:

```bash
grep -rhoE "(port: |PORT = )5[0-9]+" test/*.test.js | sort -u
```

Ports 5193–5199 and 5201–5203 are taken.

CI ([.github/workflows/test.yml](.github/workflows/test.yml)) runs bare
`node --test` instead, which also picks up `test/helpers/testServer.js` as a
file with no tests in it — so expect one more there, `pass 138`, for a helper
that declares no tests and therefore cannot fail. Both numbers move whenever a
test is added; they are worth updating together.

Parked technical debt is in [docs/known-issues.md](docs/known-issues.md). The
design behind the Tables and Presets features is in
[docs/tables-editor-and-presets-design.md](docs/tables-editor-and-presets-design.md).

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).

LANCER is a trademark of Massif Press. This is an unofficial community tool with
no affiliation to Massif Press, Foundry Gaming LLC, or the SillyTavern project.
