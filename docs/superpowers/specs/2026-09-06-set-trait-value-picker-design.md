# Choosing a trait's value from the detail sheet

Date: 2026-09-06
Status: approved, not yet implemented
Companion spec: `lancer-art-generator` →
`docs/superpowers/specs/2026-09-06-set-trait-value-design.md`

## The gap

Every trait row in the detail sheet has a **Re-roll** button and nothing else.
Wanting a particular haircut means clicking it until the dice agree, and each
click is a render. The user can already *name* a value on the Create form — the
override dropdown does exactly that — but only for an NPC that does not exist
yet.

So each row gains a **Set…** button beside its Re-roll: pick the value, see
which values the rest of the NPC actually permits, regenerate.

## What this end does not compute

Nothing about legality. The generator answers that, for the reason
`lib/traitOdds.js` already wrote down for the odds display: working it out here
would mean a second copy of `roll_npc()`'s filter chain, and the two would drift
silently — nothing would break, the list would simply stop being true. The new
`generate-npc.py --trait-choices` prints the answer as JSON; this end builds the
command line, validates what comes back, caches it, and renders it.

That is the same division `/api/trait-odds` already runs on, and the new route
is deliberately shaped like it.

## Routes

### `GET /api/trait-choices?id=<npcId>&trait=<Table>`

Spawns `generate-npc.py --regen-manifest <path> --regen-id <id>
--trait-choices <Table>` and returns its JSON through.

Refused with 400, before spawning, when:

- the item is unknown, or is not `kind === 'npc'`;
- `hasRawTraits(item)` is false — the picker is a raw-bullets feature, exactly
  as the generator spec says, and the button is not drawn in that case either.
  The offer and the refusal have to agree; a button that answers 400 is worse
  than no button;
- the trait is outside `rerollableFor(item)`. The same list the Re-roll button
  is drawn from, for the same agreement reason.

**Caching** reuses `lib/traitOdds.js`'s key exactly — tables-file `mtimeMs` and
`size` — with the NPC's own identity folded in, since the answer depends on the
entry as much as on the tables:

```
`${stat.mtimeMs}:${stat.size}:${item.id}:${trait}:${rawTraitsFingerprint}`
```

The fingerprint is over `item.rawTraits`, because a regen rewrites the entry's
bullets without touching the tables file, and a cache keyed on the file alone
would hand back the previous NPC's legal values. Entries are dropped whole
whenever the tables key changes.

A new `lib/traitChoices.js` holds the pure half — `choicesArgs()`,
`parseChoicesOutput()`, `cacheKeyFor()` — mirroring `lib/traitOdds.js` so both
can be tested without spawning anything.

### `POST /api/set-trait`

Body `{ id, table, value, release: [] }`. Validates the same three things as
above, plus:

- `value` must be a `value` the generator listed for this `id` and `table`.
  Re-queried rather than trusted, because the client's list may be stale and
  `--set-trait` takes its bullet verbatim — an arbitrary string here would paste
  straight into a prompt. The re-query goes through the same cache the GET
  route fills, so the ordinary path — open the picker, choose, submit — spawns
  the generator once, not twice.
- every name in `release` must appear in that value's own `conflicts`. The
  checkbox offers exactly those, so anything else is a client that has drifted.

On success it calls `startRegenJob(item, { which: 'both', seedMode: 'random',
setTrait: { table, value }, release })`, which is the one change that file
needs: `setTrait` emits `--set-trait <table>=<value>` and `release` emits
`--release <a,b,c>`, in the same place `rerollTrait` emits its flag. Everything
downstream — the running-job guard, the poll, the log capture, the finished
banner — is reused untouched.

`seedMode: 'random'` for the same reason the re-roll route uses it: pinning a
value and getting a byte-identical image back is not what the button promises.

## The picker

`rerollControlHtml(trait, rerollable)` gains a sibling in the same
`reroll-cell` gutter. Where Re-roll is offered, Set… is offered; where Re-roll
is explained-but-disabled, Set… is absent rather than disabled, because the
explanation already given covers both.

Clicking it opens a dialog built on the existing `reroll-confirm-overlay`
pattern — same overlay, focus trap and Escape handling, new body:

The generator reports two independent kinds of "not cleanly legal", and they
are not interchangeable — one has a remedy in this dialog and the other does
not, so they get separate headings:

| | meaning | remedy |
|---|---|---|
| `allowed: false` | the roller's own pool for this table excludes the value, given the traits *above* it | none here — picking it overrides a gate |
| `conflicts: [...]` | legal in itself, but traits *below* it would be left contradicting it | the checkbox: re-roll those traits |

```
┌ Set Outfit ─────────────────────────────────┐
│  [ filter…                                ] │
│                                             │
│  ○ a padded synthweave work jacket · civ    │  ← current, marked
│  ○ a hooded rain slicker · civ              │
│  ○ a Union service uniform · mil            │
│  … 41 more                                  │
│                                             │
│  Would leave other traits contradicting     │
│  ○ an elaborate floral kimono · civ notac   │
│     Headgear would clash — currently        │
│     "a hard-tech visor"                     │
│                                             │
│  Ruled out by this NPC's other traits       │
│  ○ a ceremonial robe · civ dressy           │
│     the roller would not offer this to      │
│     Role "a dockworker"                     │
│                                             │
│  ☑ also re-roll Headgear                    │  ← only when the
│                                             │     selection has
│              [ Cancel ]  [ Set and regen ]  │     conflicts
└─────────────────────────────────────────────┘
```

- Clean values first — `allowed` and no `conflicts` — in the order the
  generator listed them. The NPC's current value is marked and pre-selected;
  the generator spec makes "the current value is always `allowed`" a tested
  invariant, so it is always in this first group.
- The other two groups are greyed and **still selectable**. That was the
  explicit design decision, and it mirrors the Create form, which deliberately
  keeps disabled bullets because `--set-trait` bypasses the roll pool anyway.
- A conflicting value names each trait it clashes with *and that trait's
  current value*: "conflicts with Headgear" is not actionable without knowing
  what the Headgear currently is.
- A ruled-out value names the trait that ruled it out where the generator can
  attribute it, and otherwise says only that the roller would not have offered
  it. Attribution is best-effort by design — the generator reports membership
  in a pool, not which filter emptied it — so the wording must not promise a
  cause it does not have.
- The checkbox appears only when the selected value has `conflicts`, and names
  them rather than counting them when there are three or fewer. Unchecked by
  default: the whole point of this feature over Re-roll is that nothing else
  moves unless asked. It does **not** appear for an `allowed: false` selection,
  which has nothing to release.
- Where the value's `releases` list is longer than its `conflicts` list, the
  checkbox says so — *"also re-roll Headgear (and 2 traits that depend on
  it)"*. Releasing a trait re-rolls its whole cascade, because freeing
  `Outfit` while `Headgear`, `Weapon` and `Gear` stay pinned to bullets chosen
  for the old outfit recreates the contradiction one level down. The generator
  reports `releases` precisely so this end can name what moves without a copy
  of `trait_cascade()` in JavaScript.
- Selecting a value in either grey group leaves **Set and regen** enabled. The
  user was told what it costs; refusing the click after saying it is selectable
  would be a dialog that argues with itself.
- Labels come from `lib/traitOptions.js`'s `readableLabel`, so `||` renders as
  `·` here exactly as it does on the Create form. The raw bullet is what gets
  posted.

Long tables (Backdrop is 213 bullets) get a filter box that narrows the list by
substring. No pagination — a `<select>`-sized list is the wrong shape for
values that carry conflict notes, so this is a scrolling radio list.

### While it loads

`--trait-choices` costs about 70ms on the worst table plus interpreter startup,
so the dialog opens immediately with a spinner rather than blocking the click.
A failed query shows the generator's own stderr, the way the odds display does.

## Testing

The pure modules get unit tests; the routes get the `test/helpers/testServer.js`
treatment the other routes already use.

- `traitChoices.test.js` — `choicesArgs()` shape; `parseChoicesOutput()` accepts
  the documented JSON and rejects a truncated or non-JSON body; `cacheKeyFor()`
  changes when the tables file changes, when the NPC's `rawTraits` change, and
  when the trait changes.
- `api.traitChoices.test.js` — 400 for an unknown id, a non-npc kind, an entry
  with no `rawTraits`, and a trait outside `rerollableFor`; a cache hit does not
  re-spawn.
- `api.setTrait.test.js` — argv carries `--set-trait Table=value`; a value the
  generator did not list is refused; a `release` naming a non-conflicting trait
  is refused; a second request while a regen runs is refused by the existing
  guard.
- `ui.setTraitPicker.test.js` — Set… is drawn exactly where Re-roll is drawn and
  absent where Re-roll is explained-but-disabled; ruled-out values render under
  their heading and stay selectable; the checkbox appears only for a selection
  with conflicts and its count matches.

## Out of scope

- Adding a bullet that is not in the tables file. That is the Tables tab.
- Setting more than one trait per regen. Two pinned values interact, and the
  conflict list the picker shows is computed for one.
- The Create form. It already has an override dropdown.
