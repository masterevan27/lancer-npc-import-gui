/* Dynamic backgrounds stay separate from the existing catalogue/animation UI. */
(function installDynamicBackgrounds(root) {
  function changeTrait(plan, name, value, locked) {
    const traits = { ...(plan?.traits || {}) };
    if (value === undefined) delete traits[name]; else traits[name] = value;
    const dependent = { Weather: 'Motion', Motion: 'Weather', Time: 'Lighting', Lighting: 'Time' }[name];
    if (dependent && !locked.includes(dependent)) delete traits[dependent];
    return traits;
  }
  function sceneRequest(plan, controls, locked, { reroll = false, only = null, render = false } = {}) {
    const traits = only ? changeTrait(plan, only, undefined, locked) : { ...(plan?.traits || {}) };
    return {
      environment: controls.environment || 'outdoor', view: controls.view || 'perspective',
      width: controls.width ?? 1920, height: controls.height ?? 1080,
      seed: controls.seed ?? null, count: render ? controls.count : 1,
      notes: controls.notes || '', traits, locked: locked.filter((name) => name !== only), reroll,
    };
  }
  function relevantValues(table, environment) {
    return (table.values || []).filter((value) => value.environments.includes(environment));
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { sceneRequest, relevantValues, changeTrait };
  if (typeof document === 'undefined') return;

  const get = (id) => document.getElementById(id);
  const el = Object.fromEntries(['environment', 'view', 'width', 'height', 'count', 'seed', 'notes',
    'traits', 'preview', 'roll', 'refresh', 'lock-all', 'unlock-all', 'preview-btn', 'render', 'animate',
    'pingpong', 'status', 'log'].map((key) => [key, get(`bg-dynamic-${key}`)]));
  const map = Object.fromEntries(['width', 'height', 'seed', 'notes', 'btn', 'status', 'log', 'results']
    .map((key) => [key, get(`bg-map-${key}`)]));
  const state = { catalogue: null, plan: null, locked: new Set(), busy: false, available: false,
    loading: null, selection: null, mapTimer: null, mapJobId: null, modeChosen: false,
    activeMaps: new Map(), pendingMaps: new Set() };
  const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
  const number = (input) => input.value.trim() === '' ? null : Number(input.value);
  const traitLabel = (raw) => raw.replace(/^x\d+\s+/, '').replace(/^(?:\[[^\]]+\]\s*)+/, '').split('||')[0].trim();

  function controls() {
    return { environment: el.environment.value, view: el.view.value, width: number(el.width), height: number(el.height),
      count: number(el.count), seed: number(el.seed), notes: el.notes.value };
  }
  function setBusy(busy) {
    state.busy = busy;
    for (const input of get('bg-dynamic').querySelectorAll('button, input, select, textarea')) input.disabled = busy || !state.available;
    if (!busy) {
      drawTraits();
      el.animate.disabled = el.view.value === 'topdown';
      el.render.disabled = !state.available;
    }
  }
  function mode() {
    const dynamic = get('bg-mode').value === 'dynamic';
    get('bg-dynamic').hidden = !dynamic;
    get('bg-bespoke').hidden = dynamic;
  }
  function drawTraits() {
    el.traits.replaceChildren();
    for (const table of state.catalogue?.tables || []) {
      if (el.view.value === 'topdown' && ['Sky', 'Distant features', 'Motion'].includes(table.name)) continue;
      const values = relevantValues(table, el.environment.value);
      if (!values.length) continue;
      const row = document.createElement('div'); row.className = 'bg-trait-row';
      const label = document.createElement('label'); label.className = 'bg-trait-value';
      const name = document.createElement('span'); name.textContent = table.name; label.append(name);
      const select = document.createElement('select'); select.setAttribute('aria-label', table.name);
      select.disabled = state.busy || !state.available;
      const choice = state.plan?.traits?.[table.name];
      const placeholder = document.createElement('option'); placeholder.value = '__random__'; placeholder.textContent = 'Random';
      select.append(placeholder);
      if (!/location/i.test(table.name)) {
        const omit = document.createElement('option'); omit.value = ''; omit.textContent = 'Omit'; select.append(omit);
      }
      for (const value of values) {
        const option = document.createElement('option'); option.value = value.text;
        option.textContent = traitLabel(value.text); option.title = option.textContent;
        select.append(option);
      }
      // An edited/disabled pool value remains visible until deliberately changed.
      if (choice && !values.some((v) => v.text === choice)) {
        const previous = document.createElement('option'); previous.value = choice;
        previous.textContent = `Saved: ${traitLabel(choice)}`; select.append(previous);
      }
      select.value = choice === undefined ? '__random__' : choice;
      select.addEventListener('change', () => {
        state.plan ||= { traits: {} };
        state.plan.traits = changeTrait(state.plan, table.name, select.value === '__random__' ? undefined : select.value, [...state.locked]);
        if (select.value === '__random__') state.locked.delete(table.name);
        el.status.textContent = 'Trait changed; unlocked related traits will reroll. Update preview to see the resulting prompt.';
        drawTraits();
      });
      label.append(select); row.append(label);
      const lockLabel = document.createElement('label'); lockLabel.className = 'bg-trait-lock';
      const lock = document.createElement('input'); lock.type = 'checkbox'; lock.checked = state.locked.has(table.name);
      lock.disabled = state.busy || !state.available || choice === undefined;
      lock.addEventListener('change', () => { if (lock.checked) state.locked.add(table.name); else state.locked.delete(table.name); });
      lockLabel.append(lock, document.createTextNode('Lock')); row.append(lockLabel);
      const roll = document.createElement('button'); roll.type = 'button'; roll.textContent = 'Re-roll';
      roll.disabled = state.busy || !state.available || lock.checked; roll.title = `Re-roll ${table.name}`;
      lock.addEventListener('change', () => { roll.disabled = lock.checked; });
      roll.addEventListener('click', () => preview({ only: table.name, newSeed: true })); row.append(roll);
      el.traits.append(row);
    }
  }
  async function refreshPools() {
    if (state.loading) return state.loading;
    state.loading = api('/api/backgrounds/dynamic/catalogue').then((data) => {
      state.catalogue = data; drawTraits();
    }).catch((err) => { el.status.textContent = err.message; }).finally(() => { state.loading = null; });
    return state.loading;
  }
  function showPlan(plan) {
    state.plan = plan; el.seed.value = plan.seed;
    el.preview.textContent = plan.prompt;
    drawTraits();
  }
  async function preview(options = {}) {
    if (state.busy || !state.available) return;
    setBusy(true); el.status.textContent = 'Rolling scene…';
    try {
      const values = controls(); if (options.newSeed) values.seed = randomSeed();
      const result = await post('/api/backgrounds/dynamic/preview', sceneRequest(state.plan, values, [...state.locked], options));
      showPlan(result.plans[0]); el.status.textContent = 'Preview ready. No image has been rendered yet.';
    } catch (err) { el.status.textContent = err.message; }
    finally { setBusy(false); }
  }
  async function render() {
    if (state.busy || !state.available) return;
    setBusy(true); el.status.textContent = 'Preparing scenes…'; el.log.hidden = true;
    try {
      // Preview first so the seed and first scene shown are exactly what gets sent.
      const request = sceneRequest(state.plan, controls(), [...state.locked]);
      const result = await post('/api/backgrounds/dynamic/preview', request);
      showPlan(result.plans[0]); setBusy(true);
      const body = sceneRequest(state.plan, controls(), [...state.locked], { render: true });
      body.animateWhenDone = el.animate.checked && el.view.value !== 'topdown'; body.pingpong = el.pingpong.checked;
      const run = await post('/api/backgrounds/dynamic/render', body);
      pollBackgroundJob(run.jobId, { statusEl: el.status, logEl: el.log, button: el.render,
        running: 'Rendering scenes… ComfyUI must be running.',
        onDone: async (job) => {
          setBusy(false);
          el.status.textContent = job.status === 'error' ? `${job.error} (${job.produced || 0} images saved)`
            : `Rendered ${job.produced} scene(s).${job.chain?.length ? ` ${job.chain.length} animation(s) started.` : ''}${job.chainError ? ` ${job.chainError}` : ''}`;
          if (job.producedIds?.length) announceBatchComplete(job.produced, job.producedIds, 'background');
          await loadBackgrounds(); watchBackgroundGalleryUntilSettled();
        },
        onStop: () => setBusy(false),
      });
    } catch (err) { setBusy(false); el.status.textContent = err.message; }
  }
  function showMaps(item) {
    map.results.replaceChildren();
    for (const output of item.battlemaps || []) {
      const link = document.createElement('a'); link.href = output.url; link.target = '_blank'; link.rel = 'noopener';
      link.textContent = `${output.stale ? 'Previous source version — ' : ''}Open battlemap${output.width ? ` (${output.width} × ${output.height})` : ''}`;
      const thumb = document.createElement('img'); thumb.src = output.url; thumb.alt = 'Orthographic battlemap'; thumb.loading = 'lazy';
      link.prepend(thumb); map.results.append(link);
    }
  }
  function watchMap(jobId, rel) {
    if (state.mapTimer) clearInterval(state.mapTimer);
    state.mapJobId = jobId; map.btn.disabled = true;
    state.mapTimer = pollBackgroundJob(jobId, { statusEl: map.status, logEl: map.log, button: map.btn,
      running: 'Creating a top-down map from this background…',
      isCurrent: () => state.mapJobId === jobId && state.selection?.rel === rel,
      onDone: async (job) => {
        if (state.mapJobId !== jobId || state.selection?.rel !== rel) return;
        state.mapTimer = null; state.mapJobId = null;
        state.activeMaps.delete(rel);
        map.status.textContent = job.status === 'error' ? job.error : `Created ${job.produced} battlemap(s).`;
        await loadBackgrounds();
      },
    });
  }
  async function createMap() {
    const item = state.selection;
    if (!item || map.btn.disabled) return;
    state.pendingMaps.add(item.rel);
    map.btn.disabled = true; map.status.textContent = 'Starting battlemap…'; map.log.hidden = true;
    try {
      const run = await post('/api/backgrounds/battlemap', { rel: item.rel, width: number(map.width), height: number(map.height),
        seed: number(map.seed), notes: map.notes.value });
      state.activeMaps.set(item.rel, run.jobId);
      if (state.selection?.rel !== item.rel) return;
      watchMap(run.jobId, item.rel);
    } catch (err) {
      if (state.selection?.rel !== item.rel) return;
      map.btn.disabled = !state.available; map.status.textContent = err.message;
    } finally { state.pendingMaps.delete(item.rel); }
  }
  function onSelect(item) {
    if (state.mapTimer) clearInterval(state.mapTimer);
    state.mapTimer = null; state.mapJobId = null; state.selection = item;
    map.btn.disabled = !state.available; map.status.textContent = ''; map.log.hidden = true;
    map.notes.value = ''; map.seed.value = '';
    get('bg-load-scene').hidden = !item.scene?.traits;
    get('bg-saved-scene-info').textContent = item.scene?.seed !== undefined ? `Scene seed: ${item.scene.seed}` : '';
    showMaps(item);
    const jobId = state.activeMaps.get(item.rel) || (item.battlemapJob?.status === 'running' && item.battlemapJob.jobId);
    if (jobId) watchMap(jobId, item.rel);
    else if (state.pendingMaps.has(item.rel)) { map.btn.disabled = true; map.status.textContent = 'Starting battlemap…'; }
  }
  root.DynamicBackgrounds = {
    onSelect,
    onGallery(data) {
      state.available = !!data.dynamicAvailable;
      if (!state.modeChosen) get('bg-mode').value = state.available ? 'dynamic' : 'bespoke';
      get('bg-mode').querySelector('[value="dynamic"]').disabled = !state.available;
      mode();
      if (!state.busy) setBusy(false);
      if (state.available && !state.catalogue) refreshPools();
      if (state.selection) {
        const current = data.items?.find((item) => item.rel === state.selection.rel);
        if (current) { state.selection = current; showMaps(current); }
      }
    },
  };
  get('bg-mode').addEventListener('change', () => { state.modeChosen = true; mode(); });
  el.roll.addEventListener('click', () => preview({ reroll: true, newSeed: true }));
  el['preview-btn'].addEventListener('click', () => preview());
  el.refresh.addEventListener('click', refreshPools);
  el.render.addEventListener('click', render);
  el['lock-all'].addEventListener('click', () => { state.locked = new Set(Object.keys(state.plan?.traits || {})); drawTraits(); });
  el['unlock-all'].addEventListener('click', () => { state.locked.clear(); drawTraits(); });
  el.environment.addEventListener('change', () => {
    for (const name of Object.keys(state.plan?.traits || {})) {
      const table = state.catalogue?.tables.find((t) => t.name === name);
      if (!table || !relevantValues(table, el.environment.value).some((v) => v.text === state.plan.traits[name])) {
        delete state.plan.traits[name]; state.locked.delete(name);
      }
    }
    drawTraits(); el.status.textContent = 'Environment changed; incompatible traits and their locks were cleared. Update preview to roll this setting.';
  });
  el.view.addEventListener('change', () => {
    el.animate.disabled = el.view.value === 'topdown';
    if (el.view.value === 'topdown') { el.width.value = 1536; el.height.value = 1536; }
    drawTraits();
    el.status.textContent = 'View changed. Update preview to see the new composition.';
  });
  map.btn.addEventListener('click', createMap);
  get('bg-load-scene').addEventListener('click', async () => {
    if (state.busy || !state.selection?.scene?.traits) return;
    const plan = state.selection.scene;
    if (!state.catalogue) await refreshPools();
    for (const key of ['environment', 'view', 'width', 'height', 'seed', 'notes']) {
      if (plan[key] !== undefined) el[key].value = plan[key];
    }
    el.count.value = 1; state.locked = new Set(Object.keys(plan.traits));
    showPlan(JSON.parse(JSON.stringify(plan))); get('bg-mode').value = 'dynamic'; state.modeChosen = true; mode();
    el.status.textContent = 'Saved scene loaded with all traits locked. Unlock or change any trait to create variations.';
    get('bg-dynamic').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})(globalThis);
