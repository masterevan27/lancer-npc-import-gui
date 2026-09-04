const test = require('node:test');
const assert = require('node:assert/strict');
const traitOdds = require('../lib/traitOdds');

/*
 * The pure half of the odds feature: the command line, the cache key, and the
 * validation of what comes back.
 *
 * parseOddsOutput is strict on purpose. Its output becomes percentages beside
 * every bullet on the Tables page, and a malformed response accepted quietly
 * would show up not as an error but as plausible-looking wrong numbers - the
 * one failure a person tuning their tables has no way to notice.
 */

test('oddsArgs builds the command line', () => {
    assert.deepEqual(
        traitOdds.oddsArgs('/x/generate-npc.py', 20000),
        ['/x/generate-npc.py', '--trait-odds', '20000'],
    );
});

test('oddsArgs refuses a sample count that is not a positive whole number', () => {
    for (const bad of [0, -1, 1.5, NaN, '20000', null, undefined]) {
        assert.throws(() => traitOdds.oddsArgs('/x/generate-npc.py', bad), /whole number/);
    }
});

test('cacheKeyFor changes when either mtime or size changes', () => {
    const base = traitOdds.cacheKeyFor({ mtimeMs: 1000, size: 50 });
    assert.equal(base, traitOdds.cacheKeyFor({ mtimeMs: 1000, size: 50 }));
    assert.notEqual(base, traitOdds.cacheKeyFor({ mtimeMs: 1001, size: 50 }));
    // Size is in the key for the same-millisecond rewrite: a preset apply
    // rewrites many bullets in one pass and can land inside one mtime tick.
    assert.notEqual(base, traitOdds.cacheKeyFor({ mtimeMs: 1000, size: 51 }));
});

test('parseOddsOutput accepts a well-formed report', () => {
    const { samples, tables } = traitOdds.parseOddsOutput(
        '{"samples":20000,"tables":{"Gear":{"a battered data-slate":0.25}}}\n');
    assert.equal(samples, 20000);
    assert.equal(tables.Gear['a battered data-slate'], 0.25);
});

test('parseOddsOutput keeps a probability of exactly 0 or 1', () => {
    const { tables } = traitOdds.parseOddsOutput(
        '{"samples":10,"tables":{"Gear":{"never":0,"always":1}}}');
    // 0 means reachable and not reached, which is a real answer and must not
    // be filtered out as falsy - absent means switched off, which is not.
    assert.equal(tables.Gear.never, 0);
    assert.equal(tables.Gear.always, 1);
});

test('parseOddsOutput rejects empty output', () => {
    assert.throws(() => traitOdds.parseOddsOutput('   '), /printed nothing/);
});

test('parseOddsOutput reports the first line of non-JSON output', () => {
    assert.throws(
        () => traitOdds.parseOddsOutput('Traceback (most recent call last):\n  File "x"'),
        /Traceback/,
    );
});

test('parseOddsOutput rejects a report that is not an object', () => {
    assert.throws(() => traitOdds.parseOddsOutput('[1,2,3]'), /not a JSON object/);
    assert.throws(() => traitOdds.parseOddsOutput('"nope"'), /not a JSON object/);
});

test('parseOddsOutput rejects a missing or unusable sample count', () => {
    assert.throws(() => traitOdds.parseOddsOutput('{"tables":{}}'), /"samples"/);
    assert.throws(() => traitOdds.parseOddsOutput('{"samples":0,"tables":{}}'), /"samples"/);
});

test('parseOddsOutput rejects a missing tables object', () => {
    assert.throws(() => traitOdds.parseOddsOutput('{"samples":10}'), /"tables"/);
    assert.throws(() => traitOdds.parseOddsOutput('{"samples":10,"tables":[]}'), /"tables"/);
});

test('parseOddsOutput rejects a value that is not a probability', () => {
    assert.throws(
        () => traitOdds.parseOddsOutput('{"samples":10,"tables":{"Gear":{"x":1.5}}}'),
        /not a probability/,
    );
    assert.throws(
        () => traitOdds.parseOddsOutput('{"samples":10,"tables":{"Gear":{"x":"0.5"}}}'),
        /not a probability/,
    );
    assert.throws(
        () => traitOdds.parseOddsOutput('{"samples":10,"tables":{"Gear":"nope"}}'),
        /not an object of bullets/,
    );
});
