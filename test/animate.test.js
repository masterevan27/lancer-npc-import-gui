const test = require('node:test');
const assert = require('node:assert/strict');
const animate = require('../lib/animate');

test('the two files are named from the NPC, the way the portrait is', () => {
    assert.deepEqual(animate.animationFiles('Jules Sokolova'), {
        webp: 'Jules Sokolova Animated Portrait.webp',
        sidecar: 'Jules Sokolova Animated Portrait.json',
    });
});

test('the argv names the portrait, the output, the description and the seed', () => {
    const argv = animate.animateArgs('C:/gen/animate-portrait.py', {
        portrait: 'C:/out/Pilots/Jules/Jules Portrait.png',
        out: 'C:/out/Pilots/Jules/Jules Animated Portrait.webp',
        description: 'the wind moves her hair. the camera does not move.',
        seed: 42,
    });
    assert.deepEqual(argv, [
        'C:/gen/animate-portrait.py',
        'C:/out/Pilots/Jules/Jules Portrait.png',
        '--out', 'C:/out/Pilots/Jules/Jules Animated Portrait.webp',
        '-d', 'the wind moves her hair. the camera does not move.',
        '--seed', '42',
    ]);
});

test('every argv field is required, seed included', () => {
    const ok = { portrait: 'p.png', out: 'o.webp', description: 'd', seed: 1 };
    for (const missing of ['portrait', 'out', 'description', 'seed']) {
        const opts = { ...ok };
        delete opts[missing];
        assert.throws(() => animate.animateArgs('s.py', opts), new RegExp(missing),
            `${missing} must be refused when absent`);
    }
    assert.throws(() => animate.animateArgs('s.py', { ...ok, seed: -1 }));
    assert.throws(() => animate.animateArgs('s.py', { ...ok, seed: 1.5 }));
});

test('descriptions come from the Animation table only, enabled bullets only', () => {
    const tables = [
        { name: 'Hair', bullets: [{ text: 'cropped', weight: 1, enabled: true }] },
        { name: 'Animation', bullets: [
            { text: 'a', weight: 1, enabled: true },
            { text: 'b', weight: 2, enabled: false },
            { text: 'c', weight: 1, enabled: true },
        ] },
    ];
    assert.deepEqual(animate.descriptionsFrom(tables), ['a', 'c']);
    assert.deepEqual(animate.descriptionsFrom([tables[0]]), []);
    assert.deepEqual(animate.descriptionsFrom(undefined), []);
});

test('a re-roll never hands back the description already showing', () => {
    const pool = ['a', 'b', 'c'];
    for (let i = 0; i < 20; i += 1) {
        assert.notEqual(animate.pickDescription(pool, { exclude: 'b' }), 'b');
    }
});

test('a pool of one is the one honest repeat, and an empty pool is null', () => {
    assert.equal(animate.pickDescription(['only'], { exclude: 'only' }), 'only');
    assert.equal(animate.pickDescription([], {}), null);
    assert.equal(animate.pickDescription(undefined, {}), null);
});

test('the draw is driven by the random source given, and never runs off the end', () => {
    const pool = ['a', 'b', 'c'];
    assert.equal(animate.pickDescription(pool, { random: () => 0 }), 'a');
    assert.equal(animate.pickDescription(pool, { random: () => 0.999 }), 'c');
    assert.equal(animate.pickDescription(pool, { random: () => 1 }), 'c');
});

test('the sidecar parses leniently', () => {
    assert.deepEqual(animate.parseSidecar(''), {});
    assert.deepEqual(animate.parseSidecar('{not json'), {});
    assert.deepEqual(animate.parseSidecar('[1]'), [1] instanceof Object ? [1] : {});
    assert.deepEqual(animate.parseSidecar('{"seed": 7}'), { seed: 7 });
});

test('stale means the portrait is newer than the loop made from it', () => {
    assert.equal(animate.isStale({ portraitVersion: 100 }, 200), true);
    assert.equal(animate.isStale({ portraitVersion: 200 }, 200), false);
    assert.equal(animate.isStale({ portraitVersion: 300 }, 200), false);
    assert.equal(animate.isStale({}, 200), false, 'a sidecar from before the field is not flagged');
    assert.equal(animate.isStale({ portraitVersion: 100 }, null), false);
});
