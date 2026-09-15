/** Optional shared canvas size for private portrait/token generation. */
function normaliseDimensions(body) {
    const blank = value => value === undefined || value === null || value === '';
    if (blank(body.width) && blank(body.height)) return {};
    const valid = value => (typeof value === 'number' || typeof value === 'string')
        && !blank(value) && Number.isInteger(Number(value))
        && Number(value) >= 64 && Number(value) <= 8192 && Number(value) % 8 === 0;
    if (!valid(body.width) || !valid(body.height)) {
        throw new Error('Width and height must both be whole pixels from 64 to 8192, in multiples of 8.');
    }
    return { width: Number(body.width), height: Number(body.height) };
}

function dimensionArgs(body) {
    const { width, height } = normaliseDimensions(body);
    return width === undefined ? [] : ['--width', String(width), '--height', String(height)];
}

module.exports = { normaliseDimensions, dimensionArgs };
