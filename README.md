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

Edit `config.json`. Only these five matter, and only the last two are
required — `port`, `host` and `secret` all fall back to the values below
when omitted:

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
- `generate3dScript` — `generate-3d.py`, behind the detail sheet's **3D model**
  panel. Defaults to the script beside `generateNpcScript`, which is where it
  lives in the generator repo; set it only if you have moved that one file.
- `foundryNpcSubdir` — the folder imports are nested under inside
  `foundryDataRoot`. Default `LancerNPCs`.
- `npcTablesPath` / `stagedImportsDir` — where the generator's own
  `npc-generator-tables.md` and its `npc-trait-import` skill's staged candidates
  live, for the **Tables** and **Trait Imports** tabs.
- `stagedRefsDir` — the reference images copied beside each staged run, shown
  on the **Trait Imports** detail sheet. Defaults to `refs/` inside
  `stagedImportsDir`; worth pointing elsewhere only to put them on another
  disk, since at roughly a megabyte an image they are the one thing here that
  gets large.
- `presetsDir` — where saved table presets are written.
- `traitOddsSamples` — rolls behind each percentage on the **Tables** tab.
  Default 20000, about six seconds; fewer settles sooner and wobbles more.

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
  Each prompt on the detail sheet carries a **Copy** button, with a **Copy
  both** beneath the pair that puts them in the clipboard together, each under
  its own heading, since two unlabelled prompts are indistinguishable once they
  are in the buffer. The prompts exist to be pasted into ComfyUI or Krea by
  hand, and a 2000-character paragraph is not something to click-drag across.
  The three buttons carry the same filled blue as **Re-roll** a few centimetres
  away, since both are ordinary things to click on an NPC's sheet. Copying works
  over a LAN address as well as on localhost, where the browser's clipboard API
  is unavailable and an older fallback runs in its place.
  A blue **New** tag in a card's top-left corner marks an NPC generated since
  you last opened it — including ones rolled at the shell rather than through
  the Create tab, since the server keeps the record rather than your browser.
  It clears when you open that NPC, when you import it, or — for the NPCs a
  single generate run produced, and only those — when you dismiss the banner
  announcing that run, and it sits in its own corner precisely because it
  is independent of the status badge opposite: a brand-new NPC can equally be
  mid-regen. The card takes a blue border to match, so a new NPC is findable
  under a name-ascending sort, where the default newest-first clustering does
  not help and the alternative is hunting the grid for pills. The very first
  time the GUI runs against an existing library it flags nothing at all —
  everything already there counts as already seen — while on a fresh install,
  where there is no manifest yet and so nothing that could have been seen, the
  first NPCs you ever generate do arrive flagged. The record
  lives in `.npc-seen.json` beside your manifest; if it cannot be written there
  the tags still work, they just forget themselves when the server restarts.
  Two routes over that record exist for callers outside this page and are
  deliberately unused by it: `GET /api/unseen` answers with the count and ids
  of everything unlooked-at across every kind at once rather than the one
  category the grid happens to be showing, and `POST /api/seen` with
  `{"all": true}` marks the whole library seen in one go — the page itself only
  ever posts the specific ids it means.
  The detail sheet a card opens supports the keyboard: **←/→** step to the previous/next
  NPC in the grid's current filtered and sorted order (clamped at either end,
  not wrapping), and **Esc** closes whatever overlay is topmost — a zoomed
  image, a delete confirmation, the trait list, a preset preview — before
  closing the sheet itself.
  The detail sheet also carries a **3D model** panel, beneath Regenerate art,
  over `generate-3d.py` in the same generator repo. **Create 3D model** rebuilds
  the NPC from a fresh A-pose render into a `3d/` folder beside its portrait —
  a shell GLB, a print STL and four turnaround PNGs, which the panel shows as
  thumbnails once the build lands. It is far slower than a regen (a render, two
  reconstructions and a headless Blender assembly, minutes rather than seconds),
  so the status line shows the stage the generator is currently in rather than a
  bare spinner, and the grid tile carries a **Building 3D…** badge meanwhile.
  Two checkboxes: **Rig** is off by default and should stay off unless you have
  read that repo's own warning about it, and **Overwrite existing** is forced on
  once a model exists, because `generate-3d.py` silently skips an NPC that
  already has a non-empty `3d/` folder.
- **Create NPC** — a form over `generate-npc.py`'s roll options (count, seed,
  name, pronouns, per-table trait overrides, portrait/token toggles,
  dry-run-vs-generate) that rolls new NPCs into the same review flow as the CLI.
  An **Unarmed run** checkbox maps to the generator's `--unarmed`; it does not
  disarm everyone — military and criminal roles keep their weapons.
  When a generate run finishes having written at least one new NPC, a banner
  appears above the tabs — on whichever tab you are standing on — with a **Show
  new NPCs** button that jumps to the Import tab and reloads the list. The list
  also refreshes in place if you were already looking at it, so the new NPCs
  never need a manual page reload. The count is the one the server measured
  against the manifest either side of the run, not the one the form asked for:
  `generate-npc.py` can exit clean having written fewer NPCs than requested, or
  none, and a run that added nothing raises no banner at all — the Create tab's
  status line says so instead, and the log is right below it. Dismissing the
  banner also clears the **New** tag on the NPCs that run wrote: the banner and
  those tags are two halves of one announcement, and without that the only way
  to clear a ten-NPC batch would be to open all ten. Only that run's, though —
  an NPC rolled at the shell and never looked at keeps its tag, since the banner
  never claimed to be about it. **Show new NPCs** leaves everything alone, since
  it is taking you to them rather than acknowledging them.
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
  the one you want is a glance rather than a scan. They are always present and
  filled in a muted blue, brightening to the primary blue on hover or focus —
  loud enough to read as buttons at a glance, quiet enough that twenty of them
  stay behind the trait values beside them. Clicking one re-rolls that trait and
  re-renders the NPC in place — same folder, same manifest id, fresh seed.
  Which traits are offered depends on the NPC.
  An entry the generator recorded raw bullets for can re-roll everything except
  the two halves of its name and its pronouns, since those decide the folder and
  the manifest id; an entry written before it kept those bullets stores them with
  their flags stripped, so a trait gated by *another* trait's flags (Outfit by
  Role's `mil`, Stance by the Weapon's `hands`) cannot be re-rolled correctly
  from it and is left without a button — only eleven of the twenty-two stay
  re-rollable. The other eleven get a greyed-out **Re-roll** instead of an empty
  gutter, and hovering it says why and what to do: the NPC predates its raw
  bullets, and one full re-roll of it records them and turns every one of those
  buttons on. That is the only
  case where an inert control appears — the two halves of the name and pronouns
  are refused however the entry was written, so they stay blank rather than
  advertise a cure that does not exist. Both lists are derived from
  `generate-npc.py`'s own `REROLLABLE_TRAITS` and `RAW_REROLLABLE_TRAITS` rather
  than restated here, and the server picks between them per NPC exactly as the
  generator does. A re-roll can reach past the trait named on the button — the
  generator frees every trait a filter would otherwise have had to re-check, so
  Theme takes the outfit, weapon, hair and scene with it, a dozen traits in all,
  and Role, Outfit, Weapon, Gear, Backdrop, Hair colour and Age each pull one to
  six along. Those are the ones that ask for confirmation first, and the dialog
  names the traits it is about to free, in the order the generator draws them:
  the cascade map is read out of `generate-npc.py`'s `TRAIT_DEPENDENTS` the same
  way the two lists are, so a trait that frees nothing — Faction, Weather and
  Stance among them — fires on one click and raises no dialog at all.

  Beside every live **Re-roll** sits **Set…**, for when you know what you want
  rather than wanting another draw. It opens a list of the values that trait
  could take *on this NPC*, which is not the whole table: the roller gates most
  tables on what the NPC already is, so a civilian's Outfit list comes back as
  105 bullets of which 56 are on offer and 49 — every military uniform and
  plate carrier — are ruled out by the Role's `civ` flag. That answer is
  computed by `generate-npc.py --trait-choices`, which runs the roller's own
  filters; nothing in this app works out what is legal, because a second copy
  of that filter chain would drift from the real one silently and the list
  would simply stop being true.
  The dialog separates two things that are easy to confuse. A value can be
  *ruled out* — the traits above it mean the roller would never have drawn it —
  or it can be legal in itself but *leave something below it contradicting*,
  like a `notac` kimono under a hard-tech visor. Both are greyed, both stay
  pickable (you are allowed to overrule the tables; `--set-trait` always has),
  and each says which trait it clashes with and what that trait currently is.
  Only the second kind offers a fix: a checkbox that re-rolls the conflicting
  traits along with your choice. It names them, and says when more will move
  than it named — releasing a trait re-rolls its whole cascade, since freeing
  Outfit while Headgear, Weapon and Gear stayed pinned to bullets chosen for
  the outfit that just went would recreate the contradiction one level down.
  Leave it unticked and nothing but the trait you set changes. Set… appears
  wherever Re-roll is live and nowhere else — an NPC without raw bullets has
  nothing to pin the rest of itself to, and the greyed Re-roll already says so.
- **Trait Imports** — lists reference-image trait candidates staged by the
  `npc-trait-import` skill, sortable and dated, and appends the ones you approve
  as new bullets in `npc-generator-tables.md`. Clicking a candidate opens its
  detail sheet, which names the reference image the bullet was read from and
  shows it — hover the preview for the full-size image, the same way the
  generated-art sheet works. The picture is the point: whether a bullet
  describes what is really in the frame is a judgment you can only make
  against the frame. The skill copies each referenced image into
  `prompts/staged-imports/refs/<run>/` as it stages a run, and the sheet asks
  for it from there; a run staged before it did that, or one whose copies have
  since been deleted, still names its source and simply shows no preview.
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

  Under each bullet is a row of **flag checkboxes** — the `|| updo`, `||
  helmet`, `|| notac` segment, editable without opening the tables file. Only
  the flags a given table actually reads are offered, so `updo` appears under
  Hair and `crown` under Headgear and neither appears under Eyes, which reads
  no flags at all and would ship the literal text `|| updo` to the image model.
  That restriction is the point: `generate-npc.py` matches flags literally and
  ignores an unrecognized one rather than reporting it, so a typo fails quietly
  in the render rather than loudly at the console, and a checkbox cannot be
  misspelled. Hover a flag for what it does.

  Two things the strip deliberately does not do. It leaves `@theme` tags alone
  — they are an open set the tables file grows freely, so there is nothing to
  enumerate; they are shown beside the checkboxes and preserved untouched
  through every edit. And on `Backdrop`, `Hair colour` and `Faction`, whose
  bullets carry *two* prose segments and keep flags in a third, it writes to
  the third — a flag editor that assumed one prose segment would overwrite a
  Backdrop's scene sentence.

  A flag edit changes a bullet's text, which is the id presets match on. They
  match on the flag-stripped prose for that reason, so flagging a bullet does
  not orphan it in presets saved earlier — see
  [known-issues.md](docs/known-issues.md) for the one case that can still
  collide.

  Beside each weight is **how often that bullet actually gets rolled**, which
  is not what the weight says: a weight compares a bullet to its neighbour,
  and the generator filters most tables before drawing from them — a Stance
  flagged `|| gun` needs the Weapon roll to have produced a firearm, and comes
  out far below its share of the table. The figure comes from
  `generate-npc.py --trait-odds`, which samples the real roller, so it cannot
  drift from what the generator actually does. It follows your edits: weights,
  enabling and disabling, and newly imported candidates alike. A tilde
  (`~12%`) marks the instant local estimate shown while the sampled figure is
  still being calculated, and a dash marks a disabled bullet. Percentages on a
  per-pronoun variant table total less than 100%, because only some NPCs roll
  from it at all.

  Sampling takes a few seconds. `traitOddsSamples` in `config.json` trades
  precision for speed; the default 20,000 holds still at whole-percent
  precision. Without a working `pythonExecutable` the column falls back to the
  local weight-share estimate and says so, rather than breaking the page.

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

Expect `pass 377`, `fail 0`. No install step; the suite spawns real `server.js`
child processes against synthetic fixture directories, never your real
`config.json` or tables. Each test file binds a **fixed, distinct** port because
`node --test` runs files concurrently — a new test file needs a port no other
file uses.

Ports are written two ways, which is worth knowing before you pick one: of the
37 test files, 17 declare `const PORT = 5196` at the top and pass that, while
the rest (`api.createArgs`, `api.nonTableSections`, `api.presets`,
`api.pronouns`, `api.tableBullets`, `api.traitOptions` and `helpers.testServer`)
pass `port: 5199` inline at each `startTestServer` call. The enumerated half is
the smaller one, and it used to be the other half — which is the point: grep
for both before claiming a number, because a collision does not fail loudly, it
hangs the run until the whole suite times out:

```bash
grep -rhoE "(port: |PORT = )5[0-9]+" test/*.test.js | sort -u
```

Ports 5193–5199 and 5201–5220 are taken.

The same collision bites from outside the runner, which is worth knowing
because the symptom points at the wrong thing: run a single test file while a
full `node --test "test/*.test.js"` is still going and two servers reach for
one port, surfacing as a 20-second readiness timeout in whichever test happened
to lose. Let one run finish before starting another.

CI ([.github/workflows/test.yml](.github/workflows/test.yml)) runs bare
`node --test` instead, which also picks up `test/helpers/testServer.js` as a
file with no tests in it — so expect one more there, `pass 378`, for a helper
that declares no tests and therefore cannot fail. Both numbers move whenever a
test is added; they are worth updating together.

Bare `node --test` is a CI-only command in practice: it discovers by walking
the tree, so run it in a working copy that has scratch directories under it —
a git worktree, say — and it goes looking through all of them. `node --test
"test/*.test.js"` is the local form for that reason, and the extra file's
contribution is measured on its own (`node --test "test/helpers/testServer.js"`)
rather than by sitting through a bare run.

Parked technical debt is in [docs/known-issues.md](docs/known-issues.md). The
design behind the Tables and Presets features is in
[docs/tables-editor-and-presets-design.md](docs/tables-editor-and-presets-design.md).

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).

LANCER is a trademark of Massif Press. This is an unofficial community tool with
no affiliation to Massif Press, Foundry Gaming LLC, or the SillyTavern project.
