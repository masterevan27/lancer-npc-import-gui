#!/usr/bin/env node
'use strict';

/**
 * Captures the screenshots in examples/ that the README links to.
 *
 * Node stdlib only, like the rest of this repo: Chrome is launched headless
 * with a debugging port and driven over the DevTools Protocol through Node's
 * built-in WebSocket, so there is no package.json and nothing to install.
 *
 * The run is self-contained. It starts its own server.js child against a
 * sanitised copy of config.json on a dedicated port, so it neither depends on
 * nor disturbs whatever you already have running on 5089.
 *
 * Secret mode is excluded by construction, in three independent layers:
 *
 *   1. The sanitised config drops `secretMode` and `secretImagesDir` entirely.
 *      Without a `secretMode` block the server has no credentials to
 *      authenticate against, so the Secret surface cannot be entered at all -
 *      this is not merely a matter of not clicking the button.
 *   2. assertNoSecretSurface() runs before *every* capture and aborts the whole
 *      run if any secret element is visible. No file is written after a failed
 *      check.
 *   3. No shot navigates anywhere near the Secret controls.
 *
 * Usage:
 *   node scripts/capture-screenshots.js                 # every shot
 *   node scripts/capture-screenshots.js 01 02           # only these
 *   node scripts/capture-screenshots.js --list          # names only
 *   node scripts/capture-screenshots.js --headful       # watch it work
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'examples');
const SERVER_JS = path.join(ROOT, 'server.js');
const REAL_CONFIG = process.env.IMPORT_GUI_CONFIG || path.join(ROOT, 'config.json');

// Deliberately not 5089 and not 9222: a capture run must not collide with the
// server you are already using or with a Chrome you already have open for
// debugging.
const SERVER_PORT = 5099;
const CDP_PORT = 9333;
const BASE_URL = `http://127.0.0.1:${SERVER_PORT}`;

const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;

// Every Secret-mode surface in the page. The structural sweep at the end is
// the important one: enumerating ids by hand missed #secret-open (the Secret
// button in the Settings dialog) on the first run, so the guard matches any
// element whose id or class mentions "secret" rather than trusting a list to
// stay complete as the page grows.
//
// Note what is deliberately NOT here: the Settings dialog's plain `secret`
// field is the *Foundry shared secret*, nothing to do with Secret mode, and
// the settings fields carry their key in data-settings-key rather than in an
// id, so the sweep cannot catch it by accident. SECRET_SETTINGS_KEYS covers
// the two settings fields that really are Secret-mode ones.
const SECRET_SELECTORS = [
    '[id*="secret" i]',
    '[class*="secret" i]',
];

// A settings field is a Secret-mode surface when its key mentions secret -
// except the bare `secret`, which is the Foundry shared secret.
const SECRET_SETTINGS_FIELD = '[data-settings-key*="secret" i]:not([data-settings-key="secret"])';

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function findChrome() {
    if (process.env.CHROME) return process.env.CHROME;
    const candidates = [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    throw new Error('Chrome not found. Set the CHROME environment variable to its executable.');
}

// ---------------------------------------------------------------------------
// A very small DevTools Protocol client
// ---------------------------------------------------------------------------

class Cdp {
    constructor(ws) {
        this.ws = ws;
        this.nextId = 1;
        this.pending = new Map();
        ws.addEventListener('message', (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? null)})`));
                else resolve(msg.result);
            }
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`CDP timeout: ${method}`));
                }
            }, 60000);
        });
    }

    /**
     * Runs an expression in the page and returns its value. The expression is
     * awaited, so a shot's setup can return a promise and the caller simply
     * waits for it.
     */
    async eval(expression) {
        const res = await this.send('Runtime.evaluate', {
            expression: `(async () => { ${expression} })()`,
            awaitPromise: true,
            returnByValue: true,
        });
        if (res.exceptionDetails) {
            const d = res.exceptionDetails;
            throw new Error(`page error: ${d.exception?.description || d.text}`);
        }
        return res.result.value;
    }
}

// ---------------------------------------------------------------------------
// Helpers shared by the shot definitions, injected into the page once per load
// ---------------------------------------------------------------------------

const PAGE_HELPERS = `
window.__cap = {
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),

  // Polls for a condition instead of sleeping a fixed amount: the grid and the
  // detail sheet both populate from fetches whose timing varies with how big
  // the real library is.
  async until(fn, { timeout = 20000, label = 'condition' } = {}) {
    const start = Date.now();
    for (;;) {
      let v;
      try { v = fn(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - start > timeout) throw new Error('timed out waiting for ' + label);
      await window.__cap.sleep(100);
    }
  },

  visible(el) {
    if (!el) return false;
    if (el.hidden) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  },

  // A shot of a half-decoded portrait is worse than no shot. Waits for every
  // <img> currently in the document to finish, then gives the browser a frame
  // to lay the results out.
  async imagesSettled(timeout = 30000) {
    await window.__cap.until(() => {
      const imgs = Array.from(document.images).filter(i => window.__cap.visible(i));
      return imgs.length > 0 && imgs.every(i => i.complete && (i.naturalWidth > 0 || i.getAttribute('src') === null));
    }, { timeout, label: 'images to load' });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  },

  async clickTab(name) {
    const btn = await window.__cap.until(
      () => document.querySelector('#tabs button[data-tab="' + name + '"]'),
      { label: 'tab ' + name });
    btn.click();
    await window.__cap.until(
      () => window.__cap.visible(document.querySelector('#tab-' + name)),
      { label: 'panel ' + name });
    await window.__cap.sleep(300);
  },

  // Finds a grid card by the name shown on it. Used so the same characters
  // recur across shots rather than whichever NPC happens to sort first.
  cardByName(name) {
    return Array.from(document.querySelectorAll('#grid .card'))
      .find(c => (c.querySelector('.name')?.textContent || '').trim() === name) || null;
  },

  cardNames() {
    return Array.from(document.querySelectorAll('#grid .card'))
      .map(c => (c.querySelector('.name')?.textContent || '').trim());
  },

  async openCard(name) {
    const card = await window.__cap.until(() => window.__cap.cardByName(name), { label: 'card ' + name });
    card.click();
    await window.__cap.until(
      () => window.__cap.visible(document.querySelector('#detail-overlay')),
      { label: 'detail sheet' });
    await window.__cap.sleep(500);
  },

  // Scrolls an element into the sheet's scroll container so a capture of a
  // panel is not cut off at the viewport edge. 'start' is for the shots that
  // fill the viewport from that element downwards; 'center' for clipped ones.
  async scrollTo(selector, block = 'center') {
    const el = document.querySelector(selector);
    if (!el) throw new Error('no element ' + selector);
    el.scrollIntoView({ block, behavior: 'instant' });
    await window.__cap.sleep(400);
  },
};
`;

// ---------------------------------------------------------------------------
// Shot definitions
// ---------------------------------------------------------------------------

/**
 * Each shot names the README section it serves. `setup` is JavaScript run in
 * the page; it may await window.__cap helpers. `clip` names an element to crop
 * to, `fullPage` captures the whole scrollable page, and the default is the
 * viewport.
 */
const SHOTS = [
    {
        name: '01-import-grid',
        title: 'Import Generated Art — the library grid',
        caption: 'Every NPC the generator has rolled, with status badges, role categories and the blue **New** tag on anything generated since you last looked.',
        setup: `
      await window.__cap.clickTab('import');
      await window.__cap.until(() => document.querySelectorAll('#grid .card').length > 4,
        { label: 'grid cards' });
      await window.__cap.imagesSettled();
    `,
    },
    {
        name: '02-detail-sheet',
        title: 'An NPC detail sheet',
        caption: 'Portrait and token side by side, the prompts that produced them, and the trait table whose **Portrait only** / **Token only** / **Animated only** pills say which image each trait actually reaches.',
        npc: 'Mara Varr',
        setup: `
      await window.__cap.clickTab('import');
      await window.__cap.until(() => document.querySelectorAll('#grid .card').length > 4,
        { label: 'grid cards' });
      await window.__cap.openCard(window.__cap.__npc);
      await window.__cap.imagesSettled();
    `,
    },
    {
        name: '03-trait-table',
        title: 'The trait table and its scope pills',
        caption: 'Every rolled trait, with **Re-roll** and **Set…** on each. The pills say which image a trait actually reaches, and the buttons take the pill\'s colour, so changing one of them is visibly a change to one image.',
        npc: 'Mara Varr',
        // Viewport rather than a clip: the sheet is a scrolling overlay, so a
        // crop measured to the table's full height runs straight past the
        // bottom of the sheet and photographs the grid behind it.
        setup: `
      await window.__cap.clickTab('import');
      await window.__cap.until(() => document.querySelectorAll('#grid .card').length > 4,
        { label: 'grid cards' });
      await window.__cap.openCard(window.__cap.__npc);
      await window.__cap.scrollTo('#scope-legend', 'start');
    `,
    },
    {
        name: '04-3d-model',
        title: '3D model panel',
        caption: 'Rebuilds the NPC from a fresh A-pose render into a shell GLB, a print STL and four turnaround PNGs, shown here as thumbnails once the build has landed.',
        npc: 'Jules Sokolova',
        clip: '#model3d-panel',
        setup: `
      await window.__cap.clickTab('import');
      await window.__cap.until(() => document.querySelectorAll('#grid .card').length > 4,
        { label: 'grid cards' });
      await window.__cap.openCard(window.__cap.__npc);
      await window.__cap.until(
        () => window.__cap.visible(document.querySelector('#model3d-panel')),
        { label: '3D panel' });
      await window.__cap.scrollTo('#model3d-panel');
      await window.__cap.imagesSettled();
    `,
    },
    {
        name: '05-animated-portrait',
        title: 'Animated portrait panel',
        caption: 'Turns the portrait into a looping WebP through Wan 2.2. The motion is the **Animation** row of the trait table, so this panel only shows the choice, the seed and the button.',
        npc: 'Mara Varr',
        clip: '#animate-panel',
        setup: `
      await window.__cap.clickTab('import');
      await window.__cap.until(() => document.querySelectorAll('#grid .card').length > 4,
        { label: 'grid cards' });
      await window.__cap.openCard(window.__cap.__npc);
      await window.__cap.until(
        () => window.__cap.visible(document.querySelector('#animate-panel')),
        { label: 'animate panel' });
      await window.__cap.scrollTo('#animate-panel');
    `,
    },
    {
        name: '06-expressions',
        title: 'Expressions panel',
        caption: 'Static WebP sprites for SillyTavern\'s Character Expressions extension: 28 default labels in generator order, custom labels as chips, and the generated sprites below.',
        npc: 'Mara Varr',
        // Viewport, for the same reason as the trait table: with a full sprite
        // set rendered this panel is several thousand pixels tall, far past the
        // bottom of the sheet's own scroll box, and a crop that size photographs
        // the grid behind it. The top of the panel is the part worth showing.
        setup: `
      await window.__cap.clickTab('import');
      await window.__cap.until(() => document.querySelectorAll('#grid .card').length > 4,
        { label: 'grid cards' });
      await window.__cap.openCard(window.__cap.__npc);
      await window.__cap.until(
        () => window.__cap.visible(document.querySelector('#expressions-panel')),
        { label: 'expressions panel' });
      const d = document.querySelector('#expressions-sprites-details');
      if (d) d.open = true;
      await window.__cap.sleep(600);
      await window.__cap.scrollTo('#expressions-panel', 'start');
      await window.__cap.imagesSettled();
    `,
    },
    {
        name: '07-create-npc',
        title: 'Create NPC — trait overrides',
        caption: 'A form over `generate-npc.py`\'s roll options. Each override gets a search box that narrows the table\'s own bullets, a count of what matched, and the full bullet printed below exactly as it will be sent — flags included.',
        setup: `
      await window.__cap.clickTab('create');
      const add = await window.__cap.until(() => document.querySelector('#add-override'),
        { label: 'add override' });
      add.click();
      const row = await window.__cap.until(() => document.querySelector('#override-rows .filter-row'),
        { label: 'override row' });

      // Outfit is the table worth showing: ~192 bullets once the per-pronoun
      // variants are folded in, which is what the search box exists for.
      const tableSel = row.querySelector('select');
      const want = Array.from(tableSel.options).find(o => /^Outfit/.test(o.value));
      if (want) {
        tableSel.value = want.value;
        tableSel.dispatchEvent(new Event('change', { bubbles: true }));
        await window.__cap.sleep(600);
      }

      const search = await window.__cap.until(
        () => document.querySelector('#override-rows .override-search'),
        { label: 'search box' });
      search.value = 'black';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await window.__cap.sleep(600);

      // Pick a value so the full-bullet readout underneath has something to
      // print - an empty readout is the one thing this shot must not show.
      const valueSel = document.querySelector('#override-rows select.filter-value');
      if (valueSel && valueSel.options.length > 1) {
        valueSel.selectedIndex = 1;
        valueSel.dispatchEvent(new Event('change', { bubbles: true }));
        await window.__cap.sleep(500);
      }
      // Scrolled to Count rather than the top of the form: the Workflow hint
      // just above it mentions Secret mode, which has no business in a
      // published screenshot even as a passing reference.
      await window.__cap.scrollTo('#create-count', 'start');
      await window.__cap.sleep(300);
    `,
        // The form card is a single column, so a 1440-wide frame is half empty.
        width: 1100,
        // Cropped from the Count row down. The page bottoms out before the
        // Workflow hint above it can be scrolled away, and that hint mentions
        // Secret mode.
        clip: '.form-grid',
        clipTo: '.create-form',
    },
    {
        name: '08-create-spaceship',
        title: 'Create Spaceship',
        caption: 'The same form over `generate-spaceship.py`. The whole ship half of the app hides itself when that script is not on disk, rather than offering buttons that fail when clicked.',
        width: 1100,
        setup: `
      await window.__cap.clickTab('shipcreate');
      await window.__cap.sleep(600);
    `,
    },
    {
        name: '09-create-background',
        title: 'Create Background',
        caption: 'Renders scene art from the generator\'s background catalogues — or from rolled dynamic traits — and animates any still into a loop.',
        setup: `
      await window.__cap.clickTab('backgrounds');
      await window.__cap.sleep(800);
      await window.__cap.imagesSettled().catch(() => {});
    `,
    },
    {
        name: '10-backgrounds-grid',
        title: 'Backgrounds in the library grid',
        caption: 'Rendered scenes are wide rather than square and carry a **Loop** badge when an animated loop sits beside the still.',
        setup: `
      await window.__cap.clickTab('import');
      const btn = await window.__cap.until(
        () => Array.from(document.querySelectorAll('#categories button'))
          .find(b => /Background/i.test(b.textContent)),
        { label: 'Backgrounds category' });
      btn.click();
      await window.__cap.until(() => document.querySelectorAll('#grid .card').length > 2,
        { label: 'background cards' });
      await window.__cap.imagesSettled();
    `,
    },
    {
        name: '11-trait-imports',
        title: 'Trait Imports',
        caption: 'Reference-image trait candidates staged by the generator\'s `npc-trait-import` skill, each beside the image it was read from, ready to accept into a roll table.',
        setup: `
      await window.__cap.clickTab('traits');
      await window.__cap.sleep(1000);
      // Pictures rather than the List view it opens on: the point of this tab
      // is the candidate beside the reference image it was read from, and the
      // list is 1600 rows of text that says nothing the Tables tab does not.
      const pics = await window.__cap.until(
        () => document.querySelector('[data-trait-view="pictures"]'),
        { label: 'Pictures toggle' });
      pics.click();
      await window.__cap.until(
        () => window.__cap.visible(document.querySelector('#trait-tiles')),
        { label: 'picture tiles' });
      await window.__cap.sleep(800);
      await window.__cap.imagesSettled().catch(() => {});
    `,
    },
    {
        name: '12-tables',
        title: 'Tables — the roll tables, edited in place',
        caption: 'Every bullet in every roll table, with its weight, its `||` flags, whether it is disabled, and the sampled percentage it actually comes up at.',
        setup: `
      await window.__cap.clickTab('tables');
      // Faction rather than whichever table sorts first: its bullets carry
      // '||' flags and uneven weights, which is what this shot is for. Given
      // names, the default landing table, is 69 single words all at ~1%.
      const heading = await window.__cap.until(
        () => Array.from(document.querySelectorAll('#table-heading-list button'))
          .find(b => /^Faction/.test(b.textContent.trim())),
        { label: 'the Faction table' });
      heading.click();
      await window.__cap.until(
        () => document.querySelectorAll('#table-bullet-list > *').length > 3,
        { label: 'table bullets' });
      await window.__cap.sleep(800);
    `,
    },
    {
        name: '13-settings',
        title: 'Settings',
        caption: 'Every config key, grouped by area, with each blank field\'s default or derived path in grey and a warning on any set path that does not exist.',
        // Cropped to the groups themselves. The dialog's header carries the
        // Secret-mode entry button and its lower groups carry the Secret table
        // and prompt paths; neither belongs in a published screenshot, and the
        // guard would abort the run rather than let them through.
        clip: '.settings-intro',
        clipTo: '#settings-groups',
        // Ends at the Server group's lower border rather than part-way down
        // the Python field below it.
        clipHeight: 566,
        setup: `
      const open = await window.__cap.until(() => document.querySelector('#settings-open'),
        { label: 'settings button' });
      open.click();
      await window.__cap.until(
        () => window.__cap.visible(document.querySelector('#settings-overlay')),
        { label: 'settings dialog' });
      await window.__cap.until(
        () => document.querySelectorAll('#settings-groups input').length > 3,
        { label: 'settings fields' });
      await window.__cap.sleep(500);
    `,
    },
    {
        name: '14-mobile',
        title: 'The same library on a phone',
        caption: 'The layout collapses to a single column, the filters fold into a disclosure and the import actions become a bottom action bar.',
        width: 390,
        height: 844,
        mobile: true,
        setup: `
      await window.__cap.clickTab('import');
      await window.__cap.until(() => document.querySelectorAll('#grid .card').length > 2,
        { label: 'grid cards' });
      await window.__cap.imagesSettled();
    `,
    },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function sanitiseConfig(realPath, tmpDir) {
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(realPath, 'utf8'));
    } catch (err) {
        throw new Error(`could not read ${realPath}: ${err.message}`);
    }

    // The heart of layer 1. Everything that could reach a private image, or
    // could let the page offer a way in, is dropped rather than blanked: a
    // blank password hash is still a secretMode block, and the server decides
    // whether to expose the Secret controls from the block's presence.
    const {
        secretMode, secretImagesDir, secretTablesDir, secretPromptsDir, secret,
        ...safe
    } = raw;

    if (!safe.npcManifestPath && !safe.manifestPath) {
        throw new Error('config.json has no npcManifestPath — nothing to screenshot.');
    }

    safe.port = SERVER_PORT;
    safe.host = '127.0.0.1';
    safe.secret = '';

    const out = path.join(tmpDir, 'capture-config.json');
    fs.writeFileSync(out, JSON.stringify(safe, null, 2));
    return out;
}

function waitForHttp(url, timeoutMs = 30000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tick = async () => {
            try {
                const res = await fetch(url);
                if (res.ok || res.status === 404) return resolve();
            } catch { /* not up yet */ }
            if (Date.now() - start > timeoutMs) return reject(new Error(`timed out waiting for ${url}`));
            setTimeout(tick, 200);
        };
        tick();
    });
}

/**
 * Layer 2. Aborts the run if any Secret-mode surface would land inside the
 * region about to be captured.
 *
 * The test is intersection with `rect` (page coordinates), not mere
 * visibility: a Secret control scrolled out of frame, or sitting outside a
 * clipped crop, is not in the PNG and should not fail the run - while one that
 * is in frame must, whatever else is true about it.
 */
async function assertNoSecretSurface(cdp, shotName, rect) {
    const found = await cdp.eval(`
    const rect = ${JSON.stringify(rect)};
    const sels = ${JSON.stringify(SECRET_SELECTORS)}.concat([${JSON.stringify(SECRET_SETTINGS_FIELD)}]);
    const hits = new Set();
    const intersects = (r) =>
      r.right > rect.x && r.left < rect.x + rect.width &&
      r.bottom > rect.y && r.top < rect.y + rect.height;

    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        if (!window.__cap.visible(el)) continue;
        const b = el.getBoundingClientRect();
        const pageBox = {
          left: b.left + scrollX, right: b.right + scrollX,
          top: b.top + scrollY, bottom: b.bottom + scrollY,
        };
        if (intersects(pageBox)) {
          hits.add(el.id ? '#' + el.id
            : el.dataset.settingsKey ? 'settings:' + el.dataset.settingsKey
            : el.className);
        }
      }
    }
    return Array.from(hits);
  `);
    if (found.length) {
        throw new Error(
            `ABORTED before writing ${shotName}: a Secret-mode surface falls inside the capture area ` +
            `(${found.join(', ')}). No screenshot was saved.`);
    }
}

/**
 * The gallery index, written from the same shot definitions that produced the
 * images, so a caption cannot drift from the screenshot it describes.
 */
function writeIndex() {
    const lines = [
        '# Screenshots',
        '',
        'Every image here is captured from a real library by',
        '[`scripts/capture-screenshots.js`](../scripts/capture-screenshots.js). To refresh',
        'them after a UI change, run:',
        '',
        '```bash',
        'node scripts/capture-screenshots.js',
        '```',
        '',
        'The script starts its own server against a copy of your `config.json` with',
        "Secret mode stripped out, and aborts rather than saving a shot if any Secret-mode",
        'control would land inside the frame. Nothing private is in these images.',
        '',
        'The server it runs binds port 5099 rather than the usual 5089, which is why the',
        "Settings screenshot shows that port.",
        '',
    ];
    for (const s of SHOTS) {
        lines.push(`## ${s.title}`, '', s.caption, '', `![${s.title}](${s.name}.png)`, '');
    }
    fs.writeFileSync(path.join(OUT_DIR, 'README.md'), lines.join('\n'));
}

async function main() {
    const args = process.argv.slice(2);
    const headful = args.includes('--headful');
    const wanted = args.filter((a) => !a.startsWith('--'));

    if (args.includes('--list')) {
        for (const s of SHOTS) console.log(`${s.name}  —  ${s.title}`);
        return;
    }

    // Rewrites the gallery from the shot definitions without recapturing, for
    // when only a caption changed.
    if (args.includes('--index')) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
        writeIndex();
        console.log('examples/README.md rewritten');
        return;
    }

    const shots = wanted.length
        ? SHOTS.filter((s) => wanted.some((w) => s.name.includes(w)))
        : SHOTS;
    if (!shots.length) throw new Error(`no shots matched ${wanted.join(', ')}`);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-gui-capture-'));
    const configPath = sanitiseConfig(REAL_CONFIG, tmpDir);
    console.log(`config:  ${configPath} (secretMode stripped)`);

    const server = spawn(process.execPath, [SERVER_JS], {
        env: { ...process.env, IMPORT_GUI_CONFIG: configPath },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let serverLog = '';
    server.stdout.on('data', (d) => { serverLog += d; });
    server.stderr.on('data', (d) => { serverLog += d; });

    const chromeDir = path.join(tmpDir, 'chrome-profile');
    let chrome;

    const cleanup = () => {
        try { chrome?.kill(); } catch { }
        try { server.kill(); } catch { }
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(130); });

    try {
        await waitForHttp(`${BASE_URL}/`);
        console.log(`server:  ${BASE_URL}`);

        // Headful is the absence of the flag, not --headless=false.
        chrome = spawn(findChrome(), [
            headful ? null : '--headless=new',
            `--remote-debugging-port=${CDP_PORT}`,
            `--user-data-dir=${chromeDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--hide-scrollbars',
            '--disable-extensions',
            `--window-size=${DEFAULT_WIDTH},${DEFAULT_HEIGHT}`,
            'about:blank',
        ].filter(Boolean), { stdio: ['ignore', 'pipe', 'pipe'] });

        await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
        const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        const page = targets.find((t) => t.type === 'page');
        if (!page) throw new Error('no Chrome page target');

        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
            ws.addEventListener('open', res, { once: true });
            ws.addEventListener('error', () => rej(new Error('CDP socket failed')), { once: true });
        });
        const cdp = new Cdp(ws);
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');

        for (const shot of shots) {
            const width = shot.width || DEFAULT_WIDTH;
            const height = shot.height || DEFAULT_HEIGHT;
            await cdp.send('Emulation.setDeviceMetricsOverride', {
                width, height, deviceScaleFactor: 1, mobile: !!shot.mobile,
            });

            await cdp.send('Page.navigate', { url: BASE_URL });
            await new Promise((r) => setTimeout(r, 1200));
            await cdp.eval(PAGE_HELPERS + '\n return true;');
            await cdp.eval(`window.__cap.__npc = ${JSON.stringify(shot.npc || null)}; return true;`);

            await cdp.eval(shot.setup);

            const params = { format: 'png', captureBeyondViewport: !!shot.fullPage };
            if (shot.fullPage) {
                const m = await cdp.send('Page.getLayoutMetrics');
                params.clip = {
                    x: 0, y: 0,
                    width: Math.ceil(m.cssContentSize.width),
                    height: Math.ceil(m.cssContentSize.height),
                    scale: 1,
                };
            } else if (shot.clip) {
                // `clipTo` extends the crop down to the bottom of a second
                // element, for the cases where the thing worth showing is a
                // heading plus the table under it rather than one box.
                const box = await cdp.eval(`
          const el = document.querySelector(${JSON.stringify(shot.clip)});
          if (!el) throw new Error('no element ' + ${JSON.stringify(shot.clip)});
          const r = el.getBoundingClientRect();
          let bottom = r.bottom;
          let right = r.right;
          const toSel = ${JSON.stringify(shot.clipTo || null)};
          if (toSel) {
            const to = document.querySelector(toSel);
            if (!to) throw new Error('no element ' + toSel);
            const tr = to.getBoundingClientRect();
            bottom = Math.max(bottom, tr.bottom);
            right = Math.max(right, tr.right);
          }
          return {
            x: r.x + scrollX, y: r.y + scrollY,
            width: right - r.x, height: bottom - r.y,
          };
        `);
                const pad = shot.pad ?? 12;
                params.captureBeyondViewport = true;
                params.clip = {
                    x: Math.max(0, box.x - pad),
                    y: Math.max(0, box.y - pad),
                    width: box.width + pad * 2,
                    // A cap, for the panels whose natural height runs to
                    // thousands of pixels - an 8000px tall PNG is unreadable
                    // in a README and enormous in the repo.
                    height: Math.min(box.height + pad * 2, shot.clipHeight ?? Infinity),
                    scale: 1,
                };
            }

            // Layer 2 runs against the exact region about to be captured, so
            // it has to come after the clip is known.
            const guardRect = params.clip
                ? { x: params.clip.x, y: params.clip.y, width: params.clip.width, height: params.clip.height }
                : await cdp.eval('return { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight };');
            await assertNoSecretSurface(cdp, shot.name, guardRect);

            const { data } = await cdp.send('Page.captureScreenshot', params);
            const file = path.join(OUT_DIR, `${shot.name}.png`);
            fs.writeFileSync(file, Buffer.from(data, 'base64'));
            const kb = (fs.statSync(file).size / 1024).toFixed(0);
            console.log(`  ✓ ${shot.name}.png  ${kb} KB`);
        }

        console.log(`\n${shots.length} shot(s) written to examples/`);

        // Only when the whole set was captured: an index written from a
        // subset would drop the shots this run did not take.
        if (shots.length === SHOTS.length) {
            writeIndex();
            console.log('examples/README.md rewritten');
        } else {
            console.log('(partial run — examples/README.md left alone)');
        }
    } catch (err) {
        console.error(`\nFAILED: ${err.message}`);
        if (serverLog.trim()) console.error(`\n--- server output ---\n${serverLog.trim()}`);
        process.exitCode = 1;
    } finally {
        cleanup();
    }
}

main();
