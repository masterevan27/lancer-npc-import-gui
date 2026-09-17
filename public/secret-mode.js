/* Art-style selection and the authenticated private gallery. No private
 * catalogue entries or credentials are bundled in this file. */
(function (root) {
  'use strict';
  const DEFAULT = { id: 'default', name: 'Default' };

  function visibleStyles(styles, authenticated) {
    return [DEFAULT, ...(Array.isArray(styles) ? styles : []).filter(style =>
      style && style.id !== 'default' && (authenticated || (!style.hidden && !style.secret)))];
  }

  function routeRequest(path, options = {}, authenticated = false, selections = {}) {
    const pathname = path.split('?')[0];
    const next = { ...options };
    const create = pathname === '/api/create' || pathname === '/api/create-npc';
    const background = pathname.startsWith('/api/backgrounds');
    if ((create || background) && next.method === 'POST' && typeof next.body === 'string') {
      const body = JSON.parse(next.body);
      const kind = background ? 'background' : pathname === '/api/create-npc' ? 'npc' : body.kind || 'npc';
      body.artStyle = selections[kind] || 'default';
      if (selections.workflows) body.workflow = selections.workflows[kind] || 'default';
      if (create && kind === 'npc' && selections.colorGuidance) body.colorGuidance = selections.colorGuidance[kind] || 'default';
      if (create && authenticated) body.kind = kind;
      if (create && authenticated && selections.dimensions?.[kind]) Object.assign(body, selections.dimensions[kind]);
      // The Secret tables section is an NPC-only, logged-in-only part of the
      // form, so its picks ride along here rather than in app.js's body.
      if (create && authenticated && kind === 'npc' && selections.secretTables) {
        body.extraTables = selections.secretTables.extraTables;
        body.disabledTables = selections.secretTables.disabledTables;
      }
      if (create && authenticated && kind === 'npc' && selections.promptLayout) body.promptLayout = selections.promptLayout;
      next.body = JSON.stringify(body);
    }
    if (authenticated) {
      if (create) path = '/api/secret/create';
      else if (pathname === '/api/create-status') path = path.replace('/api/', '/api/secret/');
      else if (background) path = path.replace('/api/', '/api/secret/');
    }
    return { path, options: next };
  }

  function createTransport(fetcher, onExpired = () => {}, selections = () => ({})) {
    let authenticated = false, epoch = 0;
    return {
      get authenticated() { return authenticated; },
      setAuthenticated(value) { authenticated = !!value; epoch += 1; },
      async fetch(path, options = {}) {
        const requestEpoch = epoch;
        const routed = routeRequest(path, options, authenticated, selections());
        const privateRequest = routed.path.startsWith('/api/secret/');
        const res = await fetcher(routed.path, { ...routed.options, credentials: 'same-origin', cache: 'no-store' });
        if (privateRequest && res.status === 401) {
          authenticated = false; epoch += 1; onExpired();
          throw new Error('Secret session expired. Log in again.');
        }
        // Consume the body before checking the epoch: response headers alone
        // can arrive well before private data finishes downloading.
        const text = await res.text();
        if (requestEpoch !== epoch) throw new Error('Secret session changed; response discarded.');
        return new Response(res.status === 204 ? null : text, { status: res.status, headers: res.headers });
      },
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { visibleStyles, routeRequest, createTransport };
    return;
  }
  const get = id => document.getElementById(id);
  let composer = null;
  const selections = () => ({ ...Object.fromEntries(['npc', 'spaceship', 'background'].map(kind =>
    [kind, document.querySelector(`[data-art-style="${kind}"]`)?.value || 'default'])),
    workflows: Object.fromEntries(['npc', 'spaceship', 'background'].map(kind =>
      [kind, document.querySelector(`[data-workflow="${kind}"]`)?.value || 'default'])),
    colorGuidance: { npc: document.querySelector('[data-color-guidance="npc"]')?.value || 'default' },
    dimensions: Object.fromEntries(['npc', 'spaceship'].map(kind => [kind, dimensionPicks(kind)])),
    secretTables: secretTablePicks(), promptLayout: composer?.getLayout() });

  function dimensionPicks(kind) {
    const width = get(`secret-${kind}-width`)?.value || '';
    const height = get(`secret-${kind}-height`)?.value || '';
    const tokenWidth = get(`secret-${kind}-token-width`)?.value || '';
    const tokenHeight = get(`secret-${kind}-token-height`)?.value || '';
    return { ...(width || height ? { width, height } : {}),
      ...(tokenWidth || tokenHeight ? { tokenWidth, tokenHeight } : {}) };
  }

  // What the Secret tables section has ticked, or null while it is hidden.
  function secretTablePicks() {
    const section = get('secret-tables-section');
    if (!section || section.hidden) return null;
    const files = new Map();
    for (const box of document.querySelectorAll('[data-secret-table]')) {
      if (!box.checked || box.gateClosed) continue;
      if (!files.has(box.dataset.secretFile)) files.set(box.dataset.secretFile, { tables: [], values: {} });
      const pick = files.get(box.dataset.secretFile);
      pick.tables.push(box.dataset.secretTable);
      if (box.valueSelect?.value) Object.defineProperty(pick.values, box.dataset.secretTable,
        { value: box.valueSelect.value, enumerable: true, configurable: true, writable: true });
      const { portrait, token } = box.targetInputs;
      if (!portrait.checked || !token.checked) {
        pick.targets ||= {};
        Object.defineProperty(pick.targets, box.dataset.secretTable,
          { value: portrait.checked ? 'portrait' : 'token', enumerable: true, configurable: true, writable: true });
      }
    }
    return {
      extraTables: [...files].map(([file, pick]) => ({ file, ...pick })),
      disabledTables: [...document.querySelectorAll('[data-disable-table]')].filter(box => box.checked).map(box => box.dataset.disableTable),
    };
  }
  const transport = createTransport(root.fetch.bind(root), expire, selections);
  const ready = root.fetch('/api/secret/session', { cache: 'no-store', credentials: 'same-origin' })
    .then(res => res.ok ? res.json() : { authenticated: false, configured: false })
    .then(session => { transport.setAuthenticated(session.authenticated); return session; })
    .catch(() => ({ authenticated: false, configured: false }));
  let galleryItems = [], galleryRequest = 0, lastFocus = 0;
  let visibleItems = [], detailId = null, detailBusy = false;
  const sessionChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lancer-secret-session');

  root.SecretMode = {
    get active() { return transport.authenticated; },
    async fetch(path, options) { await ready; return transport.fetch(path, options); },
    async generated() {
      if (!transport.authenticated) return;
      try { await loadGallery(); }
      catch (err) { get('secret-gallery-status').textContent = err.message; }
    },
    openGallery,
  };

  async function json(path, options) {
    const response = await root.SecretMode.fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.reason || `HTTP ${response.status}`);
    return data;
  }
  const post = (path, body) => json(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function clearPrivateView() {
    createState.presetName = '';
    shipCreateState.presetName = '';
    composer?.clear();
    if (!get('set-trait-overlay').hidden) get('set-trait-cancel').click();
    for (const id of ['set-trait-title', 'set-trait-list', 'set-trait-release-label']) get(id).textContent = '';
    get('set-trait-filter').value = '';
    galleryItems = []; visibleItems = []; detailId = null; galleryRequest += 1;
    for (const kind of ['npc', 'spaceship']) {
      get(`secret-${kind}-dimensions`).hidden = true;
      get(`secret-${kind}-width`).value = '';
      get(`secret-${kind}-height`).value = '';
      get(`secret-${kind}-token-width`).value = '';
      get(`secret-${kind}-token-height`).value = '';
    }
    for (const id of ['secret-grid', 'secret-detail-images', 'secret-detail-prompts', 'secret-detail-traits']) get(id)?.replaceChildren();
    for (const id of ['secret-detail-name', 'secret-detail-style', 'secret-storage-path']) {
      const node = get(id); if (node) { node.textContent = ''; if ('value' in node) node.value = ''; }
    }
    for (const node of document.querySelectorAll('[data-art-style]')) {
      node.replaceChildren(new Option(DEFAULT.name, DEFAULT.id));
    }
    for (const node of document.querySelectorAll('[data-color-guidance]')) {
      node.replaceChildren(new Option(DEFAULT.name, DEFAULT.id));
    }
    for (const node of document.querySelectorAll('[data-workflow]')) node.replaceChildren(new Option(DEFAULT.name, DEFAULT.id));
    for (const id of ['secret-tables-files', 'secret-disable-tables']) get(id)?.replaceChildren();
    gateOrder = []; gateFileErrors = [];
    if (get('secret-tables-gate-error')) { get('secret-tables-gate-error').textContent = ''; get('secret-tables-gate-error').hidden = true; }
    get('secret-roll-order-list')?.replaceChildren();
    if (get('secret-roll-order-summary')) get('secret-roll-order-summary').textContent = 'Roll order and gates';
    if (get('secret-tables-section')) get('secret-tables-section').hidden = true;
    get('secret-preset-select')?.replaceChildren();
    if (get('secret-presets-section')) get('secret-presets-section').hidden = true;
    if (get('secret-preset-status')) get('secret-preset-status').textContent = '';
    get('secret-detail-status').textContent = '';
    get('image-zoom').hidden = true;
    get('secret-detail-overlay').hidden = true;
    // Remove private images and job text from the shared creation panels too.
    for (const node of document.querySelectorAll('img')) {
      if (node.getAttribute('src')?.startsWith('/api/secret/')) node.removeAttribute('src');
    }
    for (const node of document.querySelectorAll('.job-log, #bg-dynamic-preview')) node.textContent = '';
  }

  function expire() {
    clearPrivateView();
    root.location.replace('/');
  }

  async function loadStyles() {
    const data = await json('/api/art-styles');
    const styles = visibleStyles(data.styles, transport.authenticated);
    for (const select of document.querySelectorAll('[data-art-style]')) {
      const selected = select.dataset.styleId || select.value;
      select.replaceChildren(...styles.map(style => new Option(style.name, style.id)));
      select.value = styles.some(style => style.id === selected) ? selected : 'default';
      select.disabled = false;
    }
    get('art-style-error').hidden = true;
  }

  // Gate state for the Secret tables section (public/secret-gates.js):
  // the roll order of every listed table, recomputed into greyed rows,
  // notes and the roll order panel whenever a box or dropdown changes.
  let gateOrder = [];
  let gateFileErrors = [];
  function refreshGates() {
    const inputs = [...document.querySelectorAll('[data-secret-table]')];
    const picks = new Map(inputs.filter(box => box.checked).map(box => [box.dataset.gateKey, box.valueSelect.value]));
    const result = root.SecretGates.resolveGates(gateOrder, picks, { dropClosed: true });
    for (const box of inputs) {
      const entry = gateOrder.find(item => item.key === box.dataset.gateKey);
      const status = result.status.get(box.dataset.gateKey);
      box.gateClosed = status?.state === 'closed';
      box.gateRow.classList.toggle('secret-table-closed', box.gateClosed);
      box.gateRow.style.setProperty('--gate-depth', String(entry?.depth || 0));
      const text = box.checked && status && (entry?.when || status.limited) ? status.text : '';
      box.gateNote.textContent = text;
      box.gateNote.hidden = !text;
      box.syncControls();
    }
    const error = get('secret-tables-gate-error');
    if (error) { error.textContent = result.error || ''; error.hidden = !result.error; }
    renderRollOrder(result);
  }

  function renderRollOrder(result) {
    const list = get('secret-roll-order-list');
    if (!list) return;
    const view = root.SecretGates.rollOrderView(gateOrder, result, gateFileErrors);
    get('secret-roll-order-summary').textContent = view.summary;
    list.replaceChildren(...view.items.map(item => {
      const li = document.createElement('li'); li.className = 'secret-roll-order-item';
      li.style.setProperty('--gate-depth', String(item.depth));
      const title = document.createElement('strong'); title.textContent = item.title;
      const file = document.createElement('span'); file.className = 'hint'; file.textContent = ` ${item.file}`;
      li.append(title, file);
      for (const [className, text] of [['secret-roll-order-gate', item.gate], ['secret-roll-order-opens', item.opens], ['secret-roll-order-status', item.status]]) {
        if (!text) continue;
        const line = document.createElement('div'); line.className = className; line.textContent = text;
        li.append(line);
      }
      return li;
    }));
  }

  // Whether the panel is open is a per-viewer convenience only.
  const ROLL_ORDER_OPEN_KEY = 'secretRollOrderOpen';
  function initRollOrderPanel() {
    const panel = get('secret-roll-order');
    if (!panel || panel.dataset.ready) return;
    panel.dataset.ready = '1';
    try { panel.open = root.localStorage.getItem(ROLL_ORDER_OPEN_KEY) === '1'; } catch { panel.open = false; }
    panel.addEventListener('toggle', () => {
      try { root.localStorage.setItem(ROLL_ORDER_OPEN_KEY, panel.open ? '1' : '0'); } catch { /* storage unavailable */ }
    });
  }

  // The Secret tables section of Create NPC: one fieldset per file in the
  // secret-tables folder with a checkbox per table (the legend's box ticks
  // the whole file), and one row of checkboxes for the default tables the
  // generator lets a run leave out of the prompt. Shown only while logged in.
  async function loadSecretTables() {
    const section = get('secret-tables-section');
    if (!section) return;
    if (!transport.authenticated) { section.hidden = true; return; }
    const data = await json('/api/secret/tables');
    gateOrder = root.SecretGates.rollOrder(data.files || []);
    gateFileErrors = (data.files || []).filter(file => file.error).map(({ file, error }) => ({ file, error }));
    initRollOrderPanel();
    const filesNode = get('secret-tables-files'); filesNode.replaceChildren();
    for (const file of data.files || []) {
      const box = document.createElement('fieldset'); box.className = 'secret-tables-file';
      const legend = document.createElement('legend');
      if (file.error) {
        legend.className = 'secret-tables-error'; legend.textContent = `${file.file} - ${file.error}`;
        box.append(legend); filesNode.append(box); continue;
      }
      const all = document.createElement('input'); all.type = 'checkbox'; all.dataset.secretFile = file.file;
      const allLabel = document.createElement('label'); allLabel.append(all, ` ${file.file}`);
      legend.append(allLabel); box.append(legend);
      const inputs = [];
      for (const table of file.tables || []) {
        const input = document.createElement('input'); input.type = 'checkbox';
        input.dataset.secretTable = table.name; input.dataset.secretFile = file.file;
        input.dataset.gateKey = root.SecretGates.entryKey(file.file, table.name);
        const count = document.createElement('span'); count.className = 'hint'; count.textContent = `(${table.count})`;
        const row = document.createElement('div'); row.className = 'secret-tables-table';
        const header = document.createElement('div'); header.className = 'secret-table-header';
        const label = document.createElement('label');
        label.className = 'secret-table-enable';
        const select = document.createElement('select');
        select.setAttribute('aria-label', `${table.name} value (${file.file})`);
        select.replaceChildren(new Option('Random (weighted)', ''));
        for (const group of table.groups || [{ name: '', values: table.values || [] }]) {
          const parent = group.name ? document.createElement('optgroup') : select;
          if (group.name) { parent.label = group.name; select.append(parent); }
          parent.append(...group.values.map(value => new Option(value, value)));
        }
        select.disabled = true; input.valueSelect = select;
        const valueField = document.createElement('div'); valueField.className = 'secret-table-value';
        const preview = document.createElement('p'); preview.className = 'secret-table-value-preview';
        valueField.append(select, preview);
        label.append(input, ` ${table.name} `, count);
        if (table.when) {
          row.classList.add('secret-table-gated');
          const when = document.createElement('span'); when.className = 'hint secret-table-when';
          when.textContent = ` when: ${table.when.map(tag => `#${tag}`).join(', ')}`;
          label.append(when);
        }
        header.append(label);
        const gateNote = document.createElement('p'); gateNote.className = 'hint secret-table-gate-note'; gateNote.hidden = true;
        input.gateNote = gateNote; input.gateRow = row;
        row.append(header, valueField, gateNote); box.append(row); inputs.push(input);
        const targets = document.createElement('span'); targets.className = 'secret-table-targets';
        targets.setAttribute('role', 'group');
        targets.setAttribute('aria-label', `${table.name} image targets (${file.file})`);
        const targetHint = document.createElement('span'); targetHint.className = 'hint'; targetHint.textContent = 'Apply to:';
        targets.append(targetHint);
        input.targetInputs = {};
        for (const target of ['portrait', 'token']) {
          const targetInput = document.createElement('input'); targetInput.type = 'checkbox';
          targetInput.checked = true;
          targetInput.setAttribute('aria-label', `${table.name}: apply to ${target} (${file.file})`);
          const targetLabel = document.createElement('label');
          targetLabel.append(targetInput, target === 'portrait' ? ' Portrait' : ' Token');
          targets.append(targetLabel); input.targetInputs[target] = targetInput;
          targetInput.addEventListener('change', () => input.syncControls());
        }
        header.append(targets);
        input.syncControls = () => {
          select.disabled = !input.checked || Boolean(input.gateClosed);
          preview.textContent = select.value;
          preview.hidden = !input.checked || !select.value;
          select.title = select.value || 'Random (weighted)';
          const { portrait, token } = input.targetInputs;
          portrait.disabled = !input.checked || !token.checked || Boolean(input.gateClosed);
          token.disabled = !input.checked || !portrait.checked || Boolean(input.gateClosed);
        };
        input.syncControls();
        select.addEventListener('change', () => { input.syncControls(); refreshGates(); });
        input.addEventListener('change', () => {
          input.syncControls();
          all.checked = inputs.every(other => other.checked);
          all.indeterminate = !all.checked && inputs.some(other => other.checked);
          refreshGates();
        });
      }
      all.addEventListener('change', () => {
        for (const input of inputs) { input.checked = all.checked; input.syncControls(); }
        all.indeterminate = false;
        refreshGates();
      });
      all.secretInputs = inputs;
      filesNode.append(box);
    }
    get('secret-tables-status').textContent = !data.exists ? `Folder not found: ${data.dir}. Create it, or point secretTablesDir at yours in Settings.`
      : (data.files || []).length ? `From ${data.dir}. Untick everything to roll the default tables alone.` : `No .json or .md tables in ${data.dir}.`;
    const disable = get('secret-disable-tables'); disable.replaceChildren();
    for (const name of data.disableable || []) {
      const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.disableTable = name;
      const label = document.createElement('label'); label.append(input, ` ${name}`); disable.append(label);
    }
    refreshGates();
    section.hidden = false;
    await loadSecretPresets();
  }

  async function loadSecretPresets(wanted = '') {
    const data = await json('/api/secret/presets');
    const select = get('secret-preset-select');
    select.replaceChildren(new Option('— pick a secret preset —', ''),
      ...(data.presets || []).map(preset => new Option(preset.name, preset.slug)));
    select.value = wanted;
    get('secret-preset-load').disabled = !wanted;
    get('secret-preset-delete').disabled = !wanted;
    get('secret-presets-section').hidden = false;
  }

  function applySecretSettings(settings, presetName = '') {
    // Check every saved choice before changing any form fields.
    const inputs = [...document.querySelectorAll('[data-secret-table]')];
    const restored = new Map();
    for (const pick of settings.extraTables || []) {
      for (const table of pick.tables) {
        const input = inputs.find(box => box.dataset.secretFile === pick.file && box.dataset.secretTable === table);
        const value = Object.hasOwn(pick.values || {}, table) ? pick.values[table] : '';
        if (!input || ![...input.valueSelect.options].some(option => option.value === value)) {
          throw new Error(`Reload Secret mode: ${pick.file} / ${table} has changed.`);
        }
        const target = Object.hasOwn(pick.targets || {}, table) ? pick.targets[table] : 'both';
        if (!['portrait', 'token', 'both'].includes(target)) throw new Error(`Invalid image target for ${table}.`);
        restored.set(input, { value, target });
      }
    }
    const selectors = [['create-art-style', 'artStyle'], ['create-workflow', 'workflow'], ['create-color-guidance', 'colorGuidance']];
    for (const [id, key] of selectors) {
      if (![...get(id).options].some(option => option.value === settings[key])) throw new Error(`${key} is no longer available.`);
    }
    applyCreateSettings(settings, presetName);
    get('secret-npc-width').value = settings.width ?? '';
    get('secret-npc-height').value = settings.height ?? '';
    get('secret-npc-token-width').value = settings.tokenWidth ?? '';
    get('secret-npc-token-height').value = settings.tokenHeight ?? '';
    for (const [id, key] of selectors) get(id).value = settings[key];
    for (const input of inputs) {
      input.checked = restored.has(input);
      const { value = '', target = 'both' } = restored.get(input) || {};
      input.valueSelect.value = value;
      input.targetInputs.portrait.checked = target !== 'token';
      input.targetInputs.token.checked = target !== 'portrait';
      input.syncControls();
    }
    refreshGates();
    for (const all of document.querySelectorAll('[data-secret-file]')) {
      if (!all.secretInputs) continue;
      all.checked = all.secretInputs.every(input => input.checked);
      all.indeterminate = !all.checked && all.secretInputs.some(input => input.checked);
    }
    for (const input of document.querySelectorAll('[data-disable-table]')) input.checked = (settings.disabledTables || []).includes(input.dataset.disableTable);
    composer?.setLayout(settings.promptLayout);
  }

  function setSecretTablesCollapsed(collapsed, fromBottom = false) {
    const toggle = get('secret-tables-toggle');
    get('secret-tables-content').hidden = collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? 'Expand secret tables' : 'Collapse secret tables';
    if (fromBottom) { toggle.scrollIntoView({ block: 'center' }); toggle.focus(); }
  }

  async function loadWorkflows() {
    const data = await json('/api/workflows');
    const workflows = visibleStyles(data.workflows, transport.authenticated);
    for (const select of document.querySelectorAll('[data-workflow]')) {
      const selected = select.value;
      select.replaceChildren(...workflows.map(workflow => new Option(workflow.name, workflow.id)));
      select.value = workflows.some(workflow => workflow.id === selected) ? selected : 'default';
      select.disabled = false;
    }
    get('workflow-error').hidden = true;
  }

  // The palette catalog, loaded the same way: ids and names only, the
  // saved selection restored where the catalog still offers it.
  async function loadColorGuidance() {
    const data = await json('/api/color-guidance');
    const entries = [...visibleStyles(data.guidance, transport.authenticated), { id: 'random', name: 'Random' }];
    for (const select of document.querySelectorAll('[data-color-guidance]')) {
      const selected = select.dataset.guidanceId || select.value;
      select.replaceChildren(...entries.map(entry => new Option(entry.name, entry.id)));
      select.value = entries.some(entry => entry.id === selected) ? selected : 'default';
      select.disabled = false;
    }
    get('color-guidance-error').hidden = true;
  }

  function openGallery() {
    if (!transport.authenticated) return;
    // Keep the normal category navigation available alongside the private pill.
    if (typeof switchTab === 'function') switchTab('import');
    get('public-gallery').hidden = true;
    get('secret-gallery').hidden = false;
    get('secret-images').classList.add('active');
    for (const button of get('categories').querySelectorAll('button')) button.classList.remove('active');
    loadGallery().catch(err => { get('secret-gallery-status').textContent = err.message; });
  }

  async function loadGallery() {
    if (!transport.authenticated) return;
    const serial = ++galleryRequest;
    const data = await json('/api/secret/items');
    if (!transport.authenticated || serial !== galleryRequest) return;
    galleryItems = data.items || [];
    renderGallery();
  }

  function renderGallery() {
    const grid = get('secret-grid'); grid.replaceChildren();
    const search = get('secret-search').value.toLowerCase();
    const kind = get('secret-kind').value;
    const items = galleryItems.filter(item => (!kind || item.kind === kind) &&
      [item.name, item.callsign, item.artStyle?.name, ...Object.values(item.traits || {})].join(' ').toLowerCase().includes(search));
    items.sort((a, b) => get('secret-sort').value === 'name' ? a.name.localeCompare(b.name) :
      String(b.when || '').localeCompare(String(a.when || '')));
    visibleItems = items;
    for (const item of items) {
      const card = document.createElement('div');
      card.className = `card${item.kind === 'spaceship' ? ' card--spaceship' : item.kind === 'background' ? ' card--background' : ''}`;
      card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', `View ${item.name}`);
      const img = document.createElement('img'); img.className = 'thumb'; img.loading = 'lazy';
      img.src = item.portraitUrl || item.tokenUrl || ''; img.alt = item.name; card.append(img);
      const body = document.createElement('div'); body.className = 'body';
      for (const [className, text] of [['name', item.name], ['sub', item.callsign], ['role', item.traits?.Role],
        ['sub', `Art style: ${item.artStyle?.name || 'Default'}`],
        ['sub preset-label', item.presetName ? `Preset: ${item.presetName}` : '']]) {
        if (!text) continue;
        const line = document.createElement('div'); line.className = className; line.textContent = text; body.append(line);
      }
      card.append(body); card.addEventListener('click', () => openDetail(item));
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(item); } });
      grid.append(card);
    }
    get('secret-gallery-status').textContent = `${items.length} secret image${items.length === 1 ? '' : 's'}`;
    get('secret-empty').hidden = items.length !== 0;
  }

  function openDetail(item, preserve = false) {
    detailId = item.id;
    get('image-zoom').hidden = true;
    const position = visibleItems.findIndex(other => other.id === item.id);
    get('secret-detail-prev').disabled = position <= 0;
    get('secret-detail-next').disabled = position < 0 || position >= visibleItems.length - 1;
    get('secret-detail-name').textContent = item.name;
    get('secret-detail-style').textContent = `Art style: ${item.artStyle?.name || 'Default'}`;
    const images = get('secret-detail-images'); images.replaceChildren();
    for (const [label, url] of [['Portrait', item.portraitUrl], ['Token', item.tokenUrl]]) {
      if (!url) continue;
      const figure = document.createElement('figure'), img = document.createElement('img'), caption = document.createElement('figcaption');
      img.src = url; img.alt = `${item.name} — ${label}`; caption.textContent = label;
      if (typeof attachImageZoom === 'function') attachImageZoom(img, true);
      figure.append(img, caption); images.append(figure);
    }
    const traits = item.background?.scene?.traits || item.traits || {};
    const traitRows = get('secret-detail-traits'); traitRows.replaceChildren();
    for (const [key, value] of Object.entries(traits)) {
      const row = document.createElement('tr'), control = document.createElement('td'), setControl = document.createElement('td'), name = document.createElement('td'), text = document.createElement('td');
      if ((item.rerollable || []).includes(key)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'reroll-btn'; button.textContent = 'Re-roll';
        button.disabled = detailBusy || item.regenStatus === 'running';
        button.addEventListener('click', () => mutateDetail('/api/secret/reroll-trait', { id: item.id, trait: key }));
        control.append(button);
        if (item.hasRawTraits) {
          const set = document.createElement('button'); set.type = 'button'; set.className = 'set-trait-btn'; set.textContent = 'Set…';
          set.disabled = detailBusy || item.regenStatus === 'running';
          set.addEventListener('click', async () => {
            const picked = await openSetTrait(item, key);
            if (!picked || !transport.authenticated || detailId !== item.id) return;
            await mutateDetail('/api/secret/set-trait', { id: item.id, trait: key, value: picked.value, release: picked.release });
          });
          setControl.append(set);
        }
      }
      name.textContent = key;
      text.textContent = (item.disabledTables || []).includes(key) ? `${value} (left out of the prompt)` : value;
      row.append(control, setControl, name, text); traitRows.append(row);
    }
    // The secret tables' rolled values, after the defaults. Not re-rollable
    // from here: the values were drawn from a file the entry does not name.
    for (const [key, value] of Object.entries(item.extraTraits || {})) {
      const row = document.createElement('tr'), control = document.createElement('td'), name = document.createElement('td'), text = document.createElement('td');
      row.className = 'secret-extra-trait'; name.textContent = key; text.textContent = value;
      row.append(control, document.createElement('td'), name, text); traitRows.append(row);
    }
    get('secret-regen-panel').hidden = item.kind === 'background';
    get('secret-regen-btn').disabled = detailBusy || item.regenStatus === 'running';
    if (!preserve) {
      get('secret-regen-art-style').value = item.artStyle?.id || 'default';
      get('secret-regen-color-guidance').value = item.colorGuidance?.id || 'default';
      const guidanceLabel = get('secret-regen-color-guidance').parentElement;
      if (guidanceLabel) guidanceLabel.hidden = (item.kind || 'npc') !== 'npc';
      get('secret-regen-workflow').value = 'default';
      get('secret-regen-which').value = 'both';
      get('secret-regen-seed-mode').value = 'same';
      get('secret-regen-seed').value = item.seed ?? '';
      get('secret-regen-seed').disabled = true;
      get('secret-detail-status').textContent = item.artStale ? 'Traits changed. Regenerate to update the images.' : '';
    }
    const prompts = item.prompts || { Portrait: item.portraitPrompt || item.background?.scene?.prompt, Token: item.tokenPrompt };
    get('secret-detail-prompts').textContent = typeof prompts === 'string' ? prompts :
      Object.entries(prompts).filter(([, value]) => value).map(([key, value]) => `${key}\n${value}`).join('\n\n');
    get('secret-detail-overlay').hidden = false;
    get('secret-detail-close').focus();
  }

  function stepDetail(offset) {
    const index = visibleItems.findIndex(item => item.id === detailId);
    if (index >= 0 && visibleItems[index + offset]) openDetail(visibleItems[index + offset]);
  }

  function closeDetail() {
    if (!get('set-trait-overlay').hidden) get('set-trait-cancel').click();
    get('secret-detail-overlay').hidden = true;
    get('image-zoom').hidden = true;
    detailId = null;
  }

  async function mutateDetail(route, body) {
    if (detailBusy) return;
    detailBusy = true;
    const owner = body.id;
    const item = galleryItems.find(item => item.id === owner);
    if (item) openDetail(item, true);
    const editing = route.endsWith('reroll-trait') || route.endsWith('set-trait');
    get('secret-detail-status').textContent = editing ? 'Updating trait…' : 'Regenerating…';
    try {
      const { jobId } = await post(route, body);
      let job;
      do {
        await new Promise(resolve => root.setTimeout(resolve, 1000));
        if (!transport.authenticated) return;
        job = await json('/api/secret/create-status?jobId=' + encodeURIComponent(jobId));
      } while (job.status === 'running');
      if (job.status !== 'done') throw new Error(job.error || job.log || 'Generation failed');
      await loadGallery();
      if (detailId === owner) get('secret-detail-status').textContent = editing ? 'Traits and prompts updated. Regenerate to update the images.' : 'Images regenerated.';
    } catch (err) {
      if (detailId === owner) get('secret-detail-status').textContent = err.message;
    } finally {
      detailBusy = false;
      const current = galleryItems.find(item => item.id === detailId);
      if (current) openDetail(current, true);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    get('secret-tables-toggle').addEventListener('click', () => setSecretTablesCollapsed(!get('secret-tables-content').hidden));
    get('secret-tables-collapse').addEventListener('click', () => setSecretTablesCollapsed(true, true));
    // A phone starts with the section folded (the disable-tables list is inside it too). isPhone() is
    // app.js's, a global by the time this event fires; absent (as in a bare test), nothing changes.
    if (typeof root.isPhone === 'function' && root.isPhone()) setSecretTablesCollapsed(true);
    get('secret-preset-select').addEventListener('change', () => {
      const chosen = !!get('secret-preset-select').value;
      get('secret-preset-load').disabled = !chosen;
      get('secret-preset-delete').disabled = !chosen;
      get('secret-preset-status').textContent = '';
    });
    const presetAction = async action => {
      try { await action(); }
      catch (err) { get('secret-preset-status').textContent = err.message; }
    };
    get('secret-preset-save').addEventListener('click', () => presetAction(async () => {
      if (!transport.authenticated) return;
      const name = root.prompt('Name this secret preset');
      if (name === null) return;
      const selected = selections();
      const settings = { ...createFormSettings(), ...secretTablePicks(), ...selected.dimensions.npc, artStyle: selected.npc,
        workflow: selected.workflows.npc, colorGuidance: selected.colorGuidance.npc, promptLayout: composer?.getLayout() || {} };
      const { slug } = await post('/api/secret/presets', { name, settings });
      createState.presetName = name.trim();
      await loadSecretPresets(slug);
      get('secret-preset-status').textContent = `Saved “${name.trim()}”.`;
    }));
    get('secret-preset-load').addEventListener('click', () => presetAction(async () => {
      const slug = get('secret-preset-select').value;
      if (!transport.authenticated || !slug) return;
      const preset = await json('/api/secret/presets/export?slug=' + encodeURIComponent(slug));
      applySecretSettings(preset.settings, preset.name);
      get('secret-preset-status').textContent = `Loaded “${preset.name}”.`;
    }));
    get('secret-preset-delete').addEventListener('click', () => presetAction(async () => {
      const select = get('secret-preset-select');
      const slug = select.value;
      if (!transport.authenticated || !slug || !root.confirm(`Delete secret preset “${select.selectedOptions[0].textContent}”?`)) return;
      await post('/api/secret/presets/delete', { slug });
      await loadSecretPresets();
      get('secret-preset-status').textContent = 'Secret preset deleted.';
    }));
    const session = await ready;
    get('leave-secret').hidden = !session.authenticated;
    get('secret-images').hidden = !session.authenticated;
    get('secret-storage').hidden = !session.authenticated;
    get('secret-open').hidden = !!session.authenticated;
    get('secret-mode-notice').hidden = !session.authenticated;
    document.body.classList.toggle('secret-mode', !!session.authenticated);
    for (const kind of ['npc', 'spaceship']) get(`secret-${kind}-dimensions`).hidden = !session.authenticated;
    if (session.authenticated) {
      const defaults = { width: '1920', height: '1080', tokenWidth: '1024', tokenHeight: '1280' };
      for (const [suffix, value] of Object.entries(defaults)) {
        const input = get(`secret-npc-${suffix.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())}`);
        if (input && !input.value) input.value = value;
      }
    }
    get('secret-open').addEventListener('click', () => {
      get('settings-overlay').hidden = true;
      get('secret-login-error').textContent = session.configured ? '' : 'Secret login is not configured. Add credentials to the server config first.';
      get('secret-login-overlay').hidden = false; get('secret-username').focus();
    });
    get('secret-login-cancel').addEventListener('click', () => { get('secret-login-overlay').hidden = true; get('secret-password').value = ''; });
    get('secret-login-form').addEventListener('submit', async event => {
      event.preventDefault(); get('secret-login-submit').disabled = true;
      try {
        // Login does not use the private transport's expiry handler.
        const response = await root.fetch('/api/secret/login', { method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: get('secret-username').value, password: get('secret-password').value }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Login failed');
        root.location.replace('/?secret=1');
      } catch (err) { get('secret-login-error').textContent = err.message; }
      finally { get('secret-password').value = ''; get('secret-login-submit').disabled = false; }
    });
    get('leave-secret').addEventListener('click', async () => {
      get('leave-secret').disabled = true;
      try {
        await post('/api/secret/logout', {});
        transport.setAuthenticated(false); clearPrivateView(); sessionChannel?.postMessage('logout'); root.location.replace('/');
      } catch (err) { get('secret-mode-status').textContent = `Could not log out: ${err.message}`; get('leave-secret').disabled = false; }
    });
    get('secret-images').addEventListener('click', openGallery);
    get('categories').addEventListener('click', event => {
      if (!event.target.closest('button')) return;
      get('public-gallery').hidden = false; get('secret-gallery').hidden = true; get('secret-images').classList.remove('active');
    });
    get('secret-refresh').addEventListener('click', () => loadGallery().catch(err => { get('secret-gallery-status').textContent = err.message; }));
    for (const id of ['secret-search', 'secret-kind', 'secret-sort']) get(id).addEventListener('input', renderGallery);
    get('secret-detail-close').addEventListener('click', closeDetail);
    get('secret-detail-overlay').addEventListener('click', event => {
      if (event.target === get('secret-detail-overlay')) closeDetail();
    });
    get('secret-detail-prev').addEventListener('click', () => stepDetail(-1));
    get('secret-detail-next').addEventListener('click', () => stepDetail(1));
    get('secret-regen-seed-mode').addEventListener('change', () => { get('secret-regen-seed').disabled = get('secret-regen-seed-mode').value !== 'specific'; });
    get('secret-regen-btn').addEventListener('click', () => mutateDetail('/api/secret/regenerate', {
      id: detailId, which: get('secret-regen-which').value, seedMode: get('secret-regen-seed-mode').value,
      seed: get('secret-regen-seed').value, artStyle: get('secret-regen-art-style').value,
      colorGuidance: get('secret-regen-color-guidance').value,
      workflow: get('secret-regen-workflow').value,
    }));
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented) return;
      if (!get('set-trait-overlay').hidden) {
        // Dead for a plain Escape: app.js's keydown handler runs first, closes the picker via __overlayClosers and calls preventDefault (only Ctrl/Alt/Meta+Esc get here).
        if (event.key === 'Escape') { event.preventDefault(); get('set-trait-cancel').click(); }
        return;
      }
      if (!get('secret-detail-overlay').hidden && !event.ctrlKey && !event.altKey && !event.metaKey &&
          !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); stepDetail(event.key === 'ArrowLeft' ? -1 : 1); return;
        }
      }
      if (event.key !== 'Escape') return;
      closeDetail(); get('secret-login-overlay').hidden = true; get('secret-password').value = '';
    });
    // Shared with app.js's topmostOverlay(), so Android back closes these
    // the same way Esc does. Same precedence as the keydown handler above:
    // the set-trait picker sits on top of the detail sheet, so it goes first.
    (window.__overlayClosers ||= []).push(
        { isOpen: () => !get('set-trait-overlay').hidden, close: () => get('set-trait-cancel').click() },
        { isOpen: () => !get('secret-detail-overlay').hidden, close: () => closeDetail() },
        {
            isOpen: () => !get('secret-login-overlay').hidden,
            close: () => {
                get('secret-login-overlay').hidden = true;
                get('secret-password').value = '';
            },
        },
    );
    get('settings-open').addEventListener('click', async () => {
      if (!transport.authenticated) return;
      try { const data = await json('/api/secret/settings'); get('secret-storage-path').value = data.secretImagesDir || ''; }
      catch (err) { get('secret-storage-status').textContent = err.message; }
    });
    get('secret-storage-save').addEventListener('click', async () => {
      try {
        const data = await post('/api/secret/settings', { secretImagesDir: get('secret-storage-path').value.trim() });
        get('secret-storage-status').textContent = data.restartRequired ? 'Saved. Restart the server to use the new folder.' : 'Saved. New images will use this folder.';
        if (!data.restartRequired) await loadGallery();
      } catch (err) { get('secret-storage-status').textContent = err.message; }
    });
    try { await loadStyles(); }
    catch (err) { get('art-style-error').textContent = `Could not load art styles: ${err.message}`; get('art-style-error').hidden = false; }
    try { await loadWorkflows(); }
    catch (err) { get('workflow-error').textContent = `Could not load workflows: ${err.message}`; get('workflow-error').hidden = false; }
    if (session.authenticated) {
      try { await loadSecretTables(); }
      catch (err) {
        if (get('secret-tables-status')) get('secret-tables-status').textContent = `Could not load secret tables: ${err.message}`;
        if (get('secret-tables-section')) get('secret-tables-section').hidden = false;
      }
    }
    try { await loadColorGuidance(); }
    catch (err) { get('color-guidance-error').textContent = `Could not load color guidance: ${err.message}`; get('color-guidance-error').hidden = false; }
    if (session.authenticated) {
      composer = root.PromptComposer.create({ element: get('secret-prompt-composer'), active: () => transport.authenticated,
        getRequest: () => {
          const selected = selections();
          return { ...createRequestBody(true), ...secretTablePicks(), artStyle: selected.npc,
            workflow: selected.workflows.npc, colorGuidance: selected.colorGuidance.npc };
        },
        request: body => post('/api/secret/prompt-preview', body).then(preview =>
          root.SecretGates.markGatedSources(preview, gateOrder.filter(entry => entry.when).map(entry => entry.name))) });
      openGallery();
    }
    const verifySession = async () => {
      if (Date.now() - lastFocus < 1000) return; lastFocus = Date.now();
      try {
        const response = await root.fetch('/api/secret/session', { cache: 'no-store' });
        const current = await response.json();
        if (!!current.authenticated !== transport.authenticated) {
          if (!current.authenticated) { transport.setAuthenticated(false); clearPrivateView(); }
          root.location.replace('/');
        }
      } catch { /* The next protected request still verifies the session. */ }
    };
    root.addEventListener('focus', verifySession);
    if (session.authenticated) root.setInterval(verifySession, 15000);
    if (sessionChannel) sessionChannel.onmessage = event => {
      if (event.data === 'logout' && transport.authenticated) { transport.setAuthenticated(false); expire(); }
    };
  });
})(typeof window === 'undefined' ? globalThis : window);
