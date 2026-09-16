/** Optional shared canvas size for private portrait/token generation. */
function normaliseDimensions(body) {
    const blank = value => value === undefined || value === null || value === '';
    const valid = value => (typeof value === 'number' || typeof value === 'string')
        && !blank(value) && Number.isInteger(Number(value))
        && Number(value) >= 64 && Number(value) <= 8192 && Number(value) % 8 === 0;
    const result = {};
    for (const [width, height, label] of [['width', 'height', 'Width and height'], ['tokenWidth', 'tokenHeight', 'Token width and height']]) {
        if (blank(body[width]) && blank(body[height])) continue;
        if (!valid(body[width]) || !valid(body[height])) {
            throw new Error(`${label} must both be whole pixels from 64 to 8192, in multiples of 8.`);
        }
        result[width] = Number(body[width]); result[height] = Number(body[height]);
    }
    return result;
}

function dimensionArgs(body) {
    const dimensions = normaliseDimensions(body);
    return Object.entries(dimensions).flatMap(([key, value]) =>
        ['--' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), String(value)]);
}

module.exports = { normaliseDimensions, dimensionArgs };
