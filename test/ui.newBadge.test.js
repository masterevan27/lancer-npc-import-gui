const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/testServer');

// The card's status badge is a single-slot if/else chain - Imported, then
// Importing…, then Failed, then Regenerating…, and so on - and exactly one span
// is appended per card. The New tag deliberately does *not* join it: a
// brand-new NPC that is mid-regen, or that just failed a 3D build, is a normal
// state, and folding the two together would show one fact and silently drop the
// other. It is a second span, in its own corner, with its own colour.
//
// There is no DOM harness in this repo and no dependencies at all - every test
// drives the real server over HTTP - so what is pinned here is that the served
// app.js and style.css still carry that wiring. Same approach, and same
// reasoning, as test/ui.copyPrompts.test.js.
const PORT = 5210;

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

test('the grid builds a New tag from the server-reported flag', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    assert.match(js, /item\.isNew/, 'app.js never reads the isNew flag /api/items reports');
    assert.match(js, /'badge new'/, 'nothing in app.js builds a New badge element');
    assert.match(js, /textContent = 'New'/, 'the New badge carries no label');
    // The suppression rule, which is also what keeps a bright pill off a card
    // the stylesheet has already dimmed to 55%.
    assert.match(
        js, /item\.isNew && !item\.imported/,
        'the New tag is no longer suppressed on an imported card');
    // Same flag, second channel: the class the border above hangs off.
    assert.match(js, /' is-new'/, 'the grid no longer marks a new card for the border rule');
});

test('the New tag is a second badge, not another arm of the status chain', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // The regression this design exists to prevent is someone "tidying" the New
    // tag into the chain, at which cost a new-and-regenerating NPC shows only
    // one of the two. Assert the chain is still there and that the New tag's
    // own branch is an independent `if`, not an `else if` continuing it.
    assert.match(js, /textContent = 'Regenerating…'/, 'the status chain lost its regen arm');
    assert.match(
        js, /\n\s*if \(item\.isNew && !item\.imported\) \{/,
        'the New tag was folded into the status if/else chain, where it competes for the one slot');
});

test('opening an NPC posts it seen', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    assert.match(js, /'\/api\/seen'/, 'app.js never tells the server anything has been looked at');
    // Opening the detail sheet is the clear that matters: not grid presence,
    // which a ten-NPC batch would clear before the user had scrolled, and not
    // any click, since the checkbox is a selection gesture.
    assert.match(
        js, /function openDetail\([\s\S]*?\n\}/,
        'openDetail is no longer a top-level function, so the check below cannot find it');
    const openDetailBody = /function openDetail\([\s\S]*?\n\}/.exec(js)[0];
    assert.match(
        openDetailBody, /markSeen\(\[item\.id\]\)/,
        'openDetail no longer clears the New tag, so nothing ever does');
    // The poller replaces state.items wholesale every two seconds, so the local
    // record is what stops the badge blinking back between the click and the
    // POST landing.
    assert.match(js, /locallySeen/, 'the optimistic local record is gone, so the badge will flicker');
    assert.match(
        js, /state\.locallySeen\.has\(i(?:tem)?\.id\)/,
        'refreshItems no longer re-applies what this page already marked seen');
});

test('deleting an NPC forgets the local record that it was looked at', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // The server prunes its own seen store inside deleteItem, because an id is
    // `npc-<slug>-<seed>` and a delete-then-reroll at the same name and seed
    // comes back under the same id - which has to arrive flagged New. This page
    // overrides isNew from state.locallySeen on every refresh, and would quietly
    // undo that prune: openDetail() adds the id when the user opens the sheet to
    // look at the NPC, which is the same sheet the Delete button lives on, so a
    // re-rolled NPC would come back with no tag and no is-new border until a
    // full page reload. Both delete paths drop the id instead.
    //
    // Both handlers are extracted to their own closing `});` first, so a
    // pruning line in one cannot satisfy the check on the other.
    const bulk = /el\.deleteBtn\.addEventListener\([\s\S]*?\n\}\);/.exec(js);
    assert.ok(bulk, 'the Delete Selected handler is no longer a top-level binding');
    // Only for the ids that really went: /api/delete reports per-id, and an NPC
    // that refused to delete (mid-import, mid-regen) is still there and still
    // seen. Dropping its record would flash the tag back on the next poll.
    assert.match(
        bulk[0], /if \(result\.deleted\) state\.locallySeen\.delete\(result\.id\)/,
        'Delete Selected leaves a stale locallySeen entry, defeating the server-side prune');

    const detail = /el\.detailDeleteBtn\.addEventListener\([\s\S]*?\n\}\);/.exec(js);
    assert.ok(detail, 'the detail sheet\'s Delete handler is no longer a top-level binding');
    assert.match(
        detail[0], /state\.locallySeen\.delete\(id\)/,
        'the detail sheet\'s Delete leaves a stale locallySeen entry, defeating the server-side prune');
});

test('a finished run forgets the local record for the NPCs it produced', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const js = await fetchText(server, '/app.js');
    // The other half of the server dropping a run's own ids out of its store.
    // Newness is keyed by manifest id while a run is measured over folders, and
    // the same name and seed rolled twice puts a second folder under an id the
    // user may well have opened - so the server un-sees what a run produced.
    // state.locallySeen would overrule that for the rest of the page load, on
    // an id the user opened before regenerating, which is the ordinary way to
    // use the Create form: open an NPC, change one override, roll it again.
    const announce = /function announceBatchComplete\([\s\S]*?\n\}/.exec(js);
    assert.ok(announce, 'announceBatchComplete is no longer a top-level function');
    assert.match(
        announce[0], /state\.locallySeen\.delete\(id\)/,
        'a finished run leaves a stale locallySeen entry, defeating the server-side un-see');
    // Before the reload, or the reload re-applies the very record it clears.
    assert.ok(
        announce[0].indexOf('state.locallySeen.delete(id)')
            < announce[0].indexOf("tabState.current === 'import'"),
        'the local record is cleared after the grid reloads, so the reload still overrides isNew');
});

test('the stylesheet gives the New tag its own corner and colour', async (t) => {
    const server = await startTestServer({ tablesText: TABLES_FIXTURE, port: PORT });
    t.after(() => server.stop());

    const css = await fetchText(server, '/style.css');
    // Without a rule of its own the tag inherits `.card .badge`, which is the
    // green Imported pill in the top-right corner - so it would sit on top of
    // whichever status badge the chain drew and claim to mean "imported".
    assert.match(
        css, /\.card \.badge\.new\s*\{[^}]*background:/,
        'the New tag has no colour of its own and inherits the green Imported pill');
    assert.match(
        css, /\.card \.badge\.new\s*\{[^}]*left:/,
        'the New tag is not moved out of the status badge corner');
    // The border is the second half of the New signal and the half that
    // survives a name-ascending sort, where a fresh NPC can land anywhere in
    // the grid and the pill alone is easy to scroll past. Nothing else pinned
    // it, so a tidy of this rule would leave the README promising a border the
    // page no longer draws.
    assert.match(
        css, /\.card\.is-new\s*\{[^}]*border-color:/,
        'a new card no longer carries a border colour of its own');
});
