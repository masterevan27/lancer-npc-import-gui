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
      if (create && authenticated) body.kind = kind;
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
  const selections = () => Object.fromEntries(['npc', 'spaceship', 'background'].map(kind =>
    [kind, document.querySelector(`[data-art-style="${kind}"]`)?.value || 'default']));
  const transport = createTransport(root.fetch.bind(root), expire, selections);
  const ready = root.fetch('/api/secret/session', { cache: 'no-store', credentials: 'same-origin' })
    .then(res => res.ok ? res.json() : { authenticated: false, configured: false })
    .then(session => { transport.setAuthenticated(session.authenticated); return session; })
    .catch(() => ({ authenticated: false, configured: false }));
  let galleryItems = [], galleryRequest = 0, lastFocus = 0;
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
    galleryItems = []; galleryRequest += 1;
    for (const id of ['secret-grid', 'secret-detail-images', 'secret-detail-prompts', 'secret-detail-traits']) get(id)?.replaceChildren();
    for (const id of ['secret-detail-name', 'secret-detail-style', 'secret-storage-path']) {
      const node = get(id); if (node) { node.textContent = ''; if ('value' in node) node.value = ''; }
    }
    for (const node of document.querySelectorAll('[data-art-style]')) {
      node.replaceChildren(new Option(DEFAULT.name, DEFAULT.id));
    }
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
    for (const item of items) {
      const card = document.createElement('div');
      card.className = `card${item.kind === 'spaceship' ? ' card--spaceship' : item.kind === 'background' ? ' card--background' : ''}`;
      card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', `View ${item.name}`);
      const img = document.createElement('img'); img.className = 'thumb'; img.loading = 'lazy';
      img.src = item.portraitUrl || item.tokenUrl || ''; img.alt = item.name; card.append(img);
      const body = document.createElement('div'); body.className = 'body';
      for (const [className, text] of [['name', item.name], ['sub', item.callsign], ['role', item.traits?.Role],
        ['sub', `Art style: ${item.artStyle?.name || 'Default'}`]]) {
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

  function openDetail(item) {
    get('secret-detail-name').textContent = item.name;
    get('secret-detail-style').textContent = `Art style: ${item.artStyle?.name || 'Default'}`;
    const images = get('secret-detail-images'); images.replaceChildren();
    for (const [label, url] of [['Portrait', item.portraitUrl], ['Token', item.tokenUrl]]) {
      if (!url) continue;
      const figure = document.createElement('figure'), img = document.createElement('img'), caption = document.createElement('figcaption');
      img.src = url; img.alt = `${item.name} — ${label}`; caption.textContent = label;
      img.addEventListener('click', () => img.classList.toggle('secret-image-expanded'));
      figure.append(img, caption); images.append(figure);
    }
    const traits = item.background?.scene?.traits || item.traits || {};
    get('secret-detail-traits').textContent = Object.entries(traits).map(([key, value]) => `${key}: ${value}`).join('\n');
    const prompts = item.prompts || { Portrait: item.portraitPrompt || item.background?.scene?.prompt, Token: item.tokenPrompt };
    get('secret-detail-prompts').textContent = typeof prompts === 'string' ? prompts :
      Object.entries(prompts).filter(([, value]) => value).map(([key, value]) => `${key}\n${value}`).join('\n\n');
    get('secret-detail-overlay').hidden = false;
    get('secret-detail-close').focus();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const session = await ready;
    get('leave-secret').hidden = !session.authenticated;
    get('secret-images').hidden = !session.authenticated;
    get('secret-storage').hidden = !session.authenticated;
    get('secret-open').hidden = !!session.authenticated;
    get('secret-mode-notice').hidden = !session.authenticated;
    document.body.classList.toggle('secret-mode', !!session.authenticated);
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
    get('secret-detail-close').addEventListener('click', () => { get('secret-detail-overlay').hidden = true; });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      get('secret-detail-overlay').hidden = true; get('secret-login-overlay').hidden = true; get('secret-password').value = '';
    });
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
    if (session.authenticated) openGallery();
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
