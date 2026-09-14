const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers/testServer');

const publicDir = path.join(__dirname, '..', 'public');

test('the page exposes a valid ICO favicon', () => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    const icon = fs.readFileSync(path.join(publicDir, 'favicon.ico'));

    assert.match(html, /<link\s+rel="icon"\s+href="\/favicon\.ico"\s+type="image\/x-icon"\s*\/>/);
    assert.deepEqual([...icon.subarray(0, 4)], [0, 0, 1, 0]);
});

test('the server serves the favicon with the ICO content type', async (t) => {
    const server = await startTestServer({ tablesText: '', port: 5399 });
    t.after(() => server.stop());

    const response = await fetch(`${server.baseUrl}/favicon.ico`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/x-icon');
});
