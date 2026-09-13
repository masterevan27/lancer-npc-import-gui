const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// The Animated portrait panel's ping-pong checkbox. The background Animate
// panel had one from the start and the script takes `--no-pingpong` for
// either caller, so the NPC panel lacking it was an asymmetry rather than a
// decision. No DOM harness in this repo - what is pinned is the markup, the
// POST carrying the choice, and the sheet following the loop on disk.
const PORT = 5239;

const TABLES_FIXTURE = [
    '## Pronouns',
    '- she/her/her/woman',
    '',
].join('\n');

async function fetchText(server, path) {
    const res = await fetch(`${server.baseUrl}${path}`);
    assert.equal(res.status, 200, `${path} should be served`);
    return res.text();
}

test('the panel carries a ping-pong checkbox, on by default, beside the seed modes', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const html = await fetchText(server, '/index.html');
    const panel = /<div class="regen-panel animate-panel" id="animate-panel"[\s\S]*?<p class="regen-status" id="animate-status">/.exec(html);
    assert.ok(panel, 'no #animate-panel');
    assert.match(panel[0], /<label><input type="checkbox" id="animate-pingpong" checked> Ping-pong the loop<\/label>/,
        'the checkbox must sit inside a label, and ship checked');
});

test('the Animate button posts the checkbox, and the sheet follows the loop on disk', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    assert.match(js, /animatePingpong: document\.getElementById\('animate-pingpong'\)/,
        'app.js no longer looks the checkbox up');
    const click = /el\.animateBtn\.addEventListener\('click'[\s\S]*?fetch\('\/api\/animation'/.exec(js);
    assert.ok(click, 'the Animate click handler no longer posts /api/animation');
    assert.match(click[0], /pingpong: el\.animatePingpong\.checked/,
        'the POST body does not carry the checkbox');

    // Opening a sheet resets the box, then the loop's own record sets it -
    // and only on a change of owner, so a poll tick cannot undo a click.
    const open = /state\.animationOwnerId = null;[\s\S]{0,600}?el\.animatePingpong\.checked = true;/.exec(js);
    assert.ok(open, 'opening a sheet does not reset the checkbox to the default');
    const refresh = /async function refreshAnimation\([\s\S]*?\n\}/.exec(js);
    assert.ok(refresh, 'refreshAnimation is no longer a top-level function');
    assert.match(refresh[0],
        /state\.animationOwnerId !== id && typeof view\.pingpong === 'boolean'[\s\S]{0,120}?el\.animatePingpong\.checked = view\.pingpong/,
        'refreshAnimation does not set the checkbox from the record on a change of owner');

    // Locked while either portrait consumer runs, the way the seed radios are.
    const panel = /function renderAnimationPanel\([\s\S]*?\n\}/.exec(js);
    assert.ok(panel, 'renderAnimationPanel is no longer a top-level function');
    assert.match(panel[0], /const blocked = running \|\| item\.expressionStatus === 'running'/,
        'the animation panel does not include expression rendering in its exclusion state');
    assert.match(panel[0], /el\.animatePingpong\.disabled = blocked/,
        'the checkbox is not locked while a render or expression job is running');
});
