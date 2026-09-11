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
