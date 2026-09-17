const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

test('the shared page shell displays the current release version', async (t) => {
    const server = await startTestServer({ tablesText: '', port: 5401 });
    t.after(() => server.stop());

    const response = await fetch(`${server.baseUrl}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /class="release-version"[^>]*>Version 1\.0\.9<\/span>/);
    assert.ok(html.indexOf('class="release-version"') < html.indexOf('id="settings-open"'),
        'the version label should be immediately before Settings in the shared top bar');
});
