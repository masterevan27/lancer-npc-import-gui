# Backgrounds Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Backgrounds tab that renders scene stills from every background prompt catalogue the art generator has, keeps them as ordinary files in one configured folder, and animates any of them into a looping `.webp`.

**Architecture:** Backgrounds are a *feature*, not a kind — there is no manifest entry, no id and nothing to reconcile. The folder is the source of truth; what the GUI remembers about a still lives in a JSON sidecar beside it, exactly as `lib/animate.js` already does for animated portraits. One new pure module (`lib/backgrounds.js`) holds every decision that can be asserted without a Python interpreter: the `--list` parse, both argv builders, the sidecar read and the path-traversal guard. Five new server routes wrap it, and a parallel `backgroundsState` / `elBackgrounds` client block drives the tab without touching any function the existing UI tests lift by name.

**Tech Stack:** Node.js stdlib only (`node:http`, `node:fs`, `node:path`, `node:crypto`, `node:child_process`), `node:test` + `node:assert/strict`, vanilla browser JS. Zero runtime dependencies, matching the rest of the repo.

**Spec:** `docs/superpowers/specs/2026-09-10-backgrounds-tab-design.md` (committed as `402c8d5`). Read it alongside this plan.

## Global Constraints

- **No new dependencies.** Node stdlib only, in `lib/`, `server.js`, `public/` and `test/`.
- **Node test runner.** Every test file is `node:test` + `node:assert/strict`, CommonJS `require`, no transpile step.
- **Unique test port per file.** `node --test` runs test files as concurrent processes and every test server binds a fixed port. New ports: `5237` for `test/api.backgrounds.test.js`, `5238` for `test/ui.backgrounds.test.js`. Ports `5193`–`5236` are taken.
- **Run each new test file alone before calling it green.** This suite has pre-existing port collisions under a whole-directory run (`create-presets`, `set-flag` and `table-bullets` fail together that way and pass individually).
- **No renames in `public/app.js`.** Ten `ui.*.test.js` files lift functions out of `app.js` by name and brace-matching. Do not parameterise `render()`, `openDetail()`, `traitControlCells()` or the Create blocks. Add new top-level functions; change no existing signature.
- **Sidecar field name is `portraitVersion`.** A background's sidecar records the *still's* mtime under the key `portraitVersion`, not `sourceVersion`. This is deliberate: it lets `animate.isStale` be re-exported verbatim instead of copied. Do not rename it.
- **Rel paths use forward slashes.** Every `rel` crossing the API boundary is `/`-separated regardless of platform. Convert with `rel.split('/')` before handing it to `path.join`.
- **`--filter` is always anchored and escaped.** `^` + escaped prefix + `$`. `generate-art.py` compiles `--filter` as a case-insensitive regex and matches with `re.search` against `entry.key` *or* `entry.name`, so an unanchored prefix that is a prefix of another entry's would render both.
- **`--manifest` always points inside `backgroundsDir`.** The script's default is `.generated-manifest.json` at the generator root, which is the mech catalogue's record.
- **Deviation from the spec, §1 "The feature gate":** the spec says `applyFeatureAvailability` copies all three of `applyKindAvailability`'s degradation rules, including "an empty list means change nothing". That rule must **not** be copied. For `kinds`, an empty list means no generator script at all, which is a misconfiguration. For `features`, an empty list is the normal, expected state of an install without `generate-art.py`, so treating it as "change nothing" would leave the tab permanently visible and defeat the gate entirely. `applyFeatureAvailability` therefore degrades on exactly two conditions: a missing `features` field (a server too old to send one) and a non-array. An empty array removes every `[data-feature]` node. Every other line of the spec's §1 stands.

## File Structure

| File | Responsibility |
|---|---|
| `lib/paths.js` (modify) | Derive `generateArtScript`, `backgroundsDir`, `backgroundPromptsDir`, `backgroundTablesPath`. |
| `config.example.json` (modify) | The four new keys, empty. |
| `lib/backgrounds.js` (create) | The pure half: `--list` parsing, heading attachment, both argv builders, catalogue and still naming, sidecar re-exports, `resolveInside`. No `fs`, no `spawn`. |
| `server.js` (modify) | Five routes, two job starters, the recursive walk, `features` on `/api/categories`. |
| `public/index.html` (modify) | The tab button and the `#tab-backgrounds` panel, both carrying `data-feature="backgrounds"`. |
| `public/app.js` (modify) | `applyFeatureAvailability`, `backgroundsState`, `elBackgrounds`, the three panel regions. |
| `public/style.css` (modify) | Gallery card grid and pills. |
| `test/paths.test.js` (modify) | The four derivations and their overrides. |
| `test/backgrounds.test.js` (create) | Every pure decision. No server, no child process. |
| `test/api.backgrounds.test.js` (create) | The five routes against a temp `backgroundsDir` and Node stub scripts. Port `5237`. |
| `test/ui.backgrounds.test.js` (create) | Source assertions and lifted functions over the served `app.js`. Port `5238`. |
| `README.md` (modify) | A Backgrounds section and the four config keys. |

`test/helpers/testServer.js` needs **no change**: its `extraConfig` parameter is spread last over the generated config, which is enough to point `generateArtScript`, `animatePortraitScript`, `backgroundsDir`, `backgroundPromptsDir`, `backgroundTablesPath` and `pythonExecutable` at the fixture.

---

### Task 1: Config paths for the generator, the output folder and the catalogues

**Files:**
- Modify: `lib/paths.js:24-110`
- Modify: `config.example.json`
- Test: `test/paths.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `derivePaths(config)` gains four keys on its return object — `generateArtScript: string`, `backgroundsDir: string`, `backgroundPromptsDir: string`, `backgroundTablesPath: string`.

- [ ] **Step 1: Write the failing tests**

Append to `test/paths.test.js`:

```js
test('derives the four background paths from npcManifestPath alone', () => {
    const p = derivePaths({ npcManifestPath: path.join(REPO, '.generated-npcs.json') });
    assert.strictEqual(p.generateArtScript, path.join(REPO, 'generate-art.py'));
    assert.strictEqual(p.backgroundsDir, path.join(REPO, 'output', 'backgrounds'));
    assert.strictEqual(p.backgroundPromptsDir, path.join(REPO, 'prompts'));
    assert.strictEqual(p.backgroundTablesPath,
        path.join(REPO, 'prompts', 'scene-and-spaceship-tables.md'));
});

test('generateArtScript and backgroundsDir follow a relocated generateNpcScript', () => {
    // The rule this file follows: moving the generator moves all four scripts
    // and the output root together, rather than leaving them at the manifest.
    const moved = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        generateNpcScript: path.join('D:', 'gen', 'generate-npc.py'),
    });
    assert.strictEqual(moved.generateArtScript, path.join('D:', 'gen', 'generate-art.py'));
    assert.strictEqual(moved.backgroundsDir, path.join('D:', 'gen', 'output', 'backgrounds'));
});

test('the background prompt and table paths follow a relocated npcTablesPath', () => {
    const moved = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        npcTablesPath: path.join('D:', 'elsewhere', 'tables.md'),
    });
    assert.strictEqual(moved.backgroundPromptsDir, path.join('D:', 'elsewhere'));
    assert.strictEqual(moved.backgroundTablesPath,
        path.join('D:', 'elsewhere', 'scene-and-spaceship-tables.md'));
});

test('an explicit backgroundsDir wins over the derived one', () => {
    const p = derivePaths({
        npcManifestPath: path.join(REPO, '.generated-npcs.json'),
        backgroundsDir: path.join('E:', 'Backgrounds'),
    });
    assert.strictEqual(p.backgroundsDir, path.join('E:', 'Backgrounds'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/paths.test.js`
Expected: FAIL, four tests, each `Expected values to be strictly equal: undefined !== '...'`.

- [ ] **Step 3: Add the four derivations**

In `lib/paths.js`, immediately after the `animatePortraitScript` block:

```js
    // generate-art.py renders the scene catalogues. Beside the other three
    // scripts and following generateNpcScript for the reason they do.
    const generateArtScript = config.generateArtScript
        || path.join(path.dirname(generateNpcScript), 'generate-art.py');

    // Where --download-to puts the stills, and the only folder the Backgrounds
    // tab reads. Under the generator root rather than beside the tables,
    // because it holds rendered output and not authored prompts.
    const backgroundsDir = config.backgroundsDir
        || path.join(path.dirname(generateNpcScript), 'output', 'backgrounds');
```

and immediately after the `npcTablesPath` block:

```js
    // Every *-background-art-prompts.md lives with the other prompt files, so
    // this is a directory rather than a list of filenames: the catalogue set
    // grows (a second, city file is already on a branch of the generator
    // repo), and a glob picks the new one up with no config edit and no GUI
    // release.
    const backgroundPromptsDir = config.backgroundPromptsDir
        || path.dirname(npcTablesPath);

    // The '## Background Animation' table, which lives in
    // scene-and-spaceship-tables.md and not in any catalogue. Derived from
    // npcTablesPath rather than from backgroundPromptsDir because the two
    // answer different questions - a GM who points backgroundPromptsDir at a
    // folder of their own catalogues has not moved the generator's own tables
    // file, and would otherwise silently lose every motion prompt.
    const backgroundTablesPath = config.backgroundTablesPath
        || path.join(path.dirname(npcTablesPath), 'scene-and-spaceship-tables.md');
```

Add all four to the returned object:

```js
        generateArtScript, backgroundsDir, backgroundPromptsDir, backgroundTablesPath,
```

- [ ] **Step 4: Add the four keys to `config.example.json`**

After `"animatePortraitScript": "",` add:

```json
  "generateArtScript": "",
  "backgroundsDir": "",
  "backgroundPromptsDir": "",
  "backgroundTablesPath": "",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/paths.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Commit**

```
git add lib/paths.js config.example.json test/paths.test.js
git commit -m "derive the four background paths, and say why the tables file does not follow the prompts dir"
```

---

### Task 2: `lib/backgrounds.js`, the pure module

**Files:**
- Create: `lib/backgrounds.js`
- Test: `test/backgrounds.test.js`

**Interfaces:**
- Consumes: `lib/animate.js`'s `parseSidecar`, `isStale`, `pickDescription`.
- Produces, all named exports of `lib/backgrounds.js`:
  - `CATALOGUE_SUFFIX: string` — `'-background-art-prompts.md'`
  - `MOTION_TABLE: string` — `'Background Animation'`
  - `IMAGE_EXTENSIONS: string[]` — `['.png', '.jpg', '.jpeg', '.webp']`
  - `RENDER_MANIFEST: string`, `OUTPUT_PREFIX: string`
  - `escapeRegExp(text: string): string`
  - `isCatalogue(fileName: string): boolean`
  - `catalogueLabel(fileName: string): string`
  - `displayName(fileName: string): string`
  - `parseListOutput(text: string): Array<{prefix, role, line, chars}>`
  - `attachHeadings(entries, fileText: string): Array<{prefix, role, line, chars, name, excerpt}>`
  - `renderArgs(scriptPath, {catalogue, prefix, backgroundsDir, variants, width, height, seed}): string[]`
  - `animateArgs(scriptPath, {still, out, description, seed, pingpong}): string[]`
  - `animationFilesFor(rel: string): {webp: string, sidecar: string}`
  - `isAnimationFile(fileName: string): boolean`
  - `resolveInside(root: string, rel: string): string | null`
  - `motionPromptsFrom(tables): string[]`
  - `pickMotionPrompt(prompts, {exclude, random}): string | null`
  - `parseSidecar(text: string): object`
  - `isStale(sidecar: object, stillVersion: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `test/backgrounds.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const backgrounds = require('../lib/backgrounds');

// Real output from `generate-art.py --prompts scene-background-art-prompts.md
// --list`, banner line and all. The role column is the part of the heading
// after the em-dash, so it holds spaces and can overflow its 20-char field.
const LIST_OUTPUT = [
    'scene-background-art-prompts.md: 3 prompts found, 3 selected',
    '  Mech-Squad-Battle                                          Canyon Skirmish      line 9     (1918 chars)',
    '  Pilots-Quarters                                            Planetrise Through the Porthole line 23    (2141 chars)',
    '  Default-Animated-Background                                                     line 43    (1974 chars)',
].join('\n');

const CATALOGUE_TEXT = [
    '# Scene & Background Art Prompts',            // 1
    '',                                            // 2
    'Wide establishing shots.',                    // 3
    '',                                            // 4
    '## Mech Squad Battle — Canyon Skirmish',      // 5
    '',                                            // 6
    'Recreates a wide mech-squad battle.',         // 7
    '',                                            // 8
    '> A wide, cinematic establishing shot of a mech squad in a scorched canyon.', // 9
    '> Bold black linework throughout.',           // 10
    '',                                            // 11
].join('\n');

test('parseListOutput reads the four columns and ignores the banner', () => {
    const entries = backgrounds.parseListOutput(LIST_OUTPUT);
    assert.equal(entries.length, 3, 'the banner line must not become a phantom entry');
    assert.deepEqual(entries[0], {
        prefix: 'Mech-Squad-Battle', role: 'Canyon Skirmish', line: 9, chars: 1918,
    });
});

test('parseListOutput survives a role that overflows its column', () => {
    const entries = backgrounds.parseListOutput(LIST_OUTPUT);
    assert.equal(entries[1].role, 'Planetrise Through the Porthole');
    assert.equal(entries[1].line, 23);
});

test('parseListOutput reads an entry whose role column is empty', () => {
    const entries = backgrounds.parseListOutput(LIST_OUTPUT);
    assert.equal(entries[2].prefix, 'Default-Animated-Background');
    assert.equal(entries[2].role, '');
});

test('parseListOutput survives a prefix that overflows its own column', () => {
    // A nested catalogue joins its heading path with '/', so a prefix can run
    // well past the 58-character field and push every column right.
    const long = 'Deep-Space/Derelict-Stations/A-Very-Long-Heading-That-Runs-Past-The-Field-Width';
    const [entry] = backgrounds.parseListOutput(
        `  ${long} Drifting Hulk        line 77    (900 chars)`);
    assert.equal(entry.prefix, long);
    assert.equal(entry.role, 'Drifting Hulk');
    assert.equal(entry.line, 77);
});

test('parseListOutput ignores anything that is not an entry line', () => {
    assert.deepEqual(backgrounds.parseListOutput('Nothing to do.'), []);
    assert.deepEqual(backgrounds.parseListOutput(''), []);
});

test('attachHeadings finds the nearest heading above the prompt and an excerpt', () => {
    const [entry] = backgrounds.attachHeadings(
        [{ prefix: 'Mech-Squad-Battle', role: 'Canyon Skirmish', line: 9, chars: 1918 }],
        CATALOGUE_TEXT);
    assert.equal(entry.name, 'Mech Squad Battle — Canyon Skirmish');
    assert.match(entry.excerpt, /^A wide, cinematic establishing shot/);
    assert.ok(!entry.excerpt.includes('>'), 'the blockquote marker should be stripped');
    assert.ok(entry.excerpt.length <= 200);
});

test('attachHeadings degrades to an empty name when no heading is above the line', () => {
    const [entry] = backgrounds.attachHeadings([{ prefix: 'X', role: '', line: 1, chars: 10 }],
        'just a paragraph\n');
    assert.equal(entry.name, '');
    assert.equal(entry.prefix, 'X', 'the entry itself must survive a missing heading');
});

test('catalogueLabel strips the suffix and capitalises', () => {
    assert.equal(backgrounds.catalogueLabel('scene-background-art-prompts.md'), 'Scene');
    assert.equal(backgrounds.catalogueLabel('city-background-art-prompts.md'), 'City');
    assert.equal(backgrounds.catalogueLabel('deep-space-background-art-prompts.md'), 'Deep space');
});

test('isCatalogue matches only the background catalogues', () => {
    assert.ok(backgrounds.isCatalogue('city-background-art-prompts.md'));
    assert.ok(!backgrounds.isCatalogue('npc-generator-tables.md'));
    assert.ok(!backgrounds.isCatalogue('mech-catalogue-art-prompts.md'));
});

test('displayName undoes the slug and drops the ComfyUI counter', () => {
    assert.equal(backgrounds.displayName('Canyon-Skirmish_00001_.png'), 'Canyon Skirmish');
    assert.equal(backgrounds.displayName('Pilots-Quarters_00007_.png'), 'Pilots Quarters');
});

test('displayName leaves a stem it does not recognise alone', () => {
    assert.equal(backgrounds.displayName('my background.png'), 'my background');
});

test('renderArgs anchors and escapes the filter', () => {
    const args = backgrounds.renderArgs('/g/generate-art.py', {
        catalogue: '/g/prompts/scene-background-art-prompts.md',
        prefix: 'Dropship-Yard.Alt2(final)',
        backgroundsDir: '/out/backgrounds',
    });
    const filter = args[args.indexOf('--filter') + 1];
    assert.ok(filter.startsWith('^') && filter.endsWith('$'), 'the filter must be anchored');
    // The punctuation must stay literal: '.' must not match any character and
    // '(...)' must not become a group.
    assert.ok(new RegExp(filter).test('Dropship-Yard.Alt2(final)'));
    assert.ok(!new RegExp(filter).test('Dropship-YardXAlt2final'));
});

test('renderArgs points --manifest inside backgroundsDir', () => {
    const args = backgrounds.renderArgs('/g/generate-art.py', {
        catalogue: '/g/prompts/scene-background-art-prompts.md',
        prefix: 'Canyon', backgroundsDir: '/out/backgrounds',
    });
    assert.equal(args[args.indexOf('--manifest') + 1],
        path.join('/out/backgrounds', '.backgrounds-manifest.json'));
    assert.equal(args[args.indexOf('--download-to') + 1], '/out/backgrounds');
    assert.equal(args[args.indexOf('--output-prefix') + 1], 'LancerBackgrounds');
});

test('renderArgs defaults to 1920x1080 and one variant', () => {
    const args = backgrounds.renderArgs('/g/generate-art.py', {
        catalogue: '/g/c.md', prefix: 'Canyon', backgroundsDir: '/out',
    });
    assert.equal(args[args.indexOf('--width') + 1], '1920');
    assert.equal(args[args.indexOf('--height') + 1], '1080');
    assert.equal(args[args.indexOf('--variants') + 1], '1');
});

test('renderArgs omits --seed entirely when the seed is null', () => {
    const rolled = backgrounds.renderArgs('/g/generate-art.py', {
        catalogue: '/g/c.md', prefix: 'Canyon', backgroundsDir: '/out', seed: null,
    });
    assert.ok(!rolled.includes('--seed'), 'a null seed lets the script roll its own');
    const pinned = backgrounds.renderArgs('/g/generate-art.py', {
        catalogue: '/g/c.md', prefix: 'Canyon', backgroundsDir: '/out', seed: 4,
    });
    assert.equal(pinned[pinned.indexOf('--seed') + 1], '4');
});

test('renderArgs refuses a malformed field', () => {
    const base = { catalogue: '/g/c.md', prefix: 'Canyon', backgroundsDir: '/out' };
    assert.throws(() => backgrounds.renderArgs('/g/a.py', { ...base, catalogue: '' }), /catalogue/);
    assert.throws(() => backgrounds.renderArgs('/g/a.py', { ...base, prefix: '' }), /prefix/);
    assert.throws(() => backgrounds.renderArgs('/g/a.py', { ...base, backgroundsDir: '' }), /directory/);
    assert.throws(() => backgrounds.renderArgs('/g/a.py', { ...base, variants: 0 }), /variants/);
    assert.throws(() => backgrounds.renderArgs('/g/a.py', { ...base, variants: 9 }), /variants/);
    assert.throws(() => backgrounds.renderArgs('/g/a.py', { ...base, width: 0 }), /width/);
    assert.throws(() => backgrounds.renderArgs('/g/a.py', { ...base, seed: -1 }), /seed/);
});

test('animateArgs carries --background and ping-pongs by default', () => {
    const args = backgrounds.animateArgs('/g/animate-portrait.py', {
        still: '/out/a.png', out: '/out/a Animated.webp', description: 'smoke drifts', seed: 7,
    });
    assert.deepEqual(args, ['/g/animate-portrait.py', '/out/a.png', '--background',
        '--out', '/out/a Animated.webp', '-d', 'smoke drifts', '--seed', '7']);
});

test('animateArgs adds --no-pingpong only when asked', () => {
    const args = backgrounds.animateArgs('/g/animate-portrait.py', {
        still: '/out/a.png', out: '/out/b.webp', description: 'rain falls', seed: 7, pingpong: false,
    });
    assert.ok(args.includes('--no-pingpong'));
});

test('animateArgs refuses each missing or malformed field', () => {
    const base = { still: '/out/a.png', out: '/out/b.webp', description: 'rain', seed: 1 };
    assert.throws(() => backgrounds.animateArgs('/g/a.py', { ...base, still: '' }), /still/);
    assert.throws(() => backgrounds.animateArgs('/g/a.py', { ...base, out: '' }), /output/);
    assert.throws(() => backgrounds.animateArgs('/g/a.py', { ...base, description: '' }), /description/);
    assert.throws(() => backgrounds.animateArgs('/g/a.py', { ...base, seed: null }), /seed/);
    assert.throws(() => backgrounds.animateArgs('/g/a.py', { ...base, seed: -1 }), /seed/);
});

test('animationFilesFor derives both names from the still stem, in place', () => {
    assert.deepEqual(backgrounds.animationFilesFor('LancerBackgrounds/Canyon_00001_.png'), {
        webp: 'LancerBackgrounds/Canyon_00001_ Animated.webp',
        sidecar: 'LancerBackgrounds/Canyon_00001_ Animated.json',
    });
});

test('isAnimationFile recognises this module own output', () => {
    assert.ok(backgrounds.isAnimationFile('Canyon_00001_ Animated.webp'));
    assert.ok(!backgrounds.isAnimationFile('Canyon_00001_.webp'));
    assert.ok(!backgrounds.isAnimationFile('Canyon_00001_.png'));
});

test('resolveInside accepts a nested relative path', () => {
    const root = path.resolve('/out/backgrounds');
    assert.equal(backgrounds.resolveInside(root, 'LancerBackgrounds/Canyon.png'),
        path.join(root, 'LancerBackgrounds', 'Canyon.png'));
});

test('resolveInside refuses traversal, absolutes and a lookalike sibling', () => {
    const root = path.resolve('/out/backgrounds');
    assert.equal(backgrounds.resolveInside(root, '../secrets.txt'), null);
    assert.equal(backgrounds.resolveInside(root, 'a/../../secrets.txt'), null);
    assert.equal(backgrounds.resolveInside(root, path.resolve('/etc/passwd')), null);
    assert.equal(backgrounds.resolveInside(root, ''), null);
    assert.equal(backgrounds.resolveInside(root, null), null);
    // The sibling whose name merely starts with the root's: a plain
    // startsWith(root) check would let this through.
    assert.equal(backgrounds.resolveInside(path.resolve('/out/back'), '../backgrounds/x.png'), null);
});

test('motionPromptsFrom takes the enabled Background Animation bullets only', () => {
    const tables = [
        { name: 'Backdrop', bullets: [{ text: 'a canyon', enabled: true }] },
        { name: 'Background Animation', bullets: [
            { text: 'smoke drifts slowly', enabled: true },
            { text: 'rain falls steadily', enabled: false },
            { text: 'snow falls gently', enabled: true },
        ] },
    ];
    assert.deepEqual(backgrounds.motionPromptsFrom(tables),
        ['smoke drifts slowly', 'snow falls gently']);
    assert.deepEqual(backgrounds.motionPromptsFrom([]), []);
});

test('pickMotionPrompt avoids the one already showing when it can', () => {
    const pool = ['smoke drifts', 'rain falls'];
    assert.equal(backgrounds.pickMotionPrompt(pool, { exclude: 'smoke drifts', random: () => 0 }),
        'rain falls');
    assert.equal(backgrounds.pickMotionPrompt(['smoke drifts'], { exclude: 'smoke drifts' }),
        'smoke drifts', 'a pool of one is the only honest repeat');
    assert.equal(backgrounds.pickMotionPrompt([]), null);
});

test('isStale compares the recorded still mtime against the file now', () => {
    assert.equal(backgrounds.isStale({ portraitVersion: 100 }, 200), true);
    assert.equal(backgrounds.isStale({ portraitVersion: 200 }, 200), false);
    assert.equal(backgrounds.isStale({}, 200), false, 'an old sidecar is not stale');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/backgrounds.test.js`
Expected: FAIL with `Cannot find module '../lib/backgrounds'`.

- [ ] **Step 3: Write `lib/backgrounds.js`**

```js
/**
 * The pure half of the Backgrounds tab.
 *
 * Same split as lib/animate.js and lib/model3d.js, for the same reason:
 * nothing here touches the filesystem or spawns anything, so the argv the
 * server builds for generate-art.py and animate-portrait.py, the catalogue
 * parse, the two filenames written beside a still and the traversal refusals
 * can all be asserted without a Python interpreter, a ComfyUI server or the
 * minutes a Wan render takes.
 *
 * A background has no manifest entry, no id and no traits - the folder is the
 * source of truth and a still is identified by its path relative to
 * backgroundsDir. What the GUI remembers about one lives in a JSON sidecar
 * beside it, exactly as lib/animate.js keeps the animated-portrait record
 * beside the .webp.
 */

const path = require('node:path');
const animate = require('./animate');

/** Every file in backgroundPromptsDir matching this is a catalogue. */
const CATALOGUE_SUFFIX = '-background-art-prompts.md';

/** The heading in backgroundTablesPath whose bullets are the motion prompts. */
const MOTION_TABLE = 'Background Animation';

/** What the gallery walk will pick up. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

const ANIMATED_SUFFIX = ' Animated';

/** Kept inside backgroundsDir so a background run never writes the mech record. */
const RENDER_MANIFEST = '.backgrounds-manifest.json';

const OUTPUT_PREFIX = 'LancerBackgrounds';

/**
 * generate-art.py prints one line per entry as
 *   "  %-58s %-20s line %-5d (%d chars)"
 * The first column is safe as \S+ because a prefix is a '/'-joined run of
 * _slug() output and _slug replaces every non-alphanumeric run with '-', so a
 * prefix can never hold a space. That is what keeps the columns unambiguous
 * when the role column is empty.
 */
const LIST_LINE = /^\s*(\S+)\s+(.*?)\s*line\s+(\d+)\s+\((\d+) chars\)\s*$/;

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCatalogue(fileName) {
    return String(fileName || '').endsWith(CATALOGUE_SUFFIX);
}

/**
 * A catalogue's display label: the filename minus the suffix, dashes back to
 * spaces, first letter up. 'Scene' and 'City' without a lookup table that a
 * third file would have to be added to.
 */
function catalogueLabel(fileName) {
    const name = String(fileName || '');
    const stem = name.endsWith(CATALOGUE_SUFFIX)
        ? name.slice(0, -CATALOGUE_SUFFIX.length) : name;
    const words = stem.replace(/-+/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/**
 * A still's display name: the filename stem with ComfyUI's _00001_ counter
 * dropped and _slug's dashes turned back into spaces, so
 * Canyon-Skirmish_00001_.png reads as "Canyon Skirmish". Cosmetic and safe to
 * get wrong - a stem that does not match that shape is shown as it is.
 */
function displayName(fileName) {
    const base = String(fileName || '').replace(/\.[^.]+$/, '');
    const stem = base.replace(/_\d+_$/, '');
    const words = stem.replace(/-+/g, ' ').trim();
    return words || base;
}

/**
 * The entries `--filter` can select, read off the script's own --list rather
 * than reparsed from the markdown here. A JS reimplementation would be a
 * second copy of parse_prompts' judgment (SKIP_HEADINGS, MIN_PROMPT_CHARS,
 * fenced-or-quoted blocks, Alt2 labels) free to drift from it. --list returns
 * before find_server, so it costs one Python start and no ComfyUI.
 *
 * Non-matching lines are ignored, so the banner line generate-art.py prints
 * first cannot become a phantom entry.
 */
function parseListOutput(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
        const m = LIST_LINE.exec(line);
        if (!m) continue;
        out.push({ prefix: m[1], role: m[2], line: Number(m[3]), chars: Number(m[4]) });
    }
    return out;
}

/**
 * The first 200 characters of the prompt block starting at `line` (1-based),
 * blockquote markers stripped, stopping at the first blank line or fence.
 */
function excerptAt(lines, line) {
    const body = [];
    for (let i = line - 1; i >= 0 && i < lines.length; i += 1) {
        const raw = lines[i];
        if (!raw.trim() || raw.startsWith('```')) break;
        body.push(raw.replace(/^>\s?/, '').trim());
    }
    return body.join(' ').slice(0, 200);
}

/**
 * --list gives a slug and a line number, not a title. Walk the markdown once
 * and attach the nearest heading at or above each entry's line plus an
 * excerpt of its prompt, so the picker shows "Pilot's Quarters - Planetrise
 * Through the Porthole" rather than the slug. Display only: nothing
 * downstream depends on it, so a heading this misses degrades to a blank name
 * and the client falls back to the prefix.
 */
function attachHeadings(entries, fileText) {
    const lines = String(fileText || '').split(/\r?\n/);
    return (entries || []).map((entry) => {
        let name = '';
        for (let i = Math.min(entry.line - 1, lines.length - 1); i >= 0; i -= 1) {
            const m = /^#{1,6}\s+(.*?)\s*$/.exec(lines[i]);
            if (m) { name = m[1]; break; }
        }
        return { ...entry, name, excerpt: excerptAt(lines, entry.line) };
    });
}

/**
 * The argv for one generate-art.py run.
 *
 * Three things are load-bearing. The filter is anchored and escaped, because
 * --filter is compiled case-insensitively and matched with re.search against
 * entry.key OR entry.name: unanchored, one entry whose slug is a prefix of
 * another's would render both, and unescaped a heading's own punctuation
 * would be regex syntax. --manifest points inside backgroundsDir, because the
 * script's default is the mech catalogue's record at the generator root. And
 * the size defaults to 1920x1080, which is what every '### Settings' block in
 * these catalogues asks for.
 */
function renderArgs(scriptPath, {
    catalogue, prefix, backgroundsDir, variants = 1, width = 1920, height = 1080, seed = null,
} = {}) {
    if (typeof scriptPath !== 'string' || !scriptPath) throw new Error('renderArgs needs the script path');
    if (typeof catalogue !== 'string' || !catalogue) throw new Error('renderArgs needs the catalogue path');
    if (typeof prefix !== 'string' || !prefix) throw new Error('renderArgs needs the entry prefix');
    if (typeof backgroundsDir !== 'string' || !backgroundsDir) {
        throw new Error('renderArgs needs the backgrounds directory');
    }
    if (!Number.isInteger(variants) || variants < 1 || variants > 8) {
        throw new Error('renderArgs needs variants between 1 and 8');
    }
    if (!Number.isInteger(width) || width < 1) throw new Error('renderArgs needs a positive integer width');
    if (!Number.isInteger(height) || height < 1) throw new Error('renderArgs needs a positive integer height');
    if (seed !== null && (!Number.isInteger(seed) || seed < 0)) {
        throw new Error('renderArgs needs a non-negative integer seed, or null to roll one');
    }
    return [
        scriptPath,
        '--prompts', catalogue,
        '--filter', `^${escapeRegExp(prefix)}$`,
        '--variants', String(variants),
        '--width', String(width),
        '--height', String(height),
        '--output-prefix', OUTPUT_PREFIX,
        '--download-to', backgroundsDir,
        '--manifest', path.join(backgroundsDir, RENDER_MANIFEST),
        ...(seed === null ? [] : ['--seed', String(seed)]),
    ];
}

/**
 * The argv for one animate-portrait.py --background run. Every field
 * required, the way animate.animateArgs validates its own: the script would
 * happily default --out beside the source and roll its own seed, but a run
 * the server cannot name the output of, or cannot record the seed of, is a
 * run the panel cannot show.
 *
 * -d rather than --roll, for the reason lib/animate.js gives: the draw
 * happens on this side, where it can be shown, re-rolled and pinned before a
 * multi-minute render is paid for, and the sidecar records what was sent.
 *
 * Nothing --background sets is overridden here, so the size, frame count and
 * negative prompt stay whatever the generator repo decides they should be.
 */
function animateArgs(scriptPath, { still, out, description, seed, pingpong = true } = {}) {
    if (typeof scriptPath !== 'string' || !scriptPath) throw new Error('animateArgs needs the script path');
    if (typeof still !== 'string' || !still) throw new Error('animateArgs needs the still path');
    if (typeof out !== 'string' || !out) throw new Error('animateArgs needs the output path');
    if (typeof description !== 'string' || !description) throw new Error('animateArgs needs a description');
    if (!Number.isInteger(seed) || seed < 0) throw new Error('animateArgs needs a non-negative integer seed');
    return [
        scriptPath, still, '--background', '--out', out, '-d', description, '--seed', String(seed),
        ...(pingpong ? [] : ['--no-pingpong']),
    ];
}

/**
 * The loop and its record, beside the still and named from its stem, so a
 * folder listing reads as one set. Mirrors animate.animationFiles. Takes and
 * returns a '/'-separated rel path, which is what crosses the API.
 */
function animationFilesFor(rel) {
    const s = String(rel || '');
    const dot = s.lastIndexOf('.');
    const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    const stem = dot > slash ? s.slice(0, dot) : s;
    return { webp: `${stem}${ANIMATED_SUFFIX}.webp`, sidecar: `${stem}${ANIMATED_SUFFIX}.json` };
}

/** Whether a filename is this module's own animation output, not a still. */
function isAnimationFile(fileName) {
    return /\sAnimated\.webp$/i.test(String(fileName || ''));
}

/**
 * Resolves a client-supplied rel inside root, or null. Every filename that
 * reaches a route passes through here before anything opens it. Pure, so the
 * traversal refusals are unit-tested without a server.
 *
 * The trailing-separator check is the point: a bare startsWith(root) would
 * accept a sibling directory whose name merely starts with the root's.
 */
function resolveInside(root, rel) {
    if (typeof rel !== 'string' || !rel) return null;
    if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return null;
    const base = path.resolve(root);
    const target = path.resolve(base, ...rel.split('/'));
    if (target === base) return target;
    return target.startsWith(base + path.sep) ? target : null;
}

/**
 * The enabled bullets of the Background Animation table, from
 * tableBullets.readTables' output. Disabled bullets are left out - the Tables
 * tab switched them off, and offering one here would be the one place the
 * switch did not reach.
 *
 * readTables returns tables per heading, so reading this one good table out of
 * a file whose Backdrop and Spaceships tables are hard-wrapped (and therefore
 * silently truncated by the bullet regex) is safe. Only this table is offered.
 */
function motionPromptsFrom(tables) {
    const table = (tables || []).find((t) => t.name === MOTION_TABLE);
    if (!table) return [];
    return table.bullets.filter((b) => b.enabled).map((b) => b.text);
}

module.exports = {
    CATALOGUE_SUFFIX, MOTION_TABLE, IMAGE_EXTENSIONS, RENDER_MANIFEST, OUTPUT_PREFIX,
    escapeRegExp, isCatalogue, catalogueLabel, displayName,
    parseListOutput, attachHeadings, renderArgs, animateArgs,
    animationFilesFor, isAnimationFile, resolveInside, motionPromptsFrom,
    // Re-exported from lib/animate.js unchanged rather than reimplemented: the
    // sidecar shape is the same and so is the staleness question, and
    // pickDescription is already parameterised on its pool, so this is an
    // alias and not a copy. The background sidecar therefore records the
    // still's mtime under `portraitVersion` - deliberately, so isStale needs
    // no second version of itself.
    parseSidecar: animate.parseSidecar,
    isStale: animate.isStale,
    pickMotionPrompt: animate.pickDescription,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/backgrounds.test.js`
Expected: PASS, every test in the file.

- [ ] **Step 5: Commit**

```
git add lib/backgrounds.js test/backgrounds.test.js
git commit -m "a pure module for backgrounds, and why the catalogue comes from the script's own --list"
```

---

### Task 3: The read side — `GET /api/backgrounds`, `GET /api/backgrounds/image`, and `features`

**Files:**
- Modify: `server.js` — the `require` block near line 64, the derived-path block near line 208, a new section after `animationView` (line 1373), the `/api/categories` return (line 2479), and two new routes
- Test: `test/api.backgrounds.test.js` (create, port `5237`)

**Interfaces:**
- Consumes: every export of `lib/backgrounds.js` from Task 2; `fileVersion(file)` and `tableBullets.readTables(path)` already in `server.js`.
- Produces, for Tasks 4 and 5 to build on:
  - `backgroundCatalogueFiles(): string[]` — catalogue filenames, sorted
  - `backgroundsMissing(): string[]` — one sentence per missing piece
  - `backgroundsAvailable(): boolean`
  - `readCatalogueEntries(file: string): Promise<Array<{prefix, role, line, chars, name, excerpt}>>`
  - `walkBackgrounds(dir?, rel?, depth?, out?): string[]` — `/`-separated rels
  - `backgroundAbs(rel: string): string`
  - `backgroundItemView(rel: string): object | null`
  - `backgroundMotionPrompts(): string[]`
  - `backgroundJobs: Map<string, object>` and `backgroundAnimateByRel: Map<string, string>`
  - `BACKGROUND_LOG_LIMIT: number`, `BACKGROUND_CONTENT_TYPES: object`
- Produces, on the wire: `GET /api/backgrounds` and `GET /api/backgrounds/image?rel=&v=`, and a `features: string[]` field on `GET /api/categories`.

- [ ] **Step 1: Write the failing test**

Create `test/api.backgrounds.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

// Unique to this file: node --test runs test files as concurrent processes
// and every server in this suite binds a fixed port.
const PORT = 5237;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

// The catalogue the stub's --list output describes. The prompt blocks sit at
// lines 5 and 11 so attachHeadings finds the '##' headings at 3 and 9.
const CATALOGUE_TEXT = [
    '# Scene & Background Art Prompts',                                   // 1
    '',                                                                   // 2
    '## Canyon Skirmish — A Night Raid',                                  // 3
    '',                                                                   // 4
    '> A wide cinematic establishing shot of a scorched canyon at night.', // 5
    '> Bold black linework throughout.',                                  // 6
    '',                                                                   // 7
    '',                                                                   // 8
    '## Dropship Yard',                                                   // 9
    '',                                                                   // 10
    '> A dropship yard at dusk under low cloud.',                         // 11
    '',                                                                   // 12
].join('\n');

// Both tables from the real file's shape: Backdrop hard-wrapped (and so
// silently truncated by the bullet regex, which has never been parseable) and
// Background Animation one physical line per bullet. Reading the good table
// out of a file holding a bad one is the thing being pinned.
const BACKGROUND_TABLES_TEXT = [
    '## Backdrop',
    '',
    '- a ruined hab block under low cloud, its upper floors sheared away',
    '  and rebar hanging loose over the street below',
    '',
    '## Background Animation',
    '',
    '- smoke drifts slowly across the scene. the camera is locked off.',
    '<!-- - rain falls steadily and runs off every hard edge. the camera is locked off. -->',
    '- snow falls gently over the wreckage. the camera is locked off.',
    '',
].join('\n');

// A Node stub standing in for generate-art.py, run through
// pythonExecutable: process.execPath - the trick api.createArgs.test.js uses,
// so asserting on the argv never needs a Python interpreter on PATH. --list
// reproduces the real "  %-58s %-20s line %-5d (%d chars)" columns, including
// an entry whose role column is empty.
const GENERATE_ART_STUB = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    "const valueOf = (flag) => { const i = args.indexOf(flag); return i === -1 ? '' : args[i + 1]; };",
    "const pad = (s, n) => String(s) + ' '.repeat(Math.max(1, n - String(s).length));",
    "if (args.includes('--list')) {",
    "    console.log(path.basename(valueOf('--prompts')) + ': 2 prompts found, 2 selected');",
    "    console.log('  ' + pad('Canyon-Skirmish', 58) + pad('A Night Raid', 20) + 'line ' + pad(5, 5) + '(120 chars)');",
    "    console.log('  ' + pad('Dropship-Yard', 58) + pad('', 20) + 'line ' + pad(11, 5) + '(140 chars)');",
    '    process.exit(0);',
    '}',
    "const root = valueOf('--download-to');",
    'fs.mkdirSync(root, { recursive: true });',
    "fs.writeFileSync(path.join(root, '.render-argv.json'), JSON.stringify(args));",
    "const dest = path.join(root, 'LancerBackgrounds');",
    'fs.mkdirSync(dest, { recursive: true });',
    "const variants = Number(valueOf('--variants') || 1);",
    'for (let n = 1; n <= variants; n += 1) {',
    "    fs.writeFileSync(path.join(dest, 'Canyon-Skirmish_0000' + n + '_.png'), 'PNG');",
    '}',
    "console.log('wrote ' + variants + ' still(s)');",
].join('\n');

// The animate stub: writes the .webp where --out says and appends its own
// argv to a dotfile the gallery walk skips, one line per run, so the chain
// test can count runs and read back what each was told to do.
const ANIMATE_STUB = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    "const valueOf = (flag) => { const i = args.indexOf(flag); return i === -1 ? '' : args[i + 1]; };",
    "const out = valueOf('--out');",
    "fs.writeFileSync(out, 'WEBP');",
    "fs.appendFileSync(path.join(path.dirname(out), '..', '.animate-argv.jsonl'), JSON.stringify(args) + '\\n');",
    "console.log('animated');",
].join('\n');

/**
 * The fixture tree, built before the server starts because extraConfig has to
 * name absolute paths. Independent of startTestServer's own tmp dir, and
 * removed by the caller's t.after.
 */
function makeFixture({ withArt = true, withAnimate = true, withCatalogue = true } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-gui-bg-'));
    const promptsDir = path.join(dir, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    if (withCatalogue) {
        fs.writeFileSync(path.join(promptsDir, 'scene-background-art-prompts.md'), CATALOGUE_TEXT);
    }
    const tablesPath = path.join(dir, 'scene-and-spaceship-tables.md');
    fs.writeFileSync(tablesPath, BACKGROUND_TABLES_TEXT);
    const backgroundsDir = path.join(dir, 'output', 'backgrounds');
    fs.mkdirSync(path.join(backgroundsDir, 'LancerBackgrounds'), { recursive: true });
    const artScript = path.join(dir, 'generate-art.js');
    if (withArt) fs.writeFileSync(artScript, GENERATE_ART_STUB);
    const animateScript = path.join(dir, 'animate-portrait.js');
    if (withAnimate) fs.writeFileSync(animateScript, ANIMATE_STUB);
    return {
        dir,
        promptsDir,
        tablesPath,
        backgroundsDir,
        extraConfig: {
            pythonExecutable: process.execPath,
            generateArtScript: artScript,
            animatePortraitScript: animateScript,
            backgroundsDir,
            backgroundPromptsDir: promptsDir,
            backgroundTablesPath: tablesPath,
        },
    };
}

async function startWithFixture(t, options) {
    const fixture = makeFixture(options);
    const server = await startTestServer({
        tablesText: TABLES_FIXTURE, port: PORT, extraConfig: fixture.extraConfig,
    });
    t.after(() => {
        server.stop();
        fs.rmSync(fixture.dir, { recursive: true, force: true });
    });
    return { server, fixture };
}

function writeStill(fixture, rel, body = 'PNG') {
    const file = path.join(fixture.backgroundsDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
}

async function getJson(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    return { status: res.status, body: await res.json() };
}

/* ---- the read side ---- */

test('GET /api/backgrounds walks nested stills and skips loops and dotfiles', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    writeStill(fixture, 'Loose.png');
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_ Animated.webp', 'WEBP');
    fs.writeFileSync(path.join(fixture.backgroundsDir, '.backgrounds-manifest.json'), '{}');

    const { body } = await getJson(server, '/api/backgrounds');
    assert.equal(body.available, true);
    const rels = body.items.map((i) => i.rel).sort();
    assert.deepEqual(rels, ['LancerBackgrounds/Canyon-Skirmish_00001_.png', 'Loose.png']);
});

test('GET /api/backgrounds pairs a still with its sidecar and names it', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    const still = writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_ Animated.webp', 'WEBP');
    fs.writeFileSync(
        path.join(fixture.backgroundsDir, 'LancerBackgrounds', 'Canyon-Skirmish_00001_ Animated.json'),
        JSON.stringify({
            description: 'smoke drifts slowly across the scene. the camera is locked off.',
            seed: 42,
            portraitVersion: Math.round(fs.statSync(still).mtimeMs),
        }));

    const { body } = await getJson(server, '/api/backgrounds');
    const item = body.items.find((i) => i.rel.endsWith('Canyon-Skirmish_00001_.png'));
    assert.equal(item.name, 'Canyon Skirmish');
    assert.equal(item.animation.seed, 42);
    assert.match(item.animation.description, /^smoke drifts/);
    assert.equal(item.animation.stale, false);
});

test('GET /api/backgrounds flags a loop whose still has been re-rendered', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_ Animated.webp', 'WEBP');
    fs.writeFileSync(
        path.join(fixture.backgroundsDir, 'LancerBackgrounds', 'Canyon-Skirmish_00001_ Animated.json'),
        JSON.stringify({ description: 'smoke drifts', seed: 42, portraitVersion: 1 }));

    const { body } = await getJson(server, '/api/backgrounds');
    const item = body.items.find((i) => i.rel.endsWith('Canyon-Skirmish_00001_.png'));
    assert.equal(item.animation.stale, true);
});

test('GET /api/backgrounds reports the catalogue, its label and its entries', async (t) => {
    const { server } = await startWithFixture(t);
    const { body } = await getJson(server, '/api/backgrounds');
    assert.equal(body.catalogues.length, 1);
    const [catalogue] = body.catalogues;
    assert.equal(catalogue.file, 'scene-background-art-prompts.md');
    assert.equal(catalogue.label, 'Scene');
    assert.deepEqual(catalogue.entries.map((e) => e.prefix), ['Canyon-Skirmish', 'Dropship-Yard']);
    assert.equal(catalogue.entries[0].name, 'Canyon Skirmish — A Night Raid');
    assert.equal(catalogue.entries[0].role, 'A Night Raid');
    assert.match(catalogue.entries[0].excerpt, /^A wide cinematic establishing shot/);
    assert.equal(catalogue.entries[1].role, '', 'the empty role column must stay empty');
});

test('GET /api/backgrounds ships the enabled Background Animation bullets only', async (t) => {
    const { server } = await startWithFixture(t);
    const { body } = await getJson(server, '/api/backgrounds');
    assert.deepEqual(body.motionPrompts, [
        'smoke drifts slowly across the scene. the camera is locked off.',
        'snow falls gently over the wreckage. the camera is locked off.',
    ]);
});

test('GET /api/backgrounds answers available:false and names what is missing', async (t) => {
    const { server } = await startWithFixture(t, { withArt: false });
    const { status, body } = await getJson(server, '/api/backgrounds');
    assert.equal(status, 200, 'the route answers rather than 404s');
    assert.equal(body.available, false);
    assert.equal(body.items.length, 0);
    assert.ok(body.missing.some((m) => /generate-art\.py not found at /.test(m)));
});

test('GET /api/backgrounds is unavailable with no catalogue to pick from', async (t) => {
    const { server } = await startWithFixture(t, { withCatalogue: false });
    const { body } = await getJson(server, '/api/backgrounds');
    assert.equal(body.available, false);
    assert.ok(body.missing.some((m) => /background-art-prompts\.md/.test(m)));
});

test('GET /api/categories carries the backgrounds feature when it is installed', async (t) => {
    const { server } = await startWithFixture(t);
    const { body } = await getJson(server, '/api/categories');
    assert.deepEqual(body.features, ['backgrounds']);
});

test('GET /api/categories reports no features when the script is absent', async (t) => {
    const { server } = await startWithFixture(t, { withArt: false });
    const { body } = await getJson(server, '/api/categories');
    assert.deepEqual(body.features, []);
});

/* ---- the image route ---- */

test('GET /api/backgrounds/image serves a still with the right type', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    const res = await fetch(
        `${server.baseUrl}/api/backgrounds/image?rel=${encodeURIComponent('LancerBackgrounds/Canyon-Skirmish_00001_.png')}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(await res.text(), 'PNG');
});

test('GET /api/backgrounds/image refuses a traversal and an unknown file', async (t) => {
    const { server } = await startWithFixture(t);
    const up = await getJson(server,
        `/api/backgrounds/image?rel=${encodeURIComponent('../../secrets.txt')}`);
    assert.equal(up.status, 400);
    const gone = await getJson(server, '/api/backgrounds/image?rel=nope.png');
    assert.equal(gone.status, 404);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/api.backgrounds.test.js`
Expected: FAIL — every `/api/backgrounds` request 404s, and `body.features` is `undefined`.

- [ ] **Step 3: Wire the module and the paths into `server.js`**

After `const animate = require('./lib/animate');` (line 64):

```js
const backgrounds = require('./lib/backgrounds');
```

After the `animatePortraitScript` destructure (line 208):

```js
// The Backgrounds tab's four paths. A background is not a kind - no manifest
// entry, no traits, no Foundry import - so it has no registry row to read
// these off, and they are destructured here the way the two kindless scripts
// above are. See lib/backgrounds.js for why the folder is the source of truth.
const {
    generateArtScript: GENERATE_ART_SCRIPT,
    backgroundsDir: BACKGROUNDS_DIR,
    backgroundPromptsDir: BACKGROUND_PROMPTS_DIR,
    backgroundTablesPath: BACKGROUND_TABLES_PATH,
} = DERIVED_PATHS;
```

- [ ] **Step 4: Add the backgrounds section to `server.js`**

Immediately after `animationView` ends (line 1373), before the `/* Create NPC */` banner:

```js
/* ------------------------------------------------------------------ */
/* Backgrounds                                                         */
/* ------------------------------------------------------------------ */

const BACKGROUND_LOG_LIMIT = 20000;   // chars of stdout+stderr kept per job
const BACKGROUND_LIST_LIMIT = 200000; // chars of --list output kept per catalogue
const BACKGROUND_WALK_DEPTH = 6;

const BACKGROUND_CONTENT_TYPES = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

/** Every render and animate job this tab has started, keyed by its own id. */
const backgroundJobs = new Map();

/** Which job is animating each still, so a second click on one is a 409. */
const backgroundAnimateByRel = new Map();

function backgroundCatalogueFiles() {
    try {
        return fs.readdirSync(BACKGROUND_PROMPTS_DIR)
            .filter((file) => backgrounds.isCatalogue(file))
            .sort();
    } catch {
        return [];
    }
}

/**
 * Which of the three pieces the tab needs are not here, as sentences. Checked
 * per request the way kinds.available() is and for the same reason: dropping
 * generate-art.py into place should not need a server restart to be noticed,
 * and this route is fetched on a tab visit, not polled.
 */
function backgroundsMissing() {
    const missing = [];
    if (!fs.existsSync(GENERATE_ART_SCRIPT)) {
        missing.push(`generate-art.py not found at ${GENERATE_ART_SCRIPT}`);
    }
    if (!fs.existsSync(ANIMATE_PORTRAIT_SCRIPT)) {
        missing.push(`animate-portrait.py not found at ${ANIMATE_PORTRAIT_SCRIPT}`);
    }
    if (!backgroundCatalogueFiles().length) {
        missing.push(`no *${backgrounds.CATALOGUE_SUFFIX} found in ${BACKGROUND_PROMPTS_DIR}`);
    }
    return missing;
}

function backgroundsAvailable() {
    return backgroundsMissing().length === 0;
}

/**
 * One catalogue's entries, from the script's own --list rather than a second
 * markdown parser here - see lib/backgrounds.js's parseListOutput for why.
 * One child process per catalogue file; the route runs them concurrently.
 *
 * Every failure resolves to an empty list rather than rejecting: the picker
 * is the only thing that depends on this, and an empty entry list with a
 * visible "no entries" state beats a 500 on the whole tab.
 */
function readCatalogueEntries(file) {
    const full = path.join(BACKGROUND_PROMPTS_DIR, file);
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(config.pythonExecutable,
                [GENERATE_ART_SCRIPT, '--prompts', full, '--list'],
                { cwd: path.dirname(GENERATE_ART_SCRIPT) });
        } catch {
            return resolve([]);
        }
        let out = '';
        child.stdout.on('data', (chunk) => {
            if (out.length < BACKGROUND_LIST_LIMIT) out += chunk.toString();
        });
        child.stderr.on('data', () => { /* --list's diagnostics are not the picker's business */ });
        child.on('error', () => resolve([]));
        child.on('close', () => {
            let text = '';
            try {
                text = fs.readFileSync(full, 'utf8');
            } catch { /* names and excerpts degrade to blank, which the client handles */ }
            resolve(backgrounds.attachHeadings(backgrounds.parseListOutput(out), text));
        });
    });
}

/**
 * Every still under backgroundsDir, as '/'-separated relative paths.
 *
 * Depth-capped because this walks a folder a GM owns by hand and a link loop
 * there should not hang a page load. Dotfiles are skipped, which is what
 * keeps .backgrounds-manifest.json out of the gallery, and so is this
 * module's own animation output: a loop belongs on its still's card, not as a
 * card of its own.
 */
function walkBackgrounds(dir = BACKGROUNDS_DIR, rel = '', depth = 0, out = []) {
    if (depth > BACKGROUND_WALK_DEPTH) return out;
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            walkBackgrounds(path.join(dir, entry.name), childRel, depth + 1, out);
            continue;
        }
        if (!backgrounds.IMAGE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue;
        if (backgrounds.isAnimationFile(entry.name)) continue;
        out.push(childRel);
    }
    return out;
}

function backgroundAbs(rel) {
    return path.join(BACKGROUNDS_DIR, ...String(rel).split('/'));
}

function readBackgroundSidecar(sidecarRel) {
    try {
        return backgrounds.parseSidecar(fs.readFileSync(backgroundAbs(sidecarRel), 'utf8'));
    } catch {
        return {}; // no sidecar - no loop yet, which is not an error
    }
}

/**
 * One gallery card: the still, whatever loop sits beside it, and whatever
 * this server's own job is doing to it. Both urls carry the file's mtime as
 * the cache-buster /api/animation-image's does.
 */
function backgroundItemView(rel) {
    const mtime = fileVersion(backgroundAbs(rel));
    if (mtime === null) return null; // deleted between the walk and here
    const files = backgrounds.animationFilesFor(rel);
    const builtAt = fileVersion(backgroundAbs(files.webp));
    const sidecar = readBackgroundSidecar(files.sidecar);
    const jobId = backgroundAnimateByRel.get(rel);
    const job = jobId ? backgroundJobs.get(jobId) : null;
    return {
        rel,
        name: backgrounds.displayName(path.basename(rel)),
        mtime,
        url: `/api/backgrounds/image?rel=${encodeURIComponent(rel)}&v=${mtime}`,
        // Only ever present with a loop on disk - a stale nothing is nothing.
        animation: builtAt === null ? null : {
            webp: files.webp,
            url: `/api/backgrounds/image?rel=${encodeURIComponent(files.webp)}&v=${builtAt}`,
            description: sidecar.description || null,
            seed: Number.isInteger(sidecar.seed) ? sidecar.seed : null,
            builtAt,
            stale: backgrounds.isStale(sidecar, mtime),
        },
        status: job ? job.status : null,
        error: job && job.status === 'error' ? job.error : null,
    };
}

/**
 * The motion prompts, read off the tables file on every call - the Tables tab
 * edits that file, and a list cached at startup would keep offering a bullet
 * it had just switched off. The same reason animationDescriptions has.
 */
function backgroundMotionPrompts() {
    try {
        return backgrounds.motionPromptsFrom(tableBullets.readTables(BACKGROUND_TABLES_PATH));
    } catch {
        return [];
    }
}
```

- [ ] **Step 5: Add the two read routes**

In `handleApi`, after the `/api/animation-image` route (line 2719):

```js
    if (url.pathname === '/api/backgrounds' && req.method === 'GET') {
        const missing = backgroundsMissing();
        if (missing.length) {
            // Answered rather than 404'd, so the client can say which piece is
            // missing instead of showing an empty tab with no explanation.
            return sendJson(res, 200, {
                available: false, missing, dir: BACKGROUNDS_DIR,
                catalogues: [], motionPrompts: [], items: [],
            });
        }
        const files = backgroundCatalogueFiles();
        const entries = await Promise.all(files.map((file) => readCatalogueEntries(file)));
        return sendJson(res, 200, {
            available: true,
            missing: [],
            dir: BACKGROUNDS_DIR,
            catalogues: files.map((file, i) => ({
                file, label: backgrounds.catalogueLabel(file), entries: entries[i],
            })),
            motionPrompts: backgroundMotionPrompts(),
            items: walkBackgrounds()
                .map((rel) => backgroundItemView(rel))
                .filter(Boolean)
                .sort((a, b) => b.mtime - a.mtime),
        });
    }

    if (url.pathname === '/api/backgrounds/image' && req.method === 'GET') {
        const file = backgrounds.resolveInside(BACKGROUNDS_DIR, url.searchParams.get('rel'));
        if (!file) return sendJson(res, 400, { error: 'rel must be a path inside the backgrounds folder' });
        const type = BACKGROUND_CONTENT_TYPES[path.extname(file).toLowerCase()];
        if (!type || !fs.existsSync(file)) return sendJson(res, 404, { error: 'no such image' });
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
        return;
    }
```

- [ ] **Step 6: Add `features` to `/api/categories`**

Replace the return at `server.js:2479`:

```js
        return sendJson(res, 200, {
            categories,
            kinds: Object.keys(available(KINDS)),
            // Features are what kinds cannot be. A background has no manifest
            // entry, no traits and no registry row, so it cannot ride `kinds`
            // - but the question the client is asking is the same one, and so
            // is the per-request filesystem check that answers it.
            features: backgroundsAvailable() ? ['backgrounds'] : [],
        });
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node --test test/api.backgrounds.test.js`
Expected: PASS, eleven tests.

- [ ] **Step 8: Commit**

```
git add server.js test/api.backgrounds.test.js
git commit -m "read the backgrounds folder and the catalogues, and let features ride beside kinds"
```

---

### Task 4: `POST /api/backgrounds/render` and `GET /api/backgrounds/status`

**Files:**
- Modify: `server.js` — extend the backgrounds section from Task 3, add two routes
- Test: `test/api.backgrounds.test.js` (extend)

**Interfaces:**
- Consumes: everything Task 3 produced, plus `backgrounds.renderArgs`.
- Produces:
  - `startBackgroundRenderJob(opts): {ok: true, jobId: string} | {ok: false, status: number, error: string}` where `opts` is `{catalogue, prefix, variants, seed, width, height, animateWhenDone}` and `animateWhenDone` is `null` or `{pingpong: boolean}`
  - `POST /api/backgrounds/render` → `202 {jobId}`
  - `GET /api/backgrounds/status?jobId=` → `200 {status, kind, rel, log, error, produced, chain, chainError}`
- The `chain` and `chainError` fields are populated by Task 5; this task ships them as `[]` and `null`.

- [ ] **Step 1: Write the failing test**

Append to `test/api.backgrounds.test.js`:

```js
/* ---- rendering ---- */

async function postJson(server, p, body) {
    const res = await fetch(`${server.baseUrl}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

/** Polls a background job to a terminal state, the way the client does. */
async function waitForJob(server, jobId, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const { body } = await getJson(server,
            `/api/backgrounds/status?jobId=${encodeURIComponent(jobId)}`);
        if (body.status !== 'running') return body;
        if (Date.now() > deadline) throw new Error(`job never finished: ${JSON.stringify(body)}`);
        await new Promise((r) => setTimeout(r, 50));
    }
}

test('POST /api/backgrounds/render refuses an unknown catalogue', async (t) => {
    const { server } = await startWithFixture(t);
    const { status, body } = await postJson(server, '/api/backgrounds/render',
        { catalogue: 'nope.md', prefix: 'Canyon-Skirmish' });
    assert.equal(status, 400);
    assert.match(body.error, /unknown catalogue "nope\.md"/);
});

test('POST /api/backgrounds/render refuses an unknown prefix', async (t) => {
    const { server } = await startWithFixture(t);
    const { status, body } = await postJson(server, '/api/backgrounds/render',
        { catalogue: 'scene-background-art-prompts.md', prefix: 'Not-An-Entry' });
    assert.equal(status, 400);
    assert.match(body.error, /unknown entry "Not-An-Entry"/);
});

test('POST /api/backgrounds/render refuses variants outside 1-8', async (t) => {
    const { server } = await startWithFixture(t);
    const { status, body } = await postJson(server, '/api/backgrounds/render',
        { catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish', variants: 12 });
    assert.equal(status, 400);
    assert.match(body.error, /variants/);
});

test('POST /api/backgrounds/render says where the script should have been', async (t) => {
    const { server } = await startWithFixture(t, { withArt: false });
    const { status, body } = await postJson(server, '/api/backgrounds/render',
        { catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish' });
    assert.equal(status, 400);
    assert.match(body.error, /generate-art\.py not found at /);
});

test('a render spawns the anchored filter and a manifest inside backgroundsDir', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    const { status, body } = await postJson(server, '/api/backgrounds/render', {
        catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish', seed: 11,
    });
    assert.equal(status, 202);
    const job = await waitForJob(server, body.jobId);
    assert.equal(job.status, 'done');
    assert.equal(job.produced, 1);

    const argv = JSON.parse(
        fs.readFileSync(path.join(fixture.backgroundsDir, '.render-argv.json'), 'utf8'));
    // A hyphen is not regex syntax outside a character class, so escapeRegExp
    // leaves it alone and the anchors are the only addition.
    assert.equal(argv[argv.indexOf('--filter') + 1], '^Canyon-Skirmish$');
    assert.equal(argv[argv.indexOf('--manifest') + 1],
        path.join(fixture.backgroundsDir, '.backgrounds-manifest.json'));
    assert.equal(argv[argv.indexOf('--download-to') + 1], fixture.backgroundsDir);
    assert.equal(argv[argv.indexOf('--seed') + 1], '11');
});

test('a render with a null seed omits --seed and lets the script roll one', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    const { body } = await postJson(server, '/api/backgrounds/render', {
        catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish', seed: null,
    });
    await waitForJob(server, body.jobId);
    const argv = JSON.parse(
        fs.readFileSync(path.join(fixture.backgroundsDir, '.render-argv.json'), 'utf8'));
    assert.ok(!argv.includes('--seed'));
});

test('a finished render shows up in the gallery', async (t) => {
    const { server } = await startWithFixture(t);
    const { body } = await postJson(server, '/api/backgrounds/render',
        { catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish' });
    await waitForJob(server, body.jobId);
    const { body: listing } = await getJson(server, '/api/backgrounds');
    assert.ok(listing.items.some((i) => i.rel === 'LancerBackgrounds/Canyon-Skirmish_00001_.png'));
});

test('GET /api/backgrounds/status 404s an unknown job', async (t) => {
    const { server } = await startWithFixture(t);
    const { status } = await getJson(server, '/api/backgrounds/status?jobId=nope');
    assert.equal(status, 404);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/api.backgrounds.test.js`
Expected: FAIL on the eight new tests with 404s from `/api/backgrounds/render`.

- [ ] **Step 3: Add `startBackgroundRenderJob`**

At the end of the backgrounds section in `server.js`, after `backgroundMotionPrompts`:

```js
/**
 * Spawns generate-art.py for one catalogue entry.
 *
 * The before/after snapshot is startCreateJob's technique, taken for the
 * reason it states: exit code 0 means the script did not crash, not that it
 * wrote anything, and ComfyUI can drop a job. A run that produced nothing
 * reports produced: 0 and a log tail rather than a success the gallery
 * cannot show.
 */
function startBackgroundRenderJob({
    catalogue, prefix, variants, seed, width, height, animateWhenDone,
}) {
    if (!fs.existsSync(GENERATE_ART_SCRIPT)) {
        return { ok: false, status: 400, error: `generate-art.py not found at ${GENERATE_ART_SCRIPT}` };
    }
    let args;
    try {
        args = backgrounds.renderArgs(GENERATE_ART_SCRIPT, {
            catalogue: path.join(BACKGROUND_PROMPTS_DIR, catalogue),
            prefix,
            backgroundsDir: BACKGROUNDS_DIR,
            variants,
            width,
            height,
            seed,
        });
    } catch (err) {
        return { ok: false, status: 400, error: err.message };
    }

    // --download-to creates the tree itself, but the snapshot below has to be
    // taken against a directory that exists or a first run reads as "one new
    // file appeared" for every file the script wrote plus nothing it did not.
    try {
        fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true });
    } catch (err) {
        return { ok: false, status: 500, error: `couldn't create ${BACKGROUNDS_DIR}: ${err.message}` };
    }
    const before = new Set(walkBackgrounds());

    const jobId = crypto.randomUUID();
    const job = {
        kind: 'render', status: 'running', startedAt: Date.now(), log: '',
        produced: null, chain: [], chainError: null,
    };
    backgroundJobs.set(jobId, job);

    let child;
    try {
        child = spawn(config.pythonExecutable, args, { cwd: path.dirname(GENERATE_ART_SCRIPT) });
    } catch (err) {
        job.status = 'error';
        job.error = err.message;
        return { ok: true, jobId };
    }

    const collect = (chunk) => { job.log = (job.log + chunk.toString()).slice(-BACKGROUND_LOG_LIMIT); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => { job.status = 'error'; job.error = err.message; });
    child.on('close', (code) => {
        if (job.status === 'error') return; // already failed via the 'error' event
        job.doneAt = Date.now();
        if (code !== 0) {
            job.status = 'error';
            job.error = job.log.trim() || `generate-art.py exited with code ${code}`;
            return;
        }
        const added = walkBackgrounds().filter((rel) => !before.has(rel));
        job.produced = added.length;
        if (animateWhenDone) chainAnimations(job, added, animateWhenDone);
        // Flipped LAST, deliberately. The client stops polling the moment this
        // stops being 'running', so a chain recorded after the flip would be
        // invisible to the run that started it - and the status route would
        // hand back a finished render with an empty chain.
        job.status = 'done';
    });

    return { ok: true, jobId };
}

/**
 * Filled in by the animate task. Kept as a no-op here so the render job's
 * close handler has one shape whether or not the chain is wired.
 */
function chainAnimations(job, added, options) { // eslint-disable-line no-unused-vars
    job.chain = [];
}
```

Note: `chainAnimations` is replaced wholesale in Task 5. It exists here only so this task ships green on its own.

- [ ] **Step 4: Add the two routes**

After the `/api/backgrounds/image` route:

```js
    if (url.pathname === '/api/backgrounds/render' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }

        const catalogue = typeof body.catalogue === 'string' ? body.catalogue : '';
        if (!backgroundCatalogueFiles().includes(catalogue)) {
            return sendJson(res, 400, { error: `unknown catalogue "${catalogue}"` });
        }

        const variants = body.variants === undefined || body.variants === null
            ? 1 : Number(body.variants);
        if (!Number.isInteger(variants) || variants < 1 || variants > 8) {
            return sendJson(res, 400, { error: 'variants must be an integer between 1 and 8' });
        }

        const width = body.width === undefined || body.width === null ? 1920 : Number(body.width);
        const height = body.height === undefined || body.height === null ? 1080 : Number(body.height);
        if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
            return sendJson(res, 400, { error: 'width and height must be positive integers' });
        }

        // Two seed modes, not the three /api/regenerate has: a still is
        // rendered, never regenerated in place, so there is no previous seed
        // for "same" to mean. null omits the flag and the script rolls its own.
        let seed = null;
        if (body.seed !== null && body.seed !== undefined && body.seed !== '') {
            seed = Number(body.seed);
            if (!Number.isInteger(seed) || seed < 0) {
                return sendJson(res, 400, { error: 'seed must be a non-negative integer, or null' });
            }
        }

        // The prefix is checked against the script's own --list, which is the
        // only list that agrees with what --filter can select.
        const entries = await readCatalogueEntries(catalogue);
        const prefix = typeof body.prefix === 'string' ? body.prefix : '';
        if (!entries.some((entry) => entry.prefix === prefix)) {
            return sendJson(res, 400, { error: `unknown entry "${prefix}" in ${catalogue}` });
        }

        const result = startBackgroundRenderJob({
            catalogue, prefix, variants, seed, width, height,
            animateWhenDone: body.animateWhenDone ? { pingpong: body.pingpong !== false } : null,
        });
        return sendJson(res, result.ok ? 202 : result.status, result);
    }

    if (url.pathname === '/api/backgrounds/status' && req.method === 'GET') {
        const jobId = url.searchParams.get('jobId');
        const job = jobId && backgroundJobs.get(jobId);
        if (!job) return sendJson(res, 404, { error: 'unknown job' });
        return sendJson(res, 200, {
            status: job.status,
            kind: job.kind,
            rel: job.rel ?? null,
            log: job.log,
            error: job.error ?? null,
            // How many stills landed, or null when it was not measured (still
            // going, or the run failed). Told apart from a measured zero.
            produced: job.produced ?? null,
            // The animate jobs this render started, each watched separately so
            // a failed loop is visible as itself rather than retroactively
            // failing a render that did produce a still.
            chain: job.chain ?? [],
            chainError: job.chainError ?? null,
        });
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/api.backgrounds.test.js`
Expected: PASS, nineteen tests.

- [ ] **Step 6: Commit**

```
git add server.js test/api.backgrounds.test.js
git commit -m "render one catalogue entry, and count what actually landed rather than what was asked for"
```

---

### Task 5: `POST /api/backgrounds/animate` and the opt-in chain

**Files:**
- Modify: `server.js` — extend the backgrounds section, replace `chainAnimations`, add one route
- Test: `test/api.backgrounds.test.js` (extend)

**Interfaces:**
- Consumes: everything Tasks 3 and 4 produced, plus `backgrounds.animateArgs` and `backgrounds.pickMotionPrompt`.
- Produces:
  - `startBackgroundAnimateJob({rel, description, seedMode, seed, pingpong}): {ok: true, jobId} | {ok: false, status, error}`
  - `chainAnimations(job, added: string[], {pingpong: boolean}): void` — replaces the Task 4 stub
  - `POST /api/backgrounds/animate` → `202 {jobId}`
  - The sidecar written beside each loop: `{description, seed, when, portraitVersion}`

**Note on `seedMode` validation.** The spec's §4 says `seedMode` is "validated identically to `/api/regenerate` and `/api/animation`", and its §7 test plan says the route "refuses a bad `seedMode`". Those two cannot both hold: the existing routes *coerce* an unrecognised `seedMode` to `same` rather than refusing. This task follows "validated identically" — coerce to `same`, and refuse only a malformed seed under `specific`. That keeps one rule for seed modes across every route in the file; a second, stricter rule for one route would be the thing that drifts.

- [ ] **Step 1: Write the failing test**

Append to `test/api.backgrounds.test.js`:

```js
/* ---- animating ---- */

function readAnimateRuns(fixture) {
    // The stub writes one line per run into backgroundsDir, as a dotfile the
    // gallery walk skips - which is exactly what makes it safe to leave there.
    const file = path.join(fixture.backgroundsDir, '.animate-argv.jsonl');
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('POST /api/backgrounds/animate refuses a traversal in rel', async (t) => {
    const { server } = await startWithFixture(t);
    const { status, body } = await postJson(server, '/api/backgrounds/animate',
        { rel: '../../secrets.txt', description: 'smoke drifts' });
    assert.equal(status, 400);
    assert.match(body.error, /inside the backgrounds folder/);
});

test('POST /api/backgrounds/animate 404s a still that is not there', async (t) => {
    const { server } = await startWithFixture(t);
    const { status } = await postJson(server, '/api/backgrounds/animate',
        { rel: 'nope.png', description: 'smoke drifts' });
    assert.equal(status, 404);
});

test('POST /api/backgrounds/animate says where the script should have been', async (t) => {
    const { server, fixture } = await startWithFixture(t, { withAnimate: false });
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    const { status, body } = await postJson(server, '/api/backgrounds/animate', {
        rel: 'LancerBackgrounds/Canyon-Skirmish_00001_.png', description: 'smoke drifts',
    });
    assert.equal(status, 400);
    assert.match(body.error, /animate-portrait\.py not found at /);
});

test('POST /api/backgrounds/animate refuses a malformed specific seed', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    const { status, body } = await postJson(server, '/api/backgrounds/animate', {
        rel: 'LancerBackgrounds/Canyon-Skirmish_00001_.png',
        description: 'smoke drifts', seedMode: 'specific', seed: -3,
    });
    assert.equal(status, 400);
    assert.match(body.error, /seed/);
});

test('an animate run writes the loop, the sidecar and --background', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    const { status, body } = await postJson(server, '/api/backgrounds/animate', {
        rel: 'LancerBackgrounds/Canyon-Skirmish_00001_.png',
        description: 'smoke drifts slowly', seedMode: 'specific', seed: 99, pingpong: false,
    });
    assert.equal(status, 202);
    const job = await waitForJob(server, body.jobId);
    assert.equal(job.status, 'done');

    const [argv] = readAnimateRuns(fixture);
    assert.ok(argv.includes('--background'));
    assert.ok(argv.includes('--no-pingpong'));
    assert.equal(argv[argv.indexOf('-d') + 1], 'smoke drifts slowly');
    assert.equal(argv[argv.indexOf('--seed') + 1], '99');

    const sidecar = JSON.parse(fs.readFileSync(path.join(fixture.backgroundsDir,
        'LancerBackgrounds', 'Canyon-Skirmish_00001_ Animated.json'), 'utf8'));
    assert.equal(sidecar.description, 'smoke drifts slowly');
    assert.equal(sidecar.seed, 99);
    assert.equal(typeof sidecar.portraitVersion, 'number');
});

test("seedMode 'same' reuses the seed in the existing sidecar", async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    fs.writeFileSync(path.join(fixture.backgroundsDir, 'LancerBackgrounds',
        'Canyon-Skirmish_00001_ Animated.json'),
        JSON.stringify({ description: 'old', seed: 1234, portraitVersion: 1 }));

    const { body } = await postJson(server, '/api/backgrounds/animate', {
        rel: 'LancerBackgrounds/Canyon-Skirmish_00001_.png',
        description: 'rain falls', seedMode: 'same',
    });
    await waitForJob(server, body.jobId);
    const [argv] = readAnimateRuns(fixture);
    assert.equal(argv[argv.indexOf('--seed') + 1], '1234');
});

test('the loop reaches the gallery on the still it was made from', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    writeStill(fixture, 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    const { body } = await postJson(server, '/api/backgrounds/animate', {
        rel: 'LancerBackgrounds/Canyon-Skirmish_00001_.png', description: 'smoke drifts',
    });
    await waitForJob(server, body.jobId);

    const { body: listing } = await getJson(server, '/api/backgrounds');
    const item = listing.items.find((i) => i.rel === 'LancerBackgrounds/Canyon-Skirmish_00001_.png');
    assert.ok(item.animation, 'the still should now carry its loop');
    assert.equal(item.animation.description, 'smoke drifts');
    assert.equal(listing.items.length, 1, 'the loop must not become a card of its own');
});

/* ---- the opt-in chain ---- */

test('animateWhenDone starts one loop per new still, each with its own prompt', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    const { body } = await postJson(server, '/api/backgrounds/render', {
        catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish',
        variants: 2, animateWhenDone: true,
    });
    const render = await waitForJob(server, body.jobId);
    assert.equal(render.status, 'done');
    assert.equal(render.produced, 2);
    assert.equal(render.chain.length, 2, 'one animate job per still that landed');

    for (const link of render.chain) {
        const loop = await waitForJob(server, link.jobId);
        assert.equal(loop.status, 'done', `chained loop for ${link.rel} failed: ${loop.error}`);
        assert.equal(loop.rel, link.rel);
    }

    // The pool holds two enabled bullets and pickMotionPrompt avoids the one
    // just used, so two variants must get two different prompts rather than
    // sharing the one the panel happened to be showing.
    const runs = readAnimateRuns(fixture);
    assert.equal(runs.length, 2);
    const prompts = runs.map((argv) => argv[argv.indexOf('-d') + 1]);
    assert.notEqual(prompts[0], prompts[1]);
    const seeds = runs.map((argv) => argv[argv.indexOf('--seed') + 1]);
    assert.notEqual(seeds[0], seeds[1], 'each still gets its own seed');
});

test('a render without animateWhenDone chains nothing', async (t) => {
    const { server, fixture } = await startWithFixture(t);
    const { body } = await postJson(server, '/api/backgrounds/render',
        { catalogue: 'scene-background-art-prompts.md', prefix: 'Canyon-Skirmish' });
    const render = await waitForJob(server, body.jobId);
    assert.deepEqual(render.chain, []);
    assert.equal(readAnimateRuns(fixture).length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/api.backgrounds.test.js`
Expected: FAIL on the nine new tests, with 404s from `/api/backgrounds/animate` and an empty `chain`.

- [ ] **Step 3: Add `startBackgroundAnimateJob` and replace `chainAnimations`**

Delete the `chainAnimations` stub from Task 4 and put both of these at the end of the backgrounds section:

```js
/**
 * Spawns animate-portrait.py --background for one still.
 *
 * The sidecar is written on success only, and holds the still's mtime under
 * `portraitVersion` - the same key animate.isStale reads, which is why that
 * function needs no second version of itself here.
 */
function startBackgroundAnimateJob({ rel, description, seedMode, seed, pingpong }) {
    const still = backgrounds.resolveInside(BACKGROUNDS_DIR, rel);
    if (!still) {
        return { ok: false, status: 400, error: 'rel must be a path inside the backgrounds folder' };
    }
    if (!fs.existsSync(still)) return { ok: false, status: 404, error: 'no such background' };
    if (!fs.existsSync(ANIMATE_PORTRAIT_SCRIPT)) {
        return {
            ok: false, status: 400,
            error: `animate-portrait.py not found at ${ANIMATE_PORTRAIT_SCRIPT}`,
        };
    }
    const runningId = backgroundAnimateByRel.get(rel);
    if (runningId && backgroundJobs.get(runningId)?.status === 'running') {
        return { ok: false, status: 409, error: 'this background is already being animated' };
    }
    if (typeof description !== 'string' || !description) {
        return {
            ok: false, status: 400,
            error: `${path.basename(BACKGROUND_TABLES_PATH)} has no enabled `
                + `'## ${backgrounds.MOTION_TABLE}' bullets to draw a description from`,
        };
    }

    const files = backgrounds.animationFilesFor(rel);
    const out = backgroundAbs(files.webp);
    const sidecarPath = backgroundAbs(files.sidecar);
    const previous = readBackgroundSidecar(files.sidecar);

    // The same three modes as /api/regenerate and /api/animation. 'same' with
    // no loop yet is a fresh draw rather than an error: the panel defaults to
    // it, and the first click should simply work.
    const newSeed = seedMode === 'specific' ? seed
        : seedMode === 'same' && Number.isInteger(previous.seed) ? previous.seed
        : crypto.randomInt(0, 2 ** 32 - 1);

    let args;
    try {
        args = backgrounds.animateArgs(ANIMATE_PORTRAIT_SCRIPT, {
            still, out, description, seed: newSeed, pingpong: pingpong !== false,
        });
    } catch (err) {
        return { ok: false, status: 400, error: err.message };
    }

    const jobId = crypto.randomUUID();
    const job = {
        kind: 'animate', rel, status: 'running', startedAt: Date.now(), log: '',
        description, seed: newSeed,
    };
    backgroundJobs.set(jobId, job);
    backgroundAnimateByRel.set(rel, jobId);

    let child;
    try {
        child = spawn(config.pythonExecutable, args, { cwd: path.dirname(ANIMATE_PORTRAIT_SCRIPT) });
    } catch (err) {
        job.status = 'error';
        job.error = err.message;
        return { ok: true, jobId };
    }

    const collect = (chunk) => { job.log = (job.log + chunk.toString()).slice(-BACKGROUND_LOG_LIMIT); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => { job.status = 'error'; job.error = err.message; });
    child.on('close', (code) => {
        if (job.status === 'error') return;
        job.doneAt = Date.now();
        // The file has to be there, not merely an exit code of 0 - same
        // reason the render job counts rather than trusts.
        if (code !== 0 || !fs.existsSync(out)) {
            job.status = 'error';
            job.error = job.log.trim() || `animate-portrait.py exited with code ${code}`;
            return;
        }
        job.status = 'done';
        try {
            fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
            fs.writeFileSync(sidecarPath, JSON.stringify({
                description,
                seed: newSeed,
                when: new Date().toISOString(),
                portraitVersion: fileVersion(still),
            }, null, 2));
        } catch { /* the loop is on disk; a missing sidecar only loses the record */ }
    });

    return { ok: true, jobId };
}

/**
 * The opt-in chain: one animate job per still the render actually produced,
 * started from the render's own close handler on exit code 0.
 *
 * Each still gets its OWN motion prompt and its own seed rather than all
 * sharing the one the panel was showing. The variants are different images,
 * and giving them one description would spend the pool on the run where it is
 * least likely to fit all of them. What was actually used lands in that
 * still's own sidecar, so the gallery can always say what made each loop.
 *
 * The parent reports done once its own render finished; the client watches
 * these ids separately, so a failed loop is visible as itself rather than
 * retroactively failing a render that did produce a still.
 */
function chainAnimations(job, added, { pingpong }) {
    const pool = backgroundMotionPrompts();
    if (!pool.length) {
        job.chainError = `${path.basename(BACKGROUND_TABLES_PATH)} has no enabled `
            + `'## ${backgrounds.MOTION_TABLE}' bullets, so nothing was animated`;
        return;
    }
    let last = null;
    for (const rel of added) {
        const description = backgrounds.pickMotionPrompt(pool, { exclude: last });
        last = description;
        const started = startBackgroundAnimateJob({
            rel, description, seedMode: 'random', pingpong,
        });
        if (started.ok) job.chain.push({ rel, jobId: started.jobId });
        else job.chainError = started.error;
    }
}
```

- [ ] **Step 4: Add the animate route**

After the `/api/backgrounds/render` route:

```js
    if (url.pathname === '/api/backgrounds/animate' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (err) {
            return sendJson(res, 400, { error: err.message });
        }

        // Coerced, not refused, exactly as /api/regenerate and /api/animation
        // treat an unrecognised mode - one rule for seed modes across the file.
        const seedMode = ['same', 'specific', 'random'].includes(body.seedMode) ? body.seedMode : 'same';
        let seed;
        if (seedMode === 'specific') {
            seed = Number(body.seed);
            if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32 - 1) {
                return sendJson(res, 400, { error: 'seed must be an integer between 0 and 4294967295' });
            }
        }

        const result = startBackgroundAnimateJob({
            rel: typeof body.rel === 'string' ? body.rel : '',
            description: typeof body.description === 'string' ? body.description.trim() : '',
            seedMode,
            seed,
            pingpong: body.pingpong !== false,
        });
        return sendJson(res, result.ok ? 202 : result.status, result);
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/api.backgrounds.test.js`
Expected: PASS, twenty-eight tests.

- [ ] **Step 6: Commit**

```
git add server.js test/api.backgrounds.test.js
git commit -m "animate a background, and give each variant in a chain its own prompt and seed"
```

---

### Task 6: The feature gate, the tab and the render panel

**Files:**
- Modify: `public/index.html` — one tab button, one `#tab-backgrounds` section
- Modify: `public/app.js` — `applyFeatureAvailability`, `loadCategories`, `switchTab`, and the Backgrounds block
- Modify: `public/style.css`
- Test: `test/ui.backgrounds.test.js` (create, port `5238`)

**Interfaces:**
- Consumes: `GET /api/categories`'s `features`, `GET /api/backgrounds`, `POST /api/backgrounds/render`, `GET /api/backgrounds/status`.
- Produces, as top-level functions in `app.js` that Task 7 and the tests use by name:
  - `applyFeatureAvailability(features)`
  - `backgroundsState` and `elBackgrounds` objects
  - `loadBackgrounds(): Promise<void>`
  - `renderBackgroundsPanel()`, `renderBackgroundCatalogues()`, `renderBackgroundEntries()`
  - `backgroundEntryLabel(entry): string`
  - `pollBackgroundJob(jobId, {statusEl, logEl, button, running, onDone}): number`
  - `startBackgroundRender(): Promise<void>`
  - `renderBackgroundGallery()` and `openBackgroundAnimate(rel)` — declared in Task 7; `renderBackgroundsPanel` calls the first, so Task 6 ships a version that calls it and Task 7 fills it in.

- [ ] **Step 1: Write the failing test**

Create `test/ui.backgrounds.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// There is no DOM harness in this repo - same approach as
// ui.shipCreate.test.js and ui.kindVocab.test.js: fetch the served
// /index.html and /app.js over HTTP and check them either by
// source-assertion or by lifting a pure top-level function out and running it.
const PORT = 5238;

const TABLES_FIXTURE = ['## Pronouns', '- she/her/her/woman', ''].join('\n');

async function fetchText(server, p) {
    const res = await fetch(`${server.baseUrl}${p}`);
    assert.equal(res.status, 200, `${p} should be served`);
    return res.text();
}

/** Copied from ui.shipCreate.test.js - app.js touches `document` as it loads
 *  and so cannot be required directly. */
function liftFunction(js, name, helpers = {}) {
    const start = js.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `app.js no longer defines ${name}`);
    let depth = 0;
    let end = -1;
    for (let i = js.indexOf('{', start); i < js.length; i += 1) {
        if (js[i] === '{') depth += 1;
        if (js[i] === '}') {
            depth -= 1;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    assert.notEqual(end, -1, `could not find the end of ${name}`);
    const names = Object.keys(helpers);
    // eslint-disable-next-line no-new-func
    return new Function(...names, `${js.slice(start, end)}\nreturn ${name};`)(
        ...names.map((k) => helpers[k]));
}

/** A document with one [data-feature] node, recording what got removed. */
function fakeDocument(features) {
    const removed = [];
    const nodes = features.map((feature) => ({
        dataset: { feature },
        remove() { removed.push(feature); },
    }));
    return {
        removed,
        querySelectorAll(sel) {
            assert.equal(sel, '[data-feature]');
            return nodes;
        },
        // An active tab button always survives here, so the fallback click
        // never fires and never needs a stub of its own.
        querySelector() { return {}; },
    };
}

test('index.html carries the Backgrounds tab and its panel', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/index.html');
    assert.match(html, /data-tab="backgrounds"[^>]*data-feature="backgrounds"/,
        'the tab button must carry data-feature="backgrounds"');
    assert.match(html, /id="tab-backgrounds"/, 'no #tab-backgrounds panel');
    // The panel itself must NOT carry data-feature: elBackgrounds reads its
    // ids at load, and removing the panel would leave every one of them null.
    // The ship tab sets the same precedent.
    const panel = /<section class="tab-panel" id="tab-backgrounds"[^>]*>/.exec(html);
    assert.ok(panel, 'no #tab-backgrounds section tag');
    assert.ok(!/data-feature/.test(panel[0]), 'the panel must not be removable');
});

test('applyFeatureAvailability removes a feature the server did not report', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    const doc = fakeDocument(['backgrounds']);
    liftFunction(js, 'applyFeatureAvailability', { document: doc })([]);
    assert.deepEqual(doc.removed, ['backgrounds'],
        'an EMPTY features array must remove the node - that is the whole gate');
});

test('applyFeatureAvailability keeps a feature the server did report', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    const doc = fakeDocument(['backgrounds']);
    liftFunction(js, 'applyFeatureAvailability', { document: doc })(['backgrounds']);
    assert.deepEqual(doc.removed, []);
});

test('applyFeatureAvailability changes nothing for a missing or malformed field', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    for (const value of [undefined, null, 'backgrounds', 7, { backgrounds: true }]) {
        const doc = fakeDocument(['backgrounds']);
        liftFunction(js, 'applyFeatureAvailability', { document: doc })(value);
        assert.deepEqual(doc.removed, [],
            `a ${typeof value} features field must degrade to today's UI`);
    }
});

test('loadCategories hands features to applyFeatureAvailability', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const source = js.slice(js.indexOf('async function loadCategories('));
    assert.match(source.slice(0, 800), /applyFeatureAvailability\(features\)/,
        'loadCategories must apply the feature gate as well as the kind gate');
});

test('backgroundEntryLabel falls back to the prefix when no heading was found', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const label = liftFunction(js, 'backgroundEntryLabel');
    assert.equal(label({ name: 'Canyon Skirmish — A Night Raid', prefix: 'Canyon-Skirmish' }),
        'Canyon Skirmish — A Night Raid');
    assert.equal(label({ name: '', prefix: 'Canyon-Skirmish' }), 'Canyon-Skirmish');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/ui.backgrounds.test.js`
Expected: FAIL — `no #tab-backgrounds panel`, and `app.js no longer defines applyFeatureAvailability`.

- [ ] **Step 3: Add the tab button and the panel to `public/index.html`**

After the Create Spaceship button in `#tabs`:

```html
    <!-- data-feature is data-kind's sibling for things that are not kinds. A
         background has no manifest entry, no traits and no registry row, so
         it cannot ride `kinds`; applyFeatureAvailability removes every
         [data-feature] node the server did not report in /api/categories'
         `features`. On the button only, never on the panel below: elBackgrounds
         reads the panel's ids as app.js loads, and removing the panel would
         leave all of them null. The ship tab sets the same precedent. -->
    <button type="button" data-tab="backgrounds" data-feature="backgrounds">Backgrounds</button>
```

After the `#tab-shipcreate` section closes:

```html
<section class="tab-panel" id="tab-backgrounds" hidden>
  <p class="regen-status" id="bg-unavailable" hidden></p>

  <div class="bg-render">
    <h2>Render a background</h2>
    <div class="filter-row">
      <label>Catalogue <select id="bg-catalogue"></select></label>
      <label>Variants <input type="number" id="bg-variants" min="1" max="8" value="1" /></label>
      <label>Width <input type="number" id="bg-width" min="64" value="1920" /></label>
      <label>Height <input type="number" id="bg-height" min="64" value="1080" /></label>
    </div>
    <div class="bg-entries" id="bg-entries"></div>
    <div class="filter-row">
      <label><input type="checkbox" id="bg-roll-seed" checked /> Roll a seed</label>
      <label>Seed <input type="number" id="bg-seed" min="0" disabled /></label>
      <label><input type="checkbox" id="bg-animate-when-done" /> Animate each still when it lands</label>
      <label><input type="checkbox" id="bg-chain-pingpong" checked /> Ping-pong those loops</label>
    </div>
    <button type="button" id="bg-render-btn">Render</button>
    <p class="regen-status" id="bg-render-status"></p>
    <pre class="job-log" id="bg-render-log" hidden></pre>
  </div>

  <div class="bg-gallery" id="bg-gallery"></div>

  <div class="bg-animate" id="bg-animate" hidden>
    <h2 id="bg-animate-title"></h2>
    <img class="bg-animate-still" id="bg-animate-still" alt="" />
    <div class="bg-motion">
      <textarea id="bg-motion-text" rows="3"></textarea>
      <button type="button" id="bg-motion-reroll">Re-roll</button>
    </div>
    <div class="filter-row">
      <label><input type="radio" name="bg-seed-mode" value="same" checked /> Same seed</label>
      <label><input type="radio" name="bg-seed-mode" value="specific" /> This seed</label>
      <input type="number" id="bg-animate-seed" min="0" disabled />
      <label><input type="radio" name="bg-seed-mode" value="random" /> Roll one</label>
      <label><input type="checkbox" id="bg-pingpong" checked /> Ping-pong</label>
    </div>
    <img class="bg-animate-loop" id="bg-animate-loop" alt="" hidden />
    <button type="button" id="bg-animate-btn">Animate</button>
    <button type="button" id="bg-animate-close">Close</button>
    <p class="regen-status" id="bg-animate-status"></p>
    <pre class="job-log" id="bg-animate-log" hidden></pre>
  </div>
</section>
```

- [ ] **Step 4: Add `applyFeatureAvailability` and wire `loadCategories`**

In `public/app.js`, immediately after `applyKindAvailability` (line 600):

```js
/**
 * Removes the affordances of every feature this install cannot offer, given
 * /api/categories' `features`.
 *
 * data-kind's sibling, one step sideways: a background is not a kind - no
 * manifest entry, no traits, no registry row - so it cannot ride `kinds`, and
 * anything in index.html carrying data-feature is an affordance for exactly
 * that feature and nothing else.
 *
 * TWO ways to answer "leave everything alone", not the three
 * applyKindAvailability has. A missing `features` field (a server too old to
 * send one) and a non-array both mean change nothing, exactly as there. An
 * EMPTY array does not, and that difference is deliberate: for kinds an empty
 * list means no generator script whatsoever, which is a misconfiguration; for
 * features it is the ordinary state of an install without generate-art.py,
 * and honouring it is the entire point of the gate.
 */
function applyFeatureAvailability(features) {
  if (!Array.isArray(features)) return;
  const have = new Set(features);
  for (const node of document.querySelectorAll('[data-feature]')) {
    if (!have.has(node.dataset.feature)) node.remove();
  }
  // The same recovery applyKindAvailability has, and for the same reason: a
  // removed tab button that was the active one would leave its panel open
  // with no button to leave it by.
  if (!document.querySelector('#tabs button.active')) {
    document.querySelector('#tabs button[data-tab="import"]')?.click();
  }
}
```

In `loadCategories`, change the destructure and add one call:

```js
  const { categories, kinds, features } = await api('/api/categories');
  // Before the early return below: an install with no generated content yet is
  // precisely the one that must not be offered a Create Spaceship tab it has
  // no generator for.
  applyKindAvailability(kinds);
  applyFeatureAvailability(features);
```

- [ ] **Step 5: Add the Backgrounds block to `public/app.js`**

At the end of the file:

```js
/* ==================================================================== */
/* Backgrounds                                                           */
/* ==================================================================== */

/**
 * Deliberately a parallel block rather than the Create form or the detail
 * overlay made generic, in the shape shipCreateState established. Ten
 * ui.*.test.js files lift functions out of this file by name and
 * brace-matching, so parameterising render(), openDetail() or
 * traitControlCells() would be a contract break needing its own review rather
 * than a mechanical edit. Nothing here renames anything.
 *
 * A background has no manifest entry and no id: a still is its path relative
 * to the server's backgrounds folder, and the folder is the source of truth.
 * A file deleted in Explorer is gone from this tab on the next refresh, and
 * one dropped in by hand appears.
 */
const backgroundsState = {
  loaded: false,
  available: false,
  missing: [],
  catalogues: [],
  motionPrompts: [],
  items: [],
  catalogue: '',
  prefix: '',
  selected: null, // the rel the Animate panel is open on
  motion: null,
  renderTimer: null,
  animateTimer: null,
};

const elBackgrounds = {
  unavailable: document.getElementById('bg-unavailable'),
  catalogue: document.getElementById('bg-catalogue'),
  entries: document.getElementById('bg-entries'),
  variants: document.getElementById('bg-variants'),
  width: document.getElementById('bg-width'),
  height: document.getElementById('bg-height'),
  rollSeed: document.getElementById('bg-roll-seed'),
  seed: document.getElementById('bg-seed'),
  animateWhenDone: document.getElementById('bg-animate-when-done'),
  chainPingpong: document.getElementById('bg-chain-pingpong'),
  renderBtn: document.getElementById('bg-render-btn'),
  renderStatus: document.getElementById('bg-render-status'),
  renderLog: document.getElementById('bg-render-log'),
  gallery: document.getElementById('bg-gallery'),
  panel: document.getElementById('bg-animate'),
  panelTitle: document.getElementById('bg-animate-title'),
  panelStill: document.getElementById('bg-animate-still'),
  panelLoop: document.getElementById('bg-animate-loop'),
  motionText: document.getElementById('bg-motion-text'),
  motionReroll: document.getElementById('bg-motion-reroll'),
  animateSeed: document.getElementById('bg-animate-seed'),
  pingpong: document.getElementById('bg-pingpong'),
  animateBtn: document.getElementById('bg-animate-btn'),
  animateClose: document.getElementById('bg-animate-close'),
  animateStatus: document.getElementById('bg-animate-status'),
  animateLog: document.getElementById('bg-animate-log'),
};

async function loadBackgrounds() {
  const data = await api('/api/backgrounds');
  backgroundsState.available = !!data.available;
  backgroundsState.missing = data.missing || [];
  backgroundsState.catalogues = data.catalogues || [];
  backgroundsState.motionPrompts = data.motionPrompts || [];
  backgroundsState.items = data.items || [];
  backgroundsState.loaded = true;
  // Keep the chosen catalogue across a refresh when it is still there, and
  // fall to the first one when it is not - a catalogue can be added or
  // removed on disk between two visits to this tab.
  if (!backgroundsState.catalogues.some((c) => c.file === backgroundsState.catalogue)) {
    backgroundsState.catalogue = backgroundsState.catalogues.length
      ? backgroundsState.catalogues[0].file : '';
    backgroundsState.prefix = '';
  }
  renderBackgroundsPanel();
}

function renderBackgroundsPanel() {
  elBackgrounds.unavailable.hidden = backgroundsState.available;
  elBackgrounds.unavailable.textContent = backgroundsState.available
    ? '' : `The Backgrounds tab needs: ${backgroundsState.missing.join('; ')}.`;
  elBackgrounds.renderBtn.disabled = !backgroundsState.available;
  renderBackgroundCatalogues();
  renderBackgroundEntries();
  renderBackgroundGallery();
}

function renderBackgroundCatalogues() {
  elBackgrounds.catalogue.innerHTML = '';
  for (const catalogue of backgroundsState.catalogues) {
    const opt = document.createElement('option');
    opt.value = catalogue.file;
    opt.textContent = catalogue.label;
    opt.selected = catalogue.file === backgroundsState.catalogue;
    elBackgrounds.catalogue.appendChild(opt);
  }
}

/**
 * What one catalogue entry is called. The heading the server attached when it
 * could find one, and the slug otherwise - attachHeadings is display-only, so
 * a heading it missed degrades to the name --filter will actually be given.
 */
function backgroundEntryLabel(entry) {
  return entry.name || entry.prefix;
}

function renderBackgroundEntries() {
  elBackgrounds.entries.innerHTML = '';
  const catalogue = backgroundsState.catalogues.find((c) => c.file === backgroundsState.catalogue);
  const entries = catalogue ? catalogue.entries : [];
  if (!entries.length) {
    elBackgrounds.entries.textContent = backgroundsState.available
      ? 'No entries in this catalogue.' : '';
    return;
  }
  if (!entries.some((e) => e.prefix === backgroundsState.prefix)) {
    backgroundsState.prefix = entries[0].prefix;
  }
  for (const entry of entries) {
    const row = document.createElement('label');
    row.className = 'bg-entry';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'bg-entry';
    radio.value = entry.prefix;
    radio.checked = entry.prefix === backgroundsState.prefix;
    radio.addEventListener('change', () => { backgroundsState.prefix = entry.prefix; });
    row.appendChild(radio);

    const title = document.createElement('span');
    title.className = 'bg-entry-title';
    title.textContent = backgroundEntryLabel(entry);
    row.appendChild(title);

    if (entry.role) {
      const role = document.createElement('span');
      role.className = 'bg-entry-role';
      role.textContent = entry.role;
      row.appendChild(role);
    }

    const excerpt = document.createElement('span');
    excerpt.className = 'bg-entry-excerpt';
    excerpt.textContent = entry.excerpt || '';
    row.appendChild(excerpt);

    elBackgrounds.entries.appendChild(row);
  }
}

/**
 * Polls one background job to a terminal state. Its own function rather than
 * a fifth parameterisation of pollCreateJob: that one reads
 * /api/create-status, drives a dry-run button this panel does not have, and
 * is lifted by name in two existing tests.
 */
function pollBackgroundJob(jobId, { statusEl, logEl, button, running, onDone }) {
  let ticks = 0;
  const timer = setInterval(async () => {
    ticks += 1;
    let job;
    try {
      job = await api(`/api/backgrounds/status?jobId=${encodeURIComponent(jobId)}`);
    } catch (err) {
      clearInterval(timer);
      button.disabled = false;
      statusEl.textContent = `Lost track of the job: ${err.message}`;
      return;
    }
    logEl.hidden = !job.log;
    logEl.textContent = job.log || '';
    if (job.status === 'running') {
      statusEl.textContent = running;
      // The same 20-minute safety net the other pollers have, and the same
      // obligation to hand the button back when it fires - giving up on
      // watching is a terminal path like any other.
      if (ticks > 600) {
        clearInterval(timer);
        button.disabled = false;
        statusEl.textContent =
          'Stopped watching this run after 20 minutes — it may still be going; reload to check.';
      }
      return;
    }
    clearInterval(timer);
    button.disabled = false;
    onDone(job);
  }, 2000);
  return timer;
}

async function startBackgroundRender() {
  if (!backgroundsState.prefix) {
    elBackgrounds.renderStatus.textContent = 'Choose a catalogue entry first.';
    return;
  }
  elBackgrounds.renderBtn.disabled = true;
  elBackgrounds.renderStatus.textContent = 'Starting…';
  elBackgrounds.renderLog.hidden = true;
  elBackgrounds.renderLog.textContent = '';

  const body = {
    catalogue: backgroundsState.catalogue,
    prefix: backgroundsState.prefix,
    variants: Number(elBackgrounds.variants.value) || 1,
    width: Number(elBackgrounds.width.value) || 1920,
    height: Number(elBackgrounds.height.value) || 1080,
    // null is a mode, not a missing value: it omits --seed and lets the
    // script roll its own, which is the only other seed a render has.
    seed: elBackgrounds.rollSeed.checked ? null : Number(elBackgrounds.seed.value),
    animateWhenDone: elBackgrounds.animateWhenDone.checked,
    pingpong: elBackgrounds.chainPingpong.checked,
  };

  let result;
  try {
    result = await api('/api/backgrounds/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    elBackgrounds.renderBtn.disabled = false;
    elBackgrounds.renderStatus.textContent = `Couldn't start: ${err.message}`;
    return;
  }

  backgroundsState.renderTimer = pollBackgroundJob(result.jobId, {
    statusEl: elBackgrounds.renderStatus,
    logEl: elBackgrounds.renderLog,
    button: elBackgrounds.renderBtn,
    running: 'Rendering… this takes minutes per image (ComfyUI must be running).',
    onDone: (job) => {
      if (job.status === 'error') {
        elBackgrounds.renderStatus.textContent = job.error || 'The render failed.';
      } else if (!job.produced) {
        // Exit code 0 only means the script did not crash. Say what happened
        // rather than claiming a still that is not there.
        elBackgrounds.renderStatus.textContent = 'The run finished but produced no images.';
      } else {
        const loops = job.chain.length
          ? ` ${job.chain.length} loop${job.chain.length === 1 ? '' : 's'} started.` : '';
        const failed = job.chainError ? ` ${job.chainError}.` : '';
        elBackgrounds.renderStatus.textContent =
          `Rendered ${job.produced} image${job.produced === 1 ? '' : 's'}.${loops}${failed}`;
      }
      loadBackgrounds().catch(() => { /* the gallery refreshes on the next visit */ });
    },
  });
}

elBackgrounds.catalogue.addEventListener('change', () => {
  backgroundsState.catalogue = elBackgrounds.catalogue.value;
  backgroundsState.prefix = '';
  renderBackgroundEntries();
});

elBackgrounds.rollSeed.addEventListener('change', () => {
  elBackgrounds.seed.disabled = elBackgrounds.rollSeed.checked;
  if (elBackgrounds.rollSeed.checked) elBackgrounds.seed.value = '';
});

elBackgrounds.renderBtn.addEventListener('click', () => {
  startBackgroundRender().catch((err) => {
    elBackgrounds.renderBtn.disabled = false;
    elBackgrounds.renderStatus.textContent = `Couldn't start: ${err.message}`;
  });
});
```

- [ ] **Step 6: Add a placeholder gallery renderer**

`renderBackgroundsPanel` calls `renderBackgroundGallery`, which Task 7 writes. Add this stub at the end of the block so Task 6 ships green on its own, and replace it wholesale in Task 7:

```js
/** Replaced in full by the gallery task. */
function renderBackgroundGallery() {
  elBackgrounds.gallery.textContent = '';
}
```

- [ ] **Step 7: Load the tab on the way in**

In `switchTab`, beside the other per-tab loads:

```js
  if (tab === 'backgrounds') {
    loadBackgrounds().catch((err) => {
      elBackgrounds.renderStatus.textContent = `Failed to load: ${err.message}`;
    });
  }
```

- [ ] **Step 8: Add the render-panel styles to `public/style.css`**

```css
/* Backgrounds tab */
.bg-entries { display: flex; flex-direction: column; gap: 0.35rem; margin: 0.75rem 0; }
.bg-entry { display: grid; grid-template-columns: auto auto 1fr; gap: 0.5rem; align-items: baseline; }
.bg-entry-title { font-weight: 600; }
.bg-entry-role { opacity: 0.75; font-style: italic; }
.bg-entry-excerpt { grid-column: 1 / -1; opacity: 0.65; font-size: 0.85em; }
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `node --test test/ui.backgrounds.test.js`
Expected: PASS, six tests.

- [ ] **Step 10: Commit**

```
git add public/index.html public/app.js public/style.css test/ui.backgrounds.test.js
git commit -m "a Backgrounds tab behind a feature gate, and why an empty features list is not 'change nothing'"
```

---

### Task 7: The gallery and the Animate panel

**Files:**
- Modify: `public/app.js` — replace the `renderBackgroundGallery` stub, add the Animate panel
- Modify: `public/style.css`
- Test: `test/ui.backgrounds.test.js` (extend)

**Interfaces:**
- Consumes: everything Task 6 produced; `POST /api/backgrounds/animate`.
- Produces:
  - `backgroundPills(item): string[]` — pure, lifted by the test
  - `renderBackgroundGallery()`, `selectedBackground()`, `openBackgroundAnimate(rel)`, `closeBackgroundAnimate()`, `backgroundSeedMode()`, `pickBackgroundMotion(exclude)`, `startBackgroundAnimate()`

- [ ] **Step 1: Write the failing test**

Append to `test/ui.backgrounds.test.js`:

```js
test('backgroundPills names the loop, the staleness and the running job', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    const pills = liftFunction(js, 'backgroundPills');

    assert.deepEqual(pills({ animation: null, status: null }), [],
        'a still with no loop carries no pills');
    assert.deepEqual(pills({ animation: { stale: false }, status: null }), ['Animated']);
    assert.deepEqual(pills({ animation: { stale: true }, status: null }), ['Animated', 'Stale']);
    assert.deepEqual(pills({ animation: null, status: 'running' }), ['Animating…'],
        'a stale nothing is nothing, but a running job still shows');
});

test('pickBackgroundMotion never repeats the prompt already showing', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');

    const two = liftFunction(js, 'pickBackgroundMotion', {
        backgroundsState: { motionPrompts: ['smoke drifts', 'rain falls'] },
    });
    assert.equal(two('smoke drifts'), 'rain falls');

    const one = liftFunction(js, 'pickBackgroundMotion', {
        backgroundsState: { motionPrompts: ['smoke drifts'] },
    });
    assert.equal(one('smoke drifts'), 'smoke drifts', 'a pool of one is the only honest repeat');

    const none = liftFunction(js, 'pickBackgroundMotion', {
        backgroundsState: { motionPrompts: [] },
    });
    assert.equal(none(null), null);
});

test('the Animate panel posts the text it settled on, not a staged one', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());
    const js = await fetchText(server, '/app.js');
    // There is no /api/backgrounds/description route: the motion prompt is
    // chosen in the panel, shown nowhere else, and dies with the panel.
    assert.ok(!js.includes('/api/backgrounds/description'),
        'the client must not stage a description server-side');
    const body = js.slice(js.indexOf('async function startBackgroundAnimate('));
    assert.match(body.slice(0, 1200), /description: elBackgrounds\.motionText\.value/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/ui.backgrounds.test.js`
Expected: FAIL with `app.js no longer defines backgroundPills`.

- [ ] **Step 3: Replace the gallery stub and add the panel**

In `public/app.js`, replace the `renderBackgroundGallery` stub from Task 6 with:

```js
/**
 * The pills one gallery card carries. Pure and top-level so the rule can be
 * asserted without a DOM: `stale` is only ever read off an animation that
 * exists, because a stale nothing is nothing.
 */
function backgroundPills(item) {
  const pills = [];
  if (item.status === 'running') pills.push('Animating…');
  if (item.animation) pills.push('Animated');
  if (item.animation && item.animation.stale) pills.push('Stale');
  return pills;
}

function renderBackgroundGallery() {
  elBackgrounds.gallery.innerHTML = '';
  if (!backgroundsState.items.length) {
    elBackgrounds.gallery.textContent = backgroundsState.available
      ? 'No backgrounds rendered yet.' : '';
    return;
  }
  for (const item of backgroundsState.items) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'bg-card';
    card.dataset.rel = item.rel;

    const img = document.createElement('img');
    img.src = item.url;
    img.alt = item.name;
    img.loading = 'lazy';
    card.appendChild(img);

    const name = document.createElement('div');
    name.className = 'bg-card-name';
    name.textContent = item.name;
    card.appendChild(name);

    const pills = document.createElement('div');
    pills.className = 'bg-card-pills';
    for (const text of backgroundPills(item)) {
      const pill = document.createElement('span');
      pill.className = 'bg-pill';
      pill.textContent = text;
      pills.appendChild(pill);
    }
    card.appendChild(pills);

    card.addEventListener('click', () => openBackgroundAnimate(item.rel));
    elBackgrounds.gallery.appendChild(card);
  }
}

function selectedBackground() {
  return backgroundsState.items.find((i) => i.rel === backgroundsState.selected) || null;
}

/**
 * One motion prompt from the pool the server shipped, never the one already
 * showing while the pool holds another - a Re-roll that returns the same
 * sentence reads as a button that did nothing.
 *
 * Rolled here rather than staged server-side, which is the one place this
 * panel differs from the NPC animate panel: that one stages its description
 * because it is a pseudo-trait rendered on the detail sheet and has to
 * survive a reload. A background's motion prompt is chosen immediately before
 * the render, is shown nowhere else, and dies with the panel - so the POST
 * carries the text it settled on, and the sidecar still records exactly what
 * was sent.
 */
function pickBackgroundMotion(exclude) {
  const pool = backgroundsState.motionPrompts.filter(Boolean);
  if (!pool.length) return null;
  const others = pool.filter((p) => p !== exclude);
  const from = others.length ? others : pool;
  return from[Math.floor(Math.random() * from.length)];
}

function openBackgroundAnimate(rel) {
  backgroundsState.selected = rel;
  const item = selectedBackground();
  if (!item) return;
  // What the last loop used when there is one, else a fresh draw - the panel's
  // first state should simply be usable.
  backgroundsState.motion = (item.animation && item.animation.description)
    || pickBackgroundMotion(null);
  elBackgrounds.panel.hidden = false;
  elBackgrounds.panelTitle.textContent = item.name;
  elBackgrounds.panelStill.src = item.url;
  elBackgrounds.panelStill.alt = item.name;
  elBackgrounds.panelLoop.hidden = !item.animation;
  elBackgrounds.panelLoop.src = item.animation ? item.animation.url : '';
  elBackgrounds.motionText.value = backgroundsState.motion || '';
  elBackgrounds.animateSeed.value = (item.animation && item.animation.seed !== null)
    ? item.animation.seed : '';
  elBackgrounds.animateStatus.textContent = '';
  elBackgrounds.animateLog.hidden = true;
  elBackgrounds.animateLog.textContent = '';
}

function closeBackgroundAnimate() {
  backgroundsState.selected = null;
  backgroundsState.motion = null;
  elBackgrounds.panel.hidden = true;
}

function backgroundSeedMode() {
  const checked = document.querySelector('input[name="bg-seed-mode"]:checked');
  return checked ? checked.value : 'same';
}

async function startBackgroundAnimate() {
  const item = selectedBackground();
  if (!item) return;
  if (!elBackgrounds.motionText.value.trim()) {
    elBackgrounds.animateStatus.textContent = 'Give it something to animate first.';
    return;
  }
  elBackgrounds.animateBtn.disabled = true;
  elBackgrounds.animateStatus.textContent = 'Starting…';
  elBackgrounds.animateLog.hidden = true;
  elBackgrounds.animateLog.textContent = '';

  let result;
  try {
    result = await api('/api/backgrounds/animate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rel: item.rel,
        description: elBackgrounds.motionText.value.trim(),
        seedMode: backgroundSeedMode(),
        seed: Number(elBackgrounds.animateSeed.value),
        pingpong: elBackgrounds.pingpong.checked,
      }),
    });
  } catch (err) {
    elBackgrounds.animateBtn.disabled = false;
    elBackgrounds.animateStatus.textContent = `Couldn't start: ${err.message}`;
    return;
  }

  backgroundsState.animateTimer = pollBackgroundJob(result.jobId, {
    statusEl: elBackgrounds.animateStatus,
    logEl: elBackgrounds.animateLog,
    button: elBackgrounds.animateBtn,
    running: 'Animating… a Wan render takes a few minutes (ComfyUI must be running).',
    onDone: async (job) => {
      elBackgrounds.animateStatus.textContent =
        job.status === 'error' ? (job.error || 'The animation failed.') : 'Done.';
      try {
        await loadBackgrounds();
      } catch { /* the gallery refreshes on the next visit */ }
      // Re-open on the same still so the new loop is the one showing, and
      // only while the panel is still on it.
      if (backgroundsState.selected === item.rel) openBackgroundAnimate(item.rel);
    },
  });
}

elBackgrounds.motionReroll.addEventListener('click', () => {
  const next = pickBackgroundMotion(elBackgrounds.motionText.value.trim());
  if (next === null) {
    elBackgrounds.animateStatus.textContent =
      'No enabled Background Animation bullets to draw from — check the Tables tab.';
    return;
  }
  backgroundsState.motion = next;
  elBackgrounds.motionText.value = next;
});

for (const radio of document.querySelectorAll('input[name="bg-seed-mode"]')) {
  radio.addEventListener('change', () => {
    elBackgrounds.animateSeed.disabled = backgroundSeedMode() !== 'specific';
  });
}

elBackgrounds.animateBtn.addEventListener('click', () => {
  startBackgroundAnimate().catch((err) => {
    elBackgrounds.animateBtn.disabled = false;
    elBackgrounds.animateStatus.textContent = `Couldn't start: ${err.message}`;
  });
});

elBackgrounds.animateClose.addEventListener('click', closeBackgroundAnimate);
```

- [ ] **Step 4: Add the gallery styles to `public/style.css`**

```css
.bg-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.75rem;
  margin: 1rem 0;
}
.bg-card { display: block; width: 100%; padding: 0.4rem; text-align: left; cursor: pointer; }
.bg-card img { width: 100%; height: auto; display: block; }
.bg-card-name { margin-top: 0.3rem; font-weight: 600; }
.bg-card-pills { display: flex; gap: 0.3rem; margin-top: 0.2rem; flex-wrap: wrap; }
.bg-pill { font-size: 0.75em; padding: 0 0.4em; border-radius: 0.6em; opacity: 0.85; }
.bg-animate-still, .bg-animate-loop { max-width: 100%; height: auto; display: block; }
.bg-motion { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0.5rem 0; }
.bg-motion textarea { flex: 1; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/ui.backgrounds.test.js`
Expected: PASS, nine tests.

- [ ] **Step 6: Run every new file alone, then the whole suite**

```
node --test test/backgrounds.test.js
node --test test/paths.test.js
node --test test/api.backgrounds.test.js
node --test test/ui.backgrounds.test.js
node --test test/
```

Expected: the four files pass individually. The whole-directory run may still fail `create-presets`, `set-flag` and `table-bullets` together — that is the pre-existing port collision, not a regression. Confirm no *other* file regressed, and confirm those three pass when run alone.

- [ ] **Step 7: Commit**

```
git add public/app.js public/style.css test/ui.backgrounds.test.js
git commit -m "a gallery of stills and the panel that animates one, with the prompt rolled on this side"
```

---

### Task 8: README

**Files:**
- Modify: `README.md` — the tabs section (line 122) and the config list

**Interfaces:**
- Consumes: everything above. Produces documentation only.

- [ ] **Step 1: Rename the tabs section**

`README.md:122` reads `## The five tabs`. Change it to `## The six tabs`, and check the paragraph under it for a spelled-out count to match.

- [ ] **Step 2: Add the Backgrounds subsection**

After the Create Spaceship tab's subsection, add:

```markdown
### Backgrounds

Renders scene art from the generator's background catalogues and animates any
of it into a looping `.webp` for a SillyTavern chat background.

The tab only appears when this install can actually do both halves of that:
`generate-art.py` and `animate-portrait.py` are both on disk, and at least one
`*-background-art-prompts.md` is in the prompts folder. The check is per
request, so dropping a script into place does not need a server restart.

Backgrounds are not NPCs. There is no manifest entry, no id and no Foundry
import — a background is just a file in `backgroundsDir`, and the folder is
the source of truth. Delete one in Explorer and it is gone from the tab on the
next refresh; drop one in by hand and it appears. What the GUI remembers about
a loop (its motion prompt, its seed, and the still's mtime when it was made)
lives in a JSON sidecar beside the `.webp`.

**Render.** Pick a catalogue, pick an entry, and set variants, seed and size.
The entry list is the generator's own `--list` output, so it offers exactly
what it can select. A still is rendered, never regenerated in place, so the
seed is either one you pin or one the script rolls.

**Animate each still when it lands** chains an animation onto every image a
render produces. With more than one variant each still gets its own motion
prompt and its own seed, rather than all sharing the one the panel was
showing. The render reports done once the render finished; the loops are
watched separately, so a failed animation does not retroactively fail a render
that did produce a still.

**Animate.** Click a card. The motion prompt comes from the enabled bullets of
the `## Background Animation` table in `backgroundTablesPath`; Re-roll draws
another, and you can type your own. Ping-pong and the three seed modes work as
they do for an NPC's animated portrait. A card shows **Animated** when a loop
exists and **Stale** when the still has been re-rendered since.
```

- [ ] **Step 3: Document the four config keys**

The optional keys are a bullet list under "Everything else in `config.example.json`
is optional and derived by default" (`README.md:48`), not a table. Add these
after the `animatePortraitScript` bullet, in the same voice:

```markdown
- `generateArtScript` — `generate-art.py`, behind the **Backgrounds** tab's
  Render button. Same default as the two above and the same reason to set it.
- `backgroundsDir` — every background still and loop the tab shows, and the
  only folder it reads. Defaults to `output/backgrounds` under the generator
  root. This one is worth pointing elsewhere: it is the folder you will want
  beside SillyTavern, and the tab takes whatever is in it.
- `backgroundPromptsDir` — where the scene catalogues live. Defaults to the
  folder holding `npcTablesPath`, and every `*-background-art-prompts.md` in it
  becomes a catalogue in the picker, so a new one needs no config edit.
- `backgroundTablesPath` — the file whose `## Background Animation` table is
  the motion-prompt pool. Defaults to `scene-and-spaceship-tables.md` beside
  `npcTablesPath`.
```

- [ ] **Step 4: Commit**

```
git add README.md
git commit -m "document the Backgrounds tab and its four config keys"
```

---

## Cross-repo contract assumptions

Written down because they are cross-repo and silent if they break. Nothing in this plan verifies them at runtime; each degrades rather than crashes.

- **`generate-art.py --list`'s output format** is parsed by `parseListOutput`. A change to that format yields an empty entry list and a visible "No entries in this catalogue" state, not a wrong render.
- **`--filter` matching `key` or `name` with `re.search`.** If it ever became `fullmatch`, the anchors this plan adds would still be correct.
- **`download()` preserving ComfyUI's subfolder.** If it ever flattened, the recursive walk still finds the files; only the nesting changes.
- **The `## Background Animation` heading and its one-line-per-bullet rule.** A hard-wrapped bullet added there is silently truncated by `readTables`, exactly as it is for `animate-portrait.py` itself, so both repos degrade the same way.
- **`animate-portrait.py --background`'s preset selection.** This plan passes `--background` and overrides nothing it sets, so size, frame count and negative prompt stay whatever the generator repo decides.
