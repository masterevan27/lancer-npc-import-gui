const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliseDimensions, dimensionArgs } = require('../lib/imageDimensions');

test('token dimensions can override the shared canvas or be set on their own', () => {
    assert.deepEqual(normaliseDimensions({ tokenWidth: '768', tokenHeight: '1024' }), { tokenWidth: 768, tokenHeight: 1024 });
    assert.deepEqual(dimensionArgs({ width: 1920, height: 1080, tokenWidth: 768, tokenHeight: 1024 }),
        ['--width', '1920', '--height', '1080', '--token-width', '768', '--token-height', '1024']);
    assert.deepEqual(dimensionArgs({}), []);
    for (const value of [undefined, 0, 9000, 767, 768.5, true]) {
        assert.throws(() => normaliseDimensions({ tokenWidth: value, tokenHeight: 768 }), /Token/);
    }
});
