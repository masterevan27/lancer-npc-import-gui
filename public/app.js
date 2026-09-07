/* Import GUI - vanilla JS, no build step. See server.js for the API this talks to. */

const CATEGORY_LABELS = { npc: 'NPCs', mech: 'Mechs', spaceship: 'Spaceships' };

// Synthetic filter/trait key for the category folder generate-npc.py sorts each
// NPC into (server.js derives it from the folder path; it isn't a real trait).
const ROLE_CATEGORY_KEY = 'Role Category';
// Fields that are noise in a trait list - the character's own name split three ways.
const TRAIT_KEY_EXCLUDE = ['name', 'Given names', 'Family names'];

const state = {
  category: null,
  items: [],
  visibleItems: [],
  selected: new Set(),
  pollTimer: null,
  search: '',
  sort: 'when-desc',
  filters: [], // { key, value }
  detailItemId: null,     // item currently shown in the detail overlay, if any
  regenLastStatus: null,  // that item's regenStatus as of the last render, to catch done/error transitions
  // The trait-specific "Re-rolling Hair…" line, so renderRegenPanel's running
  // branch stops overwriting it with the generic one two seconds later.
  // Cleared by openDetail and whenever the job leaves 'running'.
  regenRunningMessage: null,
  // The item whose staged trait edit is in flight, so both trait gutters can be
  // shut for the second or so the generator takes. Not an edit list: the
  // manifest entry is the accumulator, and this page only ever re-renders what
  // the server sends back. See stageTraitEdit.
  stagingItemId: null,
  // Bumped by every startPolling() call, so a tick already in flight can tell
  // that someone asked for polling while it was awaiting - and refuse to clear
  // the timer over a list it fetched before that job existed. See startPolling.
  pollWanted: 0,
  // Ids marked seen during this page load. /api/seen is fire-and-forget and
  // the two-second poller replaces state.items wholesale, so without this a
  // poll landing between the click and the POST brings the New badge back for
  // one tick - see refreshItems.
  locallySeen: new Set(),
};

const el = {
  categories: document.getElementById('categories'),
  grid: document.getElementById('grid'),
  empty: document.getElementById('empty'),
  status: document.getElementById('status'),
  importBtn: document.getElementById('import-btn'),
  deleteBtn: document.getElementById('delete-btn'),
  selectAll: document.getElementById('select-all'),
  filterSearch: document.getElementById('filter-search'),
  sortSelect: document.getElementById('sort-select'),
  filterRows: document.getElementById('filter-rows'),
  addFilterBtn: document.getElementById('add-filter'),
  overlay: document.getElementById('detail-overlay'),
  detailClose: document.getElementById('detail-close'),
  detailPortrait: document.getElementById('detail-portrait'),
  detailToken: document.getElementById('detail-token'),
  detailName: document.getElementById('detail-name'),
  detailSub: document.getElementById('detail-sub'),
  detailGenerated: document.getElementById('detail-generated'),
  detailFiles: document.getElementById('detail-files'),
  detailFolderPath: document.getElementById('detail-folder-path'),
  detailFileNames: document.getElementById('detail-file-names'),
  detailTraits: document.getElementById('detail-traits'),
  detailPrompts: document.getElementById('detail-prompts'),
  detailPortraitPrompt: document.getElementById('detail-portrait-prompt'),
  detailTokenPrompt: document.getElementById('detail-token-prompt'),
  imageZoom: document.getElementById('image-zoom'),
  imageZoomImg: document.getElementById('image-zoom-img'),
  regenPanel: document.getElementById('regen-panel'),
  regenSeedInput: document.getElementById('regen-seed-input'),
  regenCurrentSeed: document.getElementById('regen-current-seed'),
  regenBtn: document.getElementById('regen-btn'),
  regenStatus: document.getElementById('regen-status'),
  regenStale: document.getElementById('regen-stale'),
  model3dPanel: document.getElementById('model3d-panel'),
  model3dRig: document.getElementById('model3d-rig'),
  model3dOverwrite: document.getElementById('model3d-overwrite'),
  model3dBuilt: document.getElementById('model3d-built'),
  model3dBtn: document.getElementById('model3d-btn'),
  model3dStatus: document.getElementById('model3d-status'),
  model3dTurnarounds: document.getElementById('model3d-turnarounds'),
  model3dFiles: document.getElementById('model3d-files'),
  detailDeleteBtn: document.getElementById('detail-delete-btn'),
};

const elDeleteConfirm = {
  overlay: document.getElementById('delete-confirm-overlay'),
  message: document.getElementById('delete-confirm-message'),
  list: document.getElementById('delete-confirm-list'),
  cancel: document.getElementById('delete-confirm-cancel'),
  ok: document.getElementById('delete-confirm-ok'),
};

/** Shows the delete-confirmation modal for the given item names; resolves true/false. */
function confirmDelete(names) {
  return new Promise((resolve) => {
    elDeleteConfirm.message.textContent = names.length === 1
      ? `Permanently delete "${names[0]}"?`
      : `Permanently delete these ${names.length} items?`;
    elDeleteConfirm.list.innerHTML = names.length > 1
      ? names.map((n) => `<li>${escapeHtml(n)}</li>`).join('')
      : '';
    elDeleteConfirm.overlay.hidden = false;

    const cleanup = (result) => {
      elDeleteConfirm.overlay.hidden = true;
      elDeleteConfirm.ok.removeEventListener('click', onOk);
      elDeleteConfirm.cancel.removeEventListener('click', onCancel);
      elDeleteConfirm.overlay.removeEventListener('click', onBackdrop);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === elDeleteConfirm.overlay) cleanup(false); };

    elDeleteConfirm.ok.addEventListener('click', onOk);
    elDeleteConfirm.cancel.addEventListener('click', onCancel);
    elDeleteConfirm.overlay.addEventListener('click', onBackdrop);
  });
}

const elRerollConfirm = {
  overlay: document.getElementById('reroll-confirm-overlay'),
  message: document.getElementById('reroll-confirm-message'),
  cancel: document.getElementById('reroll-confirm-cancel'),
  ok: document.getElementById('reroll-confirm-ok'),
};

const elSetTrait = {
  overlay: document.getElementById('set-trait-overlay'),
  title: document.getElementById('set-trait-title'),
  filter: document.getElementById('set-trait-filter'),
  list: document.getElementById('set-trait-list'),
  releaseRow: document.getElementById('set-trait-release-row'),
  release: document.getElementById('set-trait-release'),
  releaseLabel: document.getElementById('set-trait-release-label'),
  cancel: document.getElementById('set-trait-cancel'),
  ok: document.getElementById('set-trait-ok'),
};

/**
 * The re-rollable list that applies to one NPC.
 *
 * Two lists, chosen per item rather than per server, because generate-npc.py
 * chooses that way: an entry that recorded its raw bullets re-rolls nearly
 * everything, one written before it did re-rolls the eleven traits nothing
 * else gates. Kept as a function of its own so the choice is testable without
 * a DOM, and so openDetail() and anything that follows it cannot drift apart
 * on which list they meant.
 */
function rerollableForItem(item) {
  return item.hasRawTraits ? createState.rawRerollableTraits : createState.rerollableTraits;
}

/**
 * `trait` plus every trait a re-roll of it also frees, transitively, in the
 * order the generator draws them.
 *
 * The mirror of generate-npc.py's trait_cascade(), walked over the edge map the
 * server parses out of that same file (see createState.traitDependents).
 * Transitive because the invalidation is: a new Role redraws the Outfit, the
 * new Outfit redraws Headgear, Weapon and Gear, and the new Weapon and Gear
 * redraw the Stance. A trait nothing depends on closes to itself alone, which
 * is the answer for all eleven of the one-click traits and for Faction, Weather
 * and Stance besides.
 *
 * A worklist rather than a recursion, for the reason the generator's own
 * docstring gives: that map is not promised to be acyclic. It held an Age/Build
 * cycle until recently and Build's half was dropped for a reason about button
 * behaviour rather than about graph shape, so the next filter audited in both
 * directions will put one back. Nothing is enqueued twice, so a cycle ends the
 * walk instead of the tab.
 *
 * Ordered by the override table list - REQUIRED_TABLES minus Pronouns - so a
 * cascade reads the same way here as in the CLI's report. The fallback to
 * discovery order is load-bearing rather than tidy: that list is empty until
 * /api/npc-tables lands, and filtering by an empty list would drop the very
 * trait the user clicked and make a cascade look like a lone re-roll.
 */
function traitCascade(trait) {
  const dependents = createState.traitDependents || {};
  const freed = [trait];
  for (let i = 0; i < freed.length; i += 1) {
    for (const next of dependents[freed[i]] || []) {
      if (!freed.includes(next)) freed.push(next);
    }
  }
  const ordered = (createState.overrideTables || []).filter((name) => freed.includes(name));
  return ordered.includes(trait) ? ordered : freed;
}

/**
 * Whether re-rolling `trait` can change more of the NPC than `trait` itself.
 *
 * The generator does not free the named trait alone. Its TRAIT_DEPENDENTS map
 * frees every trait a filter would have had to re-check - a new Role redraws
 * the Faction, Outfit and Weapon, the new Outfit redraws the Headgear and
 * Gear, and a new Theme takes eleven others with it, the whole visible
 * character - because a trait pinned across a change it contradicts is never
 * re-checked and lands wrong. That is right, and it is also a much larger
 * change than "Re-roll" on one row of a table looks like it is buying.
 *
 * The question goes to that map (traitDependentsFrom in lib/overrideTables.js)
 * rather than to either re-rollable list, because the lists answer a different
 * one. They say which traits this entry can re-roll at all; the map says which
 * traits a re-roll drags along with it, and that is a property of the
 * generator's filters rather than of the entry in front of the user. Asked of
 * the lists, Faction, Weather and Stance are outside the legacy eleven and are
 * not keys in the map, so a click on Weather would open a dialog announcing a
 * cascade that does not exist and then be unable to name a single trait it
 * carries. Asked of the map, a trait that closes to itself fires on one click
 * whichever list its button came from, and one that does not gets a dialog
 * naming what goes with it.
 *
 * The fallback for an unreadable map is the global legacy list, and it is
 * deliberately NOT the per-item list rerollableForItem() hands the buttons:
 * this is the one question in the re-roll code that is not per NPC. Blind, the
 * eleven are the largest set of traits still known to free nothing - the
 * cascade spec's §5 promises they keep firing on one click, and generate-npc.py
 * holds itself to that with a test derived from REROLLABLE_TRAITS, written
 * because this page draws its one-click buttons from that constant. The wide
 * list an entry with raw bullets is offered promises nothing of the kind, being
 * every trait but the two halves of the name and Pronouns, so falling back on
 * it would answer false for every button on the sheet and take the dialog off
 * Theme, Role, Outfit and Age along with Faction and Weather. Over-warning on
 * Weather costs a click; firing Theme unannounced costs a dozen traits and a
 * re-render nobody asked for. The coarse list is the right way to be wrong
 * here, and it is only reached once the parse has already failed.
 */
function rerollNeedsConfirm(trait) {
  if (!Object.keys(createState.traitDependents || {}).length) {
    return !createState.rerollableTraits.includes(trait);
  }
  return traitCascade(trait).length > 1;
}

/** Shows the cascade warning before a re-roll of `trait`; resolves true/false. */
function confirmReroll(trait) {
  return new Promise((resolve) => {
    // Named, not gestured at. "More than one trait" is not something a user can
    // weigh, and one stock sentence about the outfit, weapon, hair and the whole
    // scene would be Theme's cascade printed over every other trait's - wrong
    // for most of them, and for the one it fits, not something the user can
    // check against the sheet in front of them. The list is in the generator's
    // draw order, so it reads down the detail sheet's rows.
    //
    // The empty branch is the unreadable-map case rerollNeedsConfirm() falls
    // back on. It has to say that it cannot name them rather than name none:
    // this dialog exists to let the user decline, and a warning that quietly
    // knows nothing is worse than one that says so.
    const alsoFreed = traitCascade(trait).filter((name) => name !== trait);
    elRerollConfirm.message.textContent = alsoFreed.length
      ? `Re-rolling ${trait} frees the traits it gates as well, so `
        + `${alsoFreed.length} other ${alsoFreed.length === 1 ? 'trait' : 'traits'} `
        + `can change with it: ${alsoFreed.join(', ')}.`
      : `Re-rolling ${trait} can change more than ${trait}, but this page could not read `
        + "the generator's dependency map and cannot say which traits go with it.";
    elRerollConfirm.ok.textContent = `Re-roll ${trait}`;
    elRerollConfirm.overlay.hidden = false;
    // Cancel is the default: focus starts there so a stray Enter or Space
    // backs out rather than committing to minutes of rendering.
    elRerollConfirm.cancel.focus();

    const cleanup = (result) => {
      elRerollConfirm.overlay.hidden = true;
      elRerollConfirm.ok.removeEventListener('click', onOk);
      elRerollConfirm.cancel.removeEventListener('click', onCancel);
      elRerollConfirm.overlay.removeEventListener('click', onBackdrop);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === elRerollConfirm.overlay) cleanup(false); };

    elRerollConfirm.ok.addEventListener('click', onOk);
    elRerollConfirm.cancel.addEventListener('click', onCancel);
    elRerollConfirm.overlay.addEventListener('click', onBackdrop);
  });
}

/**
 * The Set… dialog: pick a value for one trait, then regenerate from it.
 *
 * Resolves to { value, release } once "Set and regen" is pressed, or null if
 * the user backs out. The caller does the POST, so this function stays about
 * the choice and nothing else.
 *
 * Opens immediately and fills in when the answer arrives, rather than blocking
 * the click: the query spawns a Python interpreter, which is fast but not
 * instant, and a button that does nothing for a moment reads as broken.
 *
 * A failed query shows what the generator said and leaves the dialog unusable
 * on purpose. There is deliberately no fallback to "show every bullet": a
 * picker that quietly stopped filtering would look exactly like a working one,
 * which is the failure this whole feature is built to avoid.
 */
function openSetTrait(item, trait) {
  return new Promise((resolve) => {
    let choices = [];
    let selected = null;

    elSetTrait.title.textContent = `Set ${trait}`;
    elSetTrait.filter.value = '';
    elSetTrait.filter.hidden = true;
    elSetTrait.list.textContent = 'Working out which values this NPC can take…';
    elSetTrait.releaseRow.hidden = true;
    elSetTrait.release.checked = false;
    elSetTrait.ok.disabled = true;
    elSetTrait.overlay.hidden = false;
    elSetTrait.cancel.focus();

    const cleanup = (result) => {
      elSetTrait.overlay.hidden = true;
      elSetTrait.ok.removeEventListener('click', onOk);
      elSetTrait.cancel.removeEventListener('click', onCancel);
      elSetTrait.overlay.removeEventListener('click', onBackdrop);
      elSetTrait.filter.removeEventListener('input', render);
      elSetTrait.list.removeEventListener('change', onPick);
      resolve(result);
    };
    const onOk = () => {
      if (!selected) return;
      // Only what the user ticked. The server re-derives the rest, and the
      // generator expands each name to its cascade.
      const release = elSetTrait.release.checked ? selected.conflicts.slice() : [];
      cleanup({ value: selected.value, release });
    };
    const onCancel = () => cleanup(null);
    const onBackdrop = (e) => { if (e.target === elSetTrait.overlay) cleanup(null); };

    function onPick(e) {
      const picked = choices.find((c) => c.value === e.target.value);
      if (!picked) return;
      selected = picked;
      const label = releaseLabel(picked);
      // Absent rather than disabled for a value it cannot help: a ruled-out
      // value is ruled out by a gate above it, and no release fixes that.
      elSetTrait.releaseRow.hidden = !label;
      elSetTrait.releaseLabel.textContent = label || '';
      if (!label) elSetTrait.release.checked = false;
      elSetTrait.ok.disabled = false;
    }

    function render() {
      const needle = elSetTrait.filter.value.trim().toLowerCase();
      const visible = needle
        ? choices.filter((c) => c.label.toLowerCase().includes(needle))
        : choices;
      if (!visible.length) {
        elSetTrait.list.textContent = 'Nothing matches that.';
        return;
      }
      // Groups whose rows all filtered away drop out with them, so a heading
      // never sits over an empty space.
      elSetTrait.list.innerHTML = groupChoices(visible).map((group) => {
        const rows = group.rows.map((choice) => {
          const checked = selected
            ? choice.value === selected.value
            : choice.current;
          // Each note names the trait AND its current value: "conflicts with
          // Headgear" is not actionable without knowing what the Headgear is.
          const notes = choice.conflicts.map((name) => {
            const now = (item.traits || {})[name];
            return now
              ? `${escapeHtml(name)} would clash — currently “${escapeHtml(now)}”`
              : `${escapeHtml(name)} would clash`;
          }).join('<br>');
          // The ruled-out note claims no cause. The generator reports whether
          // a bullet was in the pool, not which filter emptied it, and naming
          // a culprit here would be inventing one.
          const note = group.key === 'ruledOut'
            ? "the roller would not have offered this one"
            : notes;
          return `<label class="set-trait-row${group.key === 'clean' ? '' : ' set-trait-row-greyed'}">`
            + `<input type="radio" name="set-trait-value" value="${escapeHtml(choice.value)}"`
            + `${checked ? ' checked' : ''}>`
            + `<span class="set-trait-label">${escapeHtml(choice.label)}`
            + `${choice.current ? ' <em>(current)</em>' : ''}</span>`
            + (note ? `<span class="set-trait-note">${note}</span>` : '')
            + '</label>';
        }).join('');
        const heading = group.heading
          ? `<h3 class="set-trait-heading">${escapeHtml(group.heading)}</h3>`
          : '';
        return heading + rows;
      }).join('');
    }

    elSetTrait.ok.addEventListener('click', onOk);
    elSetTrait.cancel.addEventListener('click', onCancel);
    elSetTrait.overlay.addEventListener('click', onBackdrop);
    elSetTrait.filter.addEventListener('input', render);
    elSetTrait.list.addEventListener('change', onPick);

    api(`/api/trait-choices?id=${encodeURIComponent(item.id)}&trait=${encodeURIComponent(trait)}`)
      .then((data) => {
        choices = data.choices || [];
        selected = choices.find((c) => c.current) || null;
        elSetTrait.filter.hidden = choices.length < 12;
        render();
        // The current value is always allowed and conflict-free - the
        // generator makes that a tested invariant - so the button starts live
        // and pressing it immediately is a no-op re-render rather than an
        // error.
        elSetTrait.ok.disabled = !selected;
      })
      .catch((err) => {
        elSetTrait.list.textContent = `Could not list the values: ${err.message}`;
        elSetTrait.ok.disabled = true;
      });
  });
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    // The server's own sentence where there is one - these refusals name a
    // cure ("Re-roll the NPC to record them") that "HTTP 400" does not.
    const said = await res.json().catch(() => null);
    throw new Error(said && said.error ? said.error : `${path}: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Tell the server these items have been looked at, so their New tag stops
 * coming back, and remember it here as well so the next poll doesn't undo it
 * before the POST lands (see state.locallySeen).
 *
 * Fire-and-forget on purpose. The caller is openDetail, where awaiting a
 * round-trip would make the overlay open slower than it does today for the
 * sake of a cosmetic flag, and where a rejected promise would abort building
 * the detail sheet halfway. A New tag that outlives a failed POST is a much
 * smaller problem than either.
 */
function markSeen(ids) {
  for (const id of ids) state.locallySeen.add(id);
  api('/api/seen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  }).catch(() => { /* the tag just survives until the item is opened again */ });
}

/**
 * The bulk version, for dismissing the batch banner - see dismissBatchBanner.
 *
 * It takes the ids of the run the banner is announcing, and this is the whole
 * point of it. The obvious alternative, posting `{ all: true }`, is one the
 * server reads as every id in the manifest across every kind. The seen store
 * is seeded once ever and never again, so that NPCs rolled at the command line
 * while this server was down are still flagged New on the next boot - which
 * means a library can perfectly well be holding six unlooked-at tags at the
 * moment a single GUI run finishes. The banner says "1 new NPC finished
 * generating" and offers its × as the only way to be rid of itself; clearing
 * seven tags on the strength of that would have no undo, and nothing anywhere
 * in this UI can put a tag back.
 *
 * So the banner clears its own run and nothing else. The reload afterwards is
 * there because when the grid is what's on screen, those tags should go now
 * rather than whenever the next poll or category switch comes along.
 */
function markBatchSeen(ids) {
  if (!ids.length) return;
  for (const id of ids) state.locallySeen.add(id);
  api('/api/seen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
    .then(() => (tabState.current === 'import' ? refreshItems() : null))
    .catch(() => { /* same as markSeen: a lingering tag is not worth an error */ });
}

async function loadCategories() {
  const { categories } = await api('/api/categories');
  el.categories.innerHTML = '';
  if (!categories.length) {
    el.categories.textContent = 'No generated content found yet.';
    return;
  }
  for (const cat of categories) {
    const btn = document.createElement('button');
    btn.textContent = `${CATEGORY_LABELS[cat.id] || cat.id} (${cat.count})`;
    btn.addEventListener('click', () => selectCategory(cat.id));
    btn.dataset.id = cat.id;
    el.categories.appendChild(btn);
  }
  selectCategory(categories[0].id);
}

async function selectCategory(id) {
  state.category = id;
  state.selected.clear();
  state.search = '';
  state.filters = [];
  el.filterSearch.value = '';
  for (const btn of el.categories.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.id === id);
  }
  await refreshItems();
}

async function refreshItems() {
  if (!state.category) return;
  const { items } = await api(`/api/items?category=${encodeURIComponent(state.category)}`);
  state.items = items;
  // Re-apply what this page already knows about newness. The server is still
  // reporting isNew for anything whose /api/seen POST hasn't committed yet,
  // and during a generate or regen run the poller re-reads this list every two
  // seconds, so without this the New badge blinks back on the card the user
  // just opened - which reads as a rendering bug rather than the race it is.
  for (const item of items) {
    if (state.locallySeen.has(item.id)) item.isNew = false;
  }
  // Only drop selections for items that vanished entirely (e.g. deleted) -
  // an imported item stays selectable since selection also drives Delete Selected.
  for (const id of [...state.selected]) {
    if (!items.some((i) => i.id === id)) state.selected.delete(id);
  }
  // Every list load, not every poll tick. The poller is what makes a regen
  // finish observable at all, but it stops itself the moment nothing in the
  // *selected category* is still pending - so a regen left running while the
  // user wanders over to Mechs takes the poller down with it, and a scan hung
  // off the tick would lose that finish for good. Here, coming back to NPCs
  // reloads the list and the transition is picked up then. See regenSeen.
  //
  // Ahead of render() so the banner and the grid describe the same list: the
  // announcement and the card whose art it just replaced appear in one frame.
  detectRegenFinished(state.items);
  renderFilterRows();
  render();
}

/* ---- filtering ---- */

/** The value a trait-or-synthetic filter key resolves to for one item. */
function fieldValue(item, key) {
  if (key === ROLE_CATEGORY_KEY) return item.roleCategory || '';
  return item.traits?.[key] || '';
}

/** Every filterable key present across the current category's items, sorted. */
function collectTraitKeys(items) {
  const keys = new Set();
  for (const item of items) {
    for (const key of Object.keys(item.traits || {})) {
      if (!TRAIT_KEY_EXCLUDE.includes(key)) keys.add(key);
    }
    if (item.roleCategory) keys.add(ROLE_CATEGORY_KEY);
  }
  return [...keys].sort();
}

/** Distinct values seen for one key, for the filter row's searchable dropdown. */
function collectDistinctValues(items, key) {
  const values = new Set();
  for (const item of items) {
    const v = fieldValue(item, key);
    if (v) values.add(v);
  }
  return [...values].sort();
}

function itemMatchesFilters(item) {
  const search = state.search.trim().toLowerCase();
  if (search) {
    const haystack = [item.name, item.callsign, item.roleCategory, ...Object.values(item.traits || {})]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  for (const filter of state.filters) {
    if (!filter.key || !filter.value.trim()) continue;
    const value = fieldValue(item, filter.key).toLowerCase();
    if (!value.includes(filter.value.trim().toLowerCase())) return false;
  }
  return true;
}

/** Comparators for the "Sort by" dropdown - `when` sorts lexicographically fine
 * since generate-npc.py writes it as "YYYY-MM-DD HH:MM:SS". */
const SORTERS = {
  'name-asc': (a, b) => a.name.localeCompare(b.name),
  'name-desc': (a, b) => b.name.localeCompare(a.name),
  'when-desc': (a, b) => (b.when || '').localeCompare(a.when || ''),
  'when-asc': (a, b) => (a.when || '').localeCompare(b.when || ''),
  'role-category': (a, b) =>
    (a.roleCategory || '').localeCompare(b.roleCategory || '') || a.name.localeCompare(b.name),
};

function sortItems(items) {
  const cmp = SORTERS[state.sort] || SORTERS['name-asc'];
  return [...items].sort(cmp);
}

function renderFilterRows() {
  const keys = collectTraitKeys(state.items);
  el.filterRows.innerHTML = '';

  state.filters.forEach((filter, index) => {
    if (!filter.key) filter.key = keys[0] || '';

    const row = document.createElement('div');
    row.className = 'filter-row';

    const keySelect = document.createElement('select');
    keySelect.className = 'filter-key';
    for (const key of keys) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      opt.selected = key === filter.key;
      keySelect.appendChild(opt);
    }
    keySelect.addEventListener('change', () => {
      filter.key = keySelect.value;
      filter.value = '';
      renderFilterRows();
      render();
    });
    row.appendChild(keySelect);

    const datalistId = `filter-values-${index}`;
    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'filter-value';
    valueInput.placeholder = 'value contains…';
    valueInput.value = filter.value;
    valueInput.setAttribute('list', datalistId);
    valueInput.addEventListener('input', () => {
      filter.value = valueInput.value;
      render();
    });
    row.appendChild(valueInput);

    const datalist = document.createElement('datalist');
    datalist.id = datalistId;
    for (const value of collectDistinctValues(state.items, filter.key)) {
      const opt = document.createElement('option');
      opt.value = value;
      datalist.appendChild(opt);
    }
    row.appendChild(datalist);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'filter-remove';
    remove.textContent = '×';
    remove.title = 'Remove filter';
    remove.addEventListener('click', () => {
      state.filters.splice(index, 1);
      renderFilterRows();
      render();
    });
    row.appendChild(remove);

    el.filterRows.appendChild(row);
  });

  el.addFilterBtn.disabled = keys.length === 0;
}

function render() {
  el.grid.innerHTML = '';
  state.visibleItems = sortItems(state.items.filter(itemMatchesFilters));
  el.empty.textContent = state.items.length && !state.visibleItems.length
    ? 'No items match the current filters.'
    : 'Nothing here yet — run generate-npc.py, then reload.';
  el.empty.hidden = state.visibleItems.length > 0;

  for (const item of state.visibleItems) {
    const card = document.createElement('div');
    card.className = 'card'
      + (item.imported ? ' imported' : '')
      + (item.isNew && !item.imported ? ' is-new' : '');

    const img = document.createElement('img');
    img.src = item.portraitUrl || item.tokenUrl || '';
    img.alt = item.name;
    card.appendChild(img);

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'check';
    check.checked = state.selected.has(item.id);
    // Selection also drives Delete Selected, which makes sense for imported
    // and non-importable (missing-files) entries too - only Import Selected
    // itself skips those (server-side, with a reason shown in the status line).
    check.title = !item.importable ? 'Source images missing on disk' : '';
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => {
      if (check.checked) state.selected.add(item.id);
      else state.selected.delete(item.id);
      updateToolbar();
    });
    card.appendChild(check);

    if (item.imported) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Imported';
      card.appendChild(badge);
    } else if (item.jobStatus === 'sent' || item.jobStatus === 'queued') {
      const badge = document.createElement('span');
      badge.className = 'badge pending';
      badge.textContent = 'Importing…';
      card.appendChild(badge);
    } else if (item.jobStatus === 'error') {
      const badge = document.createElement('span');
      badge.className = 'badge error';
      badge.textContent = 'Failed';
      badge.title = item.jobError || '';
      card.appendChild(badge);
    } else if (item.regenStatus === 'running') {
      const badge = document.createElement('span');
      badge.className = 'badge pending';
      badge.textContent = 'Regenerating…';
      card.appendChild(badge);
    } else if (item.regenStatus === 'error') {
      const badge = document.createElement('span');
      badge.className = 'badge error';
      badge.textContent = 'Regen failed';
      badge.title = item.regenError || '';
      card.appendChild(badge);
    } else if (item.artStale) {
      // Below the two regen arms and above the 3D ones, deliberately. A live or
      // failed render outranks this - it is about to settle the question - but a
      // 3D build does not, because a portrait that no longer matches the traits
      // is the more actionable of the two facts.
      const badge = document.createElement('span');
      badge.className = 'badge stale';
      badge.textContent = 'Art out of date';
      badge.title = 'Traits were edited after this art was made — open it and press Regenerate';
      card.appendChild(badge);
    } else if (item.model3dStatus === 'running') {
      const badge = document.createElement('span');
      badge.className = 'badge pending';
      badge.textContent = 'Building 3D…';
      card.appendChild(badge);
    } else if (item.model3dStatus === 'error') {
      const badge = document.createElement('span');
      badge.className = 'badge error';
      badge.textContent = '3D failed';
      badge.title = item.model3dError || '';
      card.appendChild(badge);
    }

    // A second badge, deliberately outside the chain above rather than another
    // arm of it. "New" and "Regenerating…" are independent facts and a
    // freshly-rolled NPC being re-rendered is both at once, so folding this
    // into the chain would show one and silently drop the other. Suppressed on
    // an imported card: that card is already dimmed to 55% and a bright pill on
    // it reads as a glitch, and importing marks the NPC seen server-side
    // anyway, so the flag is on its way out regardless.
    if (item.isNew && !item.imported) {
      const tag = document.createElement('span');
      tag.className = 'badge new';
      tag.textContent = 'New';
      tag.title = 'Generated since you last looked — opening it clears this';
      card.appendChild(tag);
    }

    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = `<div class="name">${escapeHtml(item.name)}</div>
      <div class="sub">${escapeHtml(item.callsign || '')}</div>
      ${item.traits?.Role ? `<div class="role">${escapeHtml(item.traits.Role)}</div>` : ''}
      ${item.roleCategory ? `<div class="role-category">${escapeHtml(item.roleCategory)}</div>` : ''}`;
    card.appendChild(body);

    card.addEventListener('click', () => openDetail(item));
    el.grid.appendChild(card);
  }

  updateToolbar();
}

function updateToolbar() {
  el.importBtn.textContent = `Import Selected (${state.selected.size})`;
  el.importBtn.disabled = state.selected.size === 0;
  el.deleteBtn.textContent = `Delete Selected (${state.selected.size})`;
  el.deleteBtn.disabled = state.selected.size === 0;
  const notImported = state.visibleItems.filter((i) => !i.imported && i.importable);
  el.selectAll.checked = notImported.length > 0 && notImported.every((i) => state.selected.has(i.id));
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

/** item.when is generate-npc.py's "%Y-%m-%d %H:%M:%S" local-time string - parse
 * it explicitly rather than via `new Date(str)`, whose handling of a
 * space-separated (non-ISO) timestamp isn't reliable across engines. */
function formatGeneratedWhen(when) {
  if (!when) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(when);
  if (!m) return `Generated ${when}`;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(date.getTime())) return `Generated ${when}`;
  return `Generated ${date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`;
}

// Faction bullets are `Name || visual signature || flags` - only the name
// belongs in the subtitle, the visual segment feeds the image prompt instead.
// Older manifest entries have no `||` at all, so pass those through unchanged.
function factionDisplayName(faction) {
  if (!faction) return faction;
  return faction.split('||')[0].trim();
}

/**
 * The two gutter cells for one trait row: a live Re-roll button, a disabled one
 * that says what would turn it on, or nothing at all - and beside it, in a cell
 * of its own, Set... where Re-roll is live.
 *
 * A cell each rather than both in one, and both cells always emitted even when
 * empty. A table column is one width for every row of it, so a gutter holding
 * two buttons could be squeezed to the width of one by whatever else on the
 * page wanted the room - and something always did: Backdrop and Stance run to a
 * couple of hundred characters, auto table layout narrowed the shared gutter to
 * its smallest line-broken width to fit them, and Re-roll ended up stacked over
 * Set... on every row in the table rather than only on the long ones. Two
 * cells that refuse to wrap (see td.reroll-cell/td.set-cell in style.css) have
 * a whole button as their narrowest possible width, so there is nothing left
 * for the layout to take. The empty cells are what keep the four columns
 * straight down rows that offer one control or none.
 *
 * `rerollable` is the list that applies to this NPC (see rerollableForItem),
 * and anything on it gets the button.
 *
 * The middle case is the one this function is really for. An entry written
 * before the generator recorded rawTraits stores its bullets with the flags
 * stripped, so eleven traits cannot be re-rolled from it - Theme among them,
 * and Theme is the re-roll the whole visual world of an NPC hangs off. Emitting
 * nothing there would be defensible if that were permanent, and it is not: one
 * full re-roll of the NPC records the bullets and turns every one of those
 * buttons on. Nine of this author's 165 NPCs have raw bullets, so an empty
 * gutter beside Theme is what essentially every detail sheet would show, with
 * nothing anywhere on the page to say the option exists or how to earn it - the
 * requirement reads as never shipped. The generator already says the cure out
 * loud in its own refusal ("Re-roll the NPC to record them"); this is that
 * sentence moved to where the user is actually looking.
 *
 * Everything else still gets an empty cell rather than an inert control, and
 * that rule is deliberately untouched: the two halves of the name and Pronouns
 * are refused however the entry was written, so a disabled button on those
 * would invite a click at a cure that does not exist.
 *
 * The explanation hangs on a wrapping span rather than on the button, because
 * browsers suppress pointer events - and with them the tooltip - on a disabled
 * control. A title on the button alone would be an explanation nobody could
 * read, which is the state this whole function exists to get out of.
 */
/**
 * The picker's choices sorted into the groups it draws, empty ones dropped.
 *
 * The generator reports two independent kinds of "not legal" and they are not
 * interchangeable, because only one of them has a remedy in this dialog.
 * `allowed: false` means the roller's own pool for this table excludes the
 * value given the traits ABOVE it - nothing the user ticks changes that, so
 * picking it is an override and nothing else. `conflicts` means the value is
 * legal in itself but would leave traits BELOW it holding bullets the roller
 * would no longer offer, which the checkbox can fix by re-rolling them.
 *
 * A value can carry both, and it goes in ruledOut alone. Putting it in
 * conflicting would draw a checkbox that cannot rescue it: releasing the
 * dependents does nothing about a gate upstream.
 *
 * Pure, so it can be tested. There is no DOM harness in this repo -
 * ui.setTraitPicker.test.js lifts and runs this exact source - so grouping
 * logic living inside the render callback would ship untested.
 */
function groupChoices(choices) {
  const clean = [];
  const conflicting = [];
  const ruledOut = [];
  for (const choice of choices || []) {
    if (!choice.allowed) ruledOut.push(choice);
    else if (choice.conflicts && choice.conflicts.length) conflicting.push(choice);
    else clean.push(choice);
  }
  return [
    // No heading on the first group: it is the default answer, and labelling
    // it would imply the other two are errors rather than choices the user is
    // allowed to make.
    { key: 'clean', heading: null, rows: clean },
    { key: 'conflicting', heading: 'Would leave other traits contradicting', rows: conflicting },
    { key: 'ruledOut', heading: "Ruled out by this NPC's other traits", rows: ruledOut },
  ].filter((group) => group.rows.length);
}

/**
 * The release checkbox's label for one choice, or null when there should be no
 * checkbox at all.
 *
 * Null for a clean value (nothing to release) and for a ruled-out one (there
 * is nothing a release could fix - see groupChoices above).
 *
 * The count matters more than it looks. Releasing a trait re-rolls its whole
 * cascade, because freeing Outfit while Headgear, Weapon and Gear stayed
 * pinned to bullets chosen for the outfit that is now gone would recreate the
 * contradiction one level down. So `releases` is routinely longer than
 * `conflicts`, and a label naming only the conflicts would promise that one
 * trait moves while four do. The generator computes `releases` precisely so
 * this can be said here without a copy of its cascade map.
 */
function releaseLabel(choice) {
  const conflicts = (choice && choice.conflicts) || [];
  if (!choice || !choice.allowed || !conflicts.length) return null;
  const named = conflicts.length <= 3
    ? conflicts.join(', ')
    : `${conflicts.length} conflicting traits`;
  const extra = ((choice.releases || []).length) - conflicts.length;
  if (extra <= 0) return `also re-roll ${named}`;
  const them = conflicts.length === 1 ? 'it' : 'them';
  return `also re-roll ${named} (and ${extra} trait${extra === 1 ? '' : 's'} that depend on ${them})`;
}

function traitControlCells(trait, rerollable) {
  const name = escapeHtml(trait);
  // Both cells go out of every branch, so the row always has four columns.
  const cells = (reroll, set) =>
    `<td class="reroll-cell">${reroll}</td><td class="set-cell">${set}</td>`;
  if (rerollable.includes(trait)) {
    return cells(
      `<button type="button" class="reroll-btn" data-trait="${name}"
             title="Re-roll ${name} and re-render this NPC">Re-roll</button>`,
      // Only in this branch. Where Re-roll is the explained-but-disabled
      // variant below, that explanation already covers both controls and names
      // the same cure, so a second disabled button would say it twice.
      `<button type="button" class="set-trait-btn" data-trait="${name}"
             title="Choose a value for ${name} and re-render this NPC">Set&hellip;</button>`);
  }
  if (createState.rawRerollableTraits.includes(trait)) {
    const why = `This NPC was generated before its raw trait bullets were recorded, so ${name} `
      + 'cannot be re-rolled on its own. Re-roll the whole NPC once to record them and this '
      + 'button turns on.';
    return cells(
      `<span class="reroll-unavailable" title="${why}">`
        + '<button type="button" class="reroll-btn" disabled>Re-roll</button></span>',
      '');
  }
  return cells('', '');
}

/**
 * The sheet's "Files" block: where this NPC's art actually sits on disk.
 *
 * The folder is shown exactly as the server reports it, with no trailing
 * separator added - it is what the Copy button lifts, and what gets pasted
 * into a file manager's address bar, so it should be the path the server
 * actually holds rather than a prettied version of it. The filenames beneath
 * are what say the line above is a directory.
 *
 * An entry with no folder recorded hides the block rather than showing an
 * empty one: manifests written by older generator runs exist, and a Files
 * heading over a blank line reads as a bug.
 */
function renderDetailFiles(item) {
  el.detailFiles.hidden = !item.folderPath;
  if (!item.folderPath) return;
  el.detailFolderPath.textContent = item.folderPath;
  // Both names on one line, since they are short and the folder above them is
  // not. A token is optional - a portrait-only NPC names just the portrait.
  el.detailFileNames.textContent = [item.portraitFile, item.tokenFile]
    .filter(Boolean)
    .join(' · ');
}

/** The sheet's name, subtitle, generated-on line and Files block. */
function renderDetailHeader(item) {
  el.detailName.textContent = item.name;
  el.detailSub.textContent = [item.roleCategory, item.traits?.Role, factionDisplayName(item.traits?.Faction)]
    .filter(Boolean)
    .join(' — ');
  el.detailGenerated.textContent = formatGeneratedWhen(item.when);
  renderDetailFiles(item);
}

/**
 * The trait table for one item.
 *
 * Extracted from openDetail so an edit repaints it in place. This was written
 * exactly once per overlay open, which is why a re-rolled trait's new value
 * never appeared on the NPC's own page even though /api/items had been sending
 * it for two seconds: the sheet simply never asked again.
 *
 * The button set is repainted with the values rather than left alone, because
 * it is computed from rerollableForItem() and a legacy entry gains rawTraits -
 * and with them a full set of live buttons - the first time it is re-rolled.
 *
 * Nothing here reads the DOM, so it is safe to call on every poll tick.
 */
function renderDetailTraits(item) {
  // A reroll button per trait the generator will re-roll on this NPC, which is
  // a per-NPC question rather than a global one. The server sends both of
  // generate-npc.py's lists and each item says which applies: an entry that
  // recorded its raw bullets re-rolls everything but the two halves of its name
  // and Pronouns, while one written before rawTraits existed stores its bullets
  // with the flags stripped, so a trait gated by another trait's flags cannot
  // be re-rolled correctly from it and keeps no button. Picking the list the
  // same way the generator does is what stops a button from answering 400.
  //
  // Which of the three things each gutter cell can hold is traitControlCells'
  // question, above; the only rule of it that matters here is that it returns
  // whole <td>s - one per control, always both, empty or not - so they drop in
  // unwrapped. Wrapping them back into a single cell here is the arrangement
  // that stacked Re-roll over Set..., and ui.traitColumns.test.js guards it.
  //
  // The buttons lead the row rather than trailing it. Trailing, they sat past a
  // trait value that runs to a couple of hundred characters on Backdrop and
  // Stance, so their left edge moved with every row and the eye had to hunt for
  // them. Leading, they stack in two fixed gutters.
  const rerollable = rerollableForItem(item);
  el.detailTraits.innerHTML = Object.entries(item.traits || {})
    .filter(([k]) => !TRAIT_KEY_EXCLUDE.includes(k))
    .map(([k, v]) => {
      const cells = traitControlCells(k, rerollable);
      return `<tr>${cells}<td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`;
    })
    .join('');
}

/** The sheet's prompt panes, for a manifest entry new enough to carry them. */
function renderDetailPrompts(item) {
  // Only recorded by generate-npc.py versions new enough to save it - older
  // manifest entries just hide this section rather than show it empty.
  el.detailPrompts.hidden = !item.portraitPrompt && !item.tokenPrompt;
  el.detailPortraitPrompt.textContent = item.portraitPrompt || '';
  el.detailTokenPrompt.textContent = item.tokenPrompt || '';
}

/**
 * Repaint everything in the open sheet that comes from the item row.
 *
 * Order is load-bearing. renderDetailTraits() replaces el.detailTraits'
 * innerHTML, handing back freshly-ENABLED buttons; renderRegenPanel() is what
 * disables them for a running job. Painting the traits after the panel would
 * re-enable both gutters every two seconds during a render and reopen the 409
 * "already regenerating" window the server refuses a second job through.
 */
function renderDetailFor(item) {
  renderDetailHeader(item);
  renderDetailTraits(item);
  renderDetailPrompts(item);
  renderRegenPanel(item);
}

function openDetail(item) {
  // portraitUrl/tokenUrl carry the source file's mtime as a version query
  // param (see itemView in server.js), so a Regenerate since this item was
  // last shown naturally produces a different src here - no manual
  // cache-busting needed.
  el.detailPortrait.src = item.portraitUrl || '';
  el.detailToken.src = item.tokenUrl || '';
  renderDetailHeader(item);
  renderDetailTraits(item);
  renderDetailPrompts(item);

  state.detailItemId = item.id;
  state.regenLastStatus = item.regenStatus ?? null;
  // The trait-specific line belongs to one item and one job, and this is
  // neither of them yet.
  state.regenRunningMessage = null;
  document.querySelector('input[name="regen-which"][value="both"]').checked = true;
  document.querySelector('input[name="regen-seed-mode"][value="same"]').checked = true;
  el.regenSeedInput.disabled = true;
  el.regenSeedInput.value = '';
  renderRegenPanel(item);

  // The file list is a separate request (see /api/model-3d in server.js): it
  // costs a directory read, so it is made once per overlay open rather than
  // for every NPC on every poll. Until it lands the panel shows what the item
  // already knows, which is only whether a 3d/ folder exists at all.
  el.model3dRig.checked = false;
  el.model3dOverwrite.checked = false;
  renderModel3dPanel(item, null);
  refreshModel3d(item.id);

  // Opening the sheet is the one unambiguous "I have looked at this": it is
  // where the portrait at full size, the traits and the prompts actually are.
  // Not on grid presence, which a ten-NPC batch would clear before the user
  // had scrolled to the bottom of it; not on a timer, which would quietly
  // erase the signal in a tab left open; and not on any click, since the
  // checkbox is a selection gesture and says so already by stopping
  // propagation in render(). The re-render is for the card behind the overlay,
  // so the tag is gone when the sheet closes rather than at the next poll.
  if (item.isNew) {
    item.isNew = false;
    markSeen([item.id]);
    render();
  }

  el.overlay.hidden = false;
}

/**
 * Shut or reopen both trait gutters.
 *
 * Only the live buttons, which are the ones carrying a data-trait. The
 * explanatory button traitControlCells() emits for a trait this entry cannot
 * re-roll is disabled for a reason that has nothing to do with a running job,
 * and an unqualified selector here would enable it the moment one finished -
 * handing back a clickable control with no trait on it to post.
 *
 * Set... rides along: it edits the same entry, so it has to be shut for the
 * same reason. It only ever exists with a data-trait, but the selector keeps
 * the qualifier so the two halves read as one rule.
 *
 * Lifted out of renderRegenPanel so a staged edit (stageTraitEdit) closes the
 * same set of controls through the same selector rather than a second copy.
 */
function setTraitGuttersDisabled(on) {
  for (const button of el.detailTraits.querySelectorAll(
    '.reroll-btn[data-trait], .set-trait-btn[data-trait]')) {
    button.disabled = on;
  }
}

/** The detail overlay's "Regenerate art" panel, for whichever item is open. */
function renderRegenPanel(item) {
  const supported = typeof item.seed === 'number';
  el.regenPanel.hidden = !supported;
  if (!supported) return;

  el.regenCurrentSeed.textContent = `Current seed: ${item.seed}`;
  // The traits below the panel describe the NPC; the images above it may not.
  // Set by a staged trait edit, cleared by the next real render - so the notice
  // is exactly "there is a Regenerate waiting to be pressed", and the button
  // that answers it is highlighted while that is true.
  el.regenStale.hidden = !item.artStale;

  // A running regen shuts everything, and so does a staged edit in flight: it
  // rewrites the whole manifest entry, and a Regenerate landing mid-write would
  // render a half-applied NPC.
  const running = item.regenStatus === 'running' || state.stagingItemId === item.id;
  const seedMode = document.querySelector('input[name="regen-seed-mode"]:checked')?.value;
  el.regenBtn.disabled = running;
  el.regenBtn.textContent = running ? 'Regenerating…' : 'Regenerate';
  el.regenBtn.classList.toggle('accent', !!item.artStale && !running);
  for (const radio of document.querySelectorAll('#regen-panel input[type="radio"]')) radio.disabled = running;
  el.regenSeedInput.disabled = running || seedMode !== 'specific';
  setTraitGuttersDisabled(running);

  const justFinished = item.regenStatus === 'done' && state.regenLastStatus !== 'done';
  if (running) {
    // The trait-named line the click wrote, where there is one. This branch
    // runs again two seconds later on the first poll tick, and writing the
    // generic sentence unconditionally is what used to discard it.
    el.regenStatus.textContent = state.regenRunningMessage
      || 'Regenerating… this can take a few minutes (ComfyUI must be running).';
  } else if (item.regenStatus === 'error') {
    state.regenRunningMessage = null;
    el.regenStatus.textContent = `Failed: ${item.regenError || 'unknown error'}`;
  } else if (justFinished) {
    state.regenRunningMessage = null;
    el.regenStatus.textContent = `Done — new seed ${item.seed}.`;
  } else if (item.regenStatus !== 'done') {
    state.regenRunningMessage = null;
    el.regenStatus.textContent = '';
  }

  // portraitUrl/tokenUrl already changed (their &v= mtime stamp) the moment
  // the regen job finished and rewrote the file, so just reassigning them
  // here picks up the new art - no manual cache-busting needed.
  if (justFinished) {
    if (item.portraitUrl) el.detailPortrait.src = item.portraitUrl;
    if (item.tokenUrl) el.detailToken.src = item.tokenUrl;
  }
  state.regenLastStatus = item.regenStatus ?? null;
}

/**
 * The detail overlay's "3D model" panel.
 *
 * `view` is /api/model-3d's answer, or null before the first one arrives - in
 * which case only the item's own `has3d` flag is known and the panel renders
 * the frame without the file list.
 */
function renderModel3dPanel(item, view) {
  // generate-3d.py reconstructs from a rendered A-pose of the NPC's token,
  // which only exists for an NPC. Anything else gets no panel rather than a
  // button that always fails.
  el.model3dPanel.hidden = item.kind !== 'npc';
  if (el.model3dPanel.hidden) return;

  const status = view ? view.status : item.model3dStatus;
  const running = status === 'running';
  const built = view ? Boolean(view.shell || view.turnarounds.length) : Boolean(item.has3d);

  el.model3dBtn.disabled = running;
  el.model3dBtn.textContent = running ? 'Building…'
    : built ? 'Rebuild 3D model' : 'Create 3D model';

  // Forced on and locked once a model exists, because generate-3d.py *skips*
  // an NPC whose 3d/ folder is non-empty unless --overwrite. Without this the
  // obvious way to rebuild is a run that does nothing and reports success.
  if (built) el.model3dOverwrite.checked = true;
  el.model3dOverwrite.disabled = running || built;
  el.model3dRig.disabled = running;

  el.model3dBuilt.textContent = view?.builtAt
    ? `Built ${new Date(view.builtAt).toLocaleString(undefined, {
      dateStyle: 'medium', timeStyle: 'short',
    })}`
    : built ? '' : 'No model yet.';

  if (running) {
    // A reconstruction runs for minutes. generate-3d.py flushes a line as it
    // enters each stage, and showing it is the difference between "working"
    // and "possibly hung" - see model3dJobsByItemId in server.js.
    el.model3dStatus.textContent = view?.stage
      ? `Building… ${view.stage}`
      : 'Building… this takes several minutes (ComfyUI and Blender must both be available).';
  } else if (status === 'error') {
    el.model3dStatus.textContent = `Failed: ${(view ? view.error : item.model3dError) || 'unknown error'}`;
  } else {
    el.model3dStatus.textContent = '';
  }

  el.model3dTurnarounds.innerHTML = (view?.turnaroundUrls || [])
    .map((url, i) => `<img src="${escapeHtml(url)}" alt="Turnaround ${i * 90}°"
        title="Turnaround ${i * 90}°">`)
    .join('');
  // The turnarounds reuse the overlay's existing hover viewer rather than
  // growing one of their own - 78px is enough to see that a build happened
  // and nowhere near enough to judge it.
  for (const img of el.model3dTurnarounds.querySelectorAll('img')) attachImageZoom(img);

  // Named rather than linked: the browser sandbox will not open a 14 MB GLB
  // usefully, and the point of the line is to say what is on disk to go and
  // find. The turnarounds above are the part that can actually be looked at.
  el.model3dFiles.textContent = view
    ? [view.shell, view.print, view.rigged].filter(Boolean).join('  ·  ')
    : '';
}

/**
 * Fetches /api/model-3d for one NPC and re-renders the panel.
 *
 * Silent on failure: this runs on a 2s poll while a build is going, and a
 * blipped request is not worth replacing a live status line with an error.
 */
async function refreshModel3d(id) {
  if (!id) return;
  try {
    const res = await fetch(`/api/model-3d?id=${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const view = await res.json();
    // The overlay may have moved to another NPC while this was in flight.
    if (state.detailItemId !== id) return;
    const item = state.items.find((i) => i.id === id);
    if (item) renderModel3dPanel(item, view);
  } catch { /* leave the panel showing whatever it last knew */ }
}

el.model3dBtn.addEventListener('click', async () => {
  const id = state.detailItemId;
  if (!id) return;

  el.model3dBtn.disabled = true;
  el.model3dBtn.textContent = 'Building…';
  el.model3dStatus.textContent = 'Starting…';
  try {
    const res = await fetch('/api/model-3d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        rig: el.model3dRig.checked,
        overwrite: el.model3dOverwrite.checked,
      }),
    });
    const result = await res.json();
    if (!res.ok) {
      el.model3dStatus.textContent = `Couldn't start: ${result.error || res.status}`;
      await refreshModel3d(id);
      return;
    }
    // Before the awaits, not after. refreshItems() throws through api() on any
    // non-OK /api/items, and a poller started only on the happy path is exactly
    // the omission the trait handlers used to have: the job runs, nothing
    // watches it, and the panel sits on "Building…" until the page is reloaded.
    //
    // No noteRegenStarted() here - a 3D build has no regenStatus of its own,
    // and seeding the regen banner's gate for one would claim a job that does
    // not exist.
    startPolling();
    await refreshItems();
    await refreshModel3d(id);
  } catch (err) {
    el.model3dStatus.textContent = `Couldn't start: ${err.message}`;
    await refreshModel3d(id);
  }
});

for (const input of document.querySelectorAll('input[name="regen-seed-mode"]')) {
  input.addEventListener('change', () => {
    el.regenSeedInput.disabled = input.value !== 'specific';
    if (input.value === 'specific') el.regenSeedInput.focus();
  });
}

el.regenBtn.addEventListener('click', async () => {
  const id = state.detailItemId;
  if (!id) return;
  const which = document.querySelector('input[name="regen-which"]:checked')?.value || 'both';
  const seedMode = document.querySelector('input[name="regen-seed-mode"]:checked')?.value || 'same';
  const body = { id, which, seedMode };
  if (seedMode === 'specific') {
    const seed = Number(el.regenSeedInput.value);
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
      el.regenStatus.textContent = 'Enter a whole number seed between 0 and 4294967295.';
      return;
    }
    body.seed = seed;
  }

  el.regenBtn.disabled = true;
  el.regenBtn.textContent = 'Regenerating…';
  el.regenStatus.textContent = 'Starting…';
  try {
    const res = await fetch('/api/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok) {
      el.regenStatus.textContent = `Couldn't start: ${result.reason || result.error || res.status}`;
      el.regenBtn.disabled = false;
      el.regenBtn.textContent = 'Regenerate';
      return;
    }
    // The generic line is the right one here - this button re-renders the NPC
    // as it stands rather than editing anything.
    state.regenRunningMessage = null;
    el.regenStatus.textContent = 'Regenerating… this can take a few minutes (ComfyUI must be running).';
    // Both before the await, not after: refreshItems() throws through api() on
    // any non-OK /api/items, and a 202 followed by one bad list load would
    // otherwise leave a job genuinely running with no poller watching it and no
    // record that it ever started.
    noteRegenStarted(id);
    startPolling();
    await refreshItems();
  } catch (err) {
    el.regenStatus.textContent = `Couldn't start: ${err.message}`;
    el.regenBtn.disabled = false;
    el.regenBtn.textContent = 'Regenerate';
  }
});

/* ---- copying the prompts ---- */

const NL = '\n';

/** Writes `text` to the clipboard, reporting whether it landed.
 *
 * navigator.clipboard exists only in a secure context. Served on localhost the
 * GUI counts as one, but the same server reached over a LAN address does not,
 * and there the API is simply undefined - so the textarea fallback is the path
 * that actually runs for anyone using this from another machine, not a legacy
 * branch. execCommand is deprecated and still the only thing available there.
 */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or a non-secure context that defines the API anyway.
  }
  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.setAttribute('readonly', '');
  // Off-screen but still focusable: display:none or visibility:hidden would
  // make select() a no-op and the copy silently empty.
  scratch.style.position = 'fixed';
  scratch.style.top = '-1000px';
  document.body.appendChild(scratch);
  scratch.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  scratch.remove();
  return ok;
}

/** Flashes the outcome on the button itself - there is no toast in this UI. */
function flashCopyResult(button, ok) {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  button.classList.toggle('copied', ok);
  button.classList.toggle('copy-failed', !ok);
  button.textContent = ok ? 'Copied' : 'Copy failed';
  clearTimeout(button._copyTimer);
  button._copyTimer = setTimeout(() => {
    button.textContent = button.dataset.label;
    button.classList.remove('copied', 'copy-failed');
  }, 1200);
}

// Delegated on the sheet rather than on #detail-prompts, because the Files
// block's Copy button sits above the trait table and a delegation bound to the
// prompts pane alone would ship it inert. Delegated at all because the sheet is
// re-rendered per NPC, and re-binding per render would stack duplicate
// listeners on the same buttons.
el.overlay.addEventListener('click', async (e) => {
  const button = e.target.closest('.copy-btn');
  if (!button) return;

  let text;
  if (button.hasAttribute('data-copy-both')) {
    // Labelled, because two unlabelled prompts pasted together are not
    // distinguishable once they are in the buffer.
    const parts = [];
    if (el.detailPortraitPrompt.textContent) {
      parts.push('Portrait prompt' + NL + el.detailPortraitPrompt.textContent);
    }
    if (el.detailTokenPrompt.textContent) {
      parts.push('Token prompt' + NL + el.detailTokenPrompt.textContent);
    }
    text = parts.join(NL + NL);
  } else {
    const target = document.getElementById(button.dataset.copyTarget);
    text = target ? target.textContent : '';
  }

  if (!text) {
    flashCopyResult(button, false);
    return;
  }
  flashCopyResult(button, await copyToClipboard(text));
});

el.detailClose.addEventListener('click', () => {
  el.overlay.hidden = true;
  el.imageZoom.hidden = true;
  state.detailItemId = null;
});
el.overlay.addEventListener('click', (e) => {
  if (e.target === el.overlay) {
    el.overlay.hidden = true;
    el.imageZoom.hidden = true;
    state.detailItemId = null;
  }
});

/** Whether focus is somewhere typing should win over navigation. */
function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Cancel the open delete-confirmation dialog exactly as its own Cancel
 * button would, rather than just hiding it. confirmDelete() is Promise-based
 * and only resolves (and removes its onOk/onCancel/onBackdrop listeners)
 * inside cleanup(), which the Ok/Cancel/backdrop paths call - if Esc merely
 * hid the overlay, that Promise would stay unresolved and those listeners
 * would stay attached, so the *next* confirmDelete() call stacks its own
 * listeners on top, and a later click on Ok fires both: the abandoned one
 * resolves true and deletes whatever NPC was open when it was raised.
 */
function cancelDeleteConfirm() {
  elDeleteConfirm.cancel.click();
}

/** The same, for the re-roll cascade warning - confirmReroll() has the same shape. */
function cancelRerollConfirm() {
  elRerollConfirm.cancel.click();
}

/**
 * The overlays stacked above the NPC detail sheet, innermost first.
 *
 * Every other entry here lives as a top-level sibling after </main>, so
 * `hidden` tracks real visibility. #preset-preview is the one exception -
 * it is nested inside the Tables tab's own panel, so switchTab hiding that
 * panel does not hide the preview element itself; left unhandled, `hidden`
 * would stay false while the preview is actually invisible on every other
 * tab, and this function would report it "open" when nothing is on screen
 * to close. switchTab() dismisses any pending preview on the way out of the
 * Tables tab (see below), so in practice this branch is only ever reached
 * while the Tables tab is showing - it stays here as a direct, defensive
 * translation of "not hidden" to "open" rather than relying solely on that
 * invariant holding elsewhere.
 */
function topmostOverlay() {
  if (!el.imageZoom.hidden) return { close: () => { el.imageZoom.hidden = true; } };
  if (!elDeleteConfirm.overlay.hidden) return { close: () => cancelDeleteConfirm() };
  if (!elRerollConfirm.overlay.hidden) return { close: () => cancelRerollConfirm() };
  if (!elTraits.overlay.hidden) return { close: () => { elTraits.overlay.hidden = true; } };
  if (!elTables.preview.hidden) return { close: () => cancelPresetPreview() };
  return null;
}

/** Move `offset` places through the grid's current order and open that NPC. */
function stepDetail(offset) {
  const index = state.visibleItems.findIndex((i) => i.id === state.detailItemId);
  if (index === -1) return;
  // Clamped, not wrapping: arrowing off the end of a filtered list and
  // landing back at the start reads as a bug rather than a convenience.
  const next = state.visibleItems[index + offset];
  if (next) openDetail(next);
}

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  // Esc must work even while focus is in a field (e.g. the regenerate-seed
  // input) - the hint line advertises "Esc close" unconditionally. Arrow
  // keys stay blocked while typing, since those belong to the NPC sheet's
  // navigation, not to whatever field is focused.
  if (e.key !== 'Escape' && isTypingTarget(document.activeElement)) return;

  if (e.key === 'Escape') {
    const nested = topmostOverlay();
    if (nested) {
      nested.close();
      e.preventDefault();
      return;
    }
    if (!el.overlay.hidden) {
      el.overlay.hidden = true;
      el.imageZoom.hidden = true;
      e.preventDefault();
    }
    return;
  }

  // Arrow navigation belongs to the NPC sheet alone, and only when nothing
  // is stacked on top of it - arrowing the list out from under an open
  // delete confirmation would be actively dangerous.
  if (el.overlay.hidden || topmostOverlay()) return;
  if (e.key === 'ArrowLeft') {
    stepDetail(-1);
    e.preventDefault();
  } else if (e.key === 'ArrowRight') {
    stepDetail(1);
    e.preventDefault();
  }
});

function attachImageZoom(imgEl) {
  imgEl.addEventListener('mouseenter', () => {
    if (!imgEl.src) return;
    el.imageZoomImg.src = imgEl.src;
    el.imageZoomImg.alt = imgEl.alt;
    el.imageZoom.hidden = false;
  });
  imgEl.addEventListener('mouseleave', () => { el.imageZoom.hidden = true; });
}
attachImageZoom(el.detailPortrait);
attachImageZoom(el.detailToken);

el.selectAll.addEventListener('change', () => {
  const notImported = state.visibleItems.filter((i) => !i.imported && i.importable);
  if (el.selectAll.checked) notImported.forEach((i) => state.selected.add(i.id));
  else notImported.forEach((i) => state.selected.delete(i.id));
  render();
});

el.filterSearch.addEventListener('input', () => {
  state.search = el.filterSearch.value;
  render();
});

el.sortSelect.addEventListener('change', () => {
  state.sort = el.sortSelect.value;
  render();
});

el.addFilterBtn.addEventListener('click', () => {
  state.filters.push({ key: '', value: '' });
  renderFilterRows();
  render();
});

el.importBtn.addEventListener('click', async () => {
  const ids = [...state.selected];
  if (!ids.length) return;
  el.importBtn.disabled = true;
  const { results } = await api('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const skipped = results.filter((r) => !r.queued);
  el.status.textContent = skipped.length
    ? `Queued ${results.length - skipped.length}, skipped ${skipped.length} (${skipped.map((s) => s.reason).join('; ')})`
    : `Queued ${results.length} item(s) — waiting for Foundry to pick them up…`;
  state.selected.clear();
  await refreshItems();
  startPolling();
});

el.deleteBtn.addEventListener('click', async () => {
  const ids = [...state.selected];
  if (!ids.length) return;
  const names = ids.map((id) => state.items.find((i) => i.id === id)?.name || id);
  if (!(await confirmDelete(names))) return;

  el.deleteBtn.disabled = true;
  const { results } = await api('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const failed = results.filter((r) => !r.deleted);
  el.status.textContent = failed.length
    ? `Deleted ${results.length - failed.length}, failed ${failed.length} (${failed.map((f) => f.reason).join('; ')})`
    : `Deleted ${results.length} item(s).`;
  // Forget that these were ever looked at, for the ones that really went. The
  // server prunes its own seen store inside deleteItem for a reason: an id is
  // `npc-<slug>-<seed>`, so deleting an NPC and rolling it again at the same
  // name and seed brings back the same id, and it has to arrive flagged New.
  // But refreshItems() overrides isNew from state.locallySeen on every load, so
  // an entry left here silently defeats that prune - the re-rolled NPC gets no
  // tag and no .card.is-new border until the page is reloaded by hand. Only the
  // successes: an NPC that refused to delete is still there and still seen.
  for (const result of results) {
    if (result.deleted) state.locallySeen.delete(result.id);
  }
  state.selected.clear();
  await refreshItems();
});

el.detailDeleteBtn.addEventListener('click', async () => {
  const id = state.detailItemId;
  if (!id) return;
  const item = state.items.find((i) => i.id === id);
  const name = item?.name || id;
  if (!(await confirmDelete([name]))) return;

  const { results } = await api('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [id] }),
  });
  const result = results[0];
  if (result?.deleted) {
    el.overlay.hidden = true;
    el.imageZoom.hidden = true;
    state.detailItemId = null;
    state.selected.delete(id);
    // Alongside the selection, and for the reason spelled out in the Delete
    // Selected handler above: this is the path a delete-then-reroll actually
    // takes, since opening the sheet to check the NPC is what marked it seen in
    // the first place and the sheet is where its Delete button lives.
    state.locallySeen.delete(id);
    el.status.textContent = `Deleted "${name}".`;
    await refreshItems();
  } else {
    el.status.textContent = `Couldn't delete "${name}": ${result?.reason || 'unknown error'}`;
  }
});

/** Shared by the import flow and the regenerate-art flow - whichever queued something. */
function startPolling() {
  // Bumped on every call, including the ones that find a timer already running.
  // A tick spends most of its two seconds awaiting /api/items, so a job started
  // during that await is invisible to the list the tick is holding - and a
  // tick that then cleared the interval would take the poller down over a job
  // it had never seen. The counter is how the tick notices it happened.
  state.pollWanted += 1;
  if (state.pollTimer) return;
  let ticks = 0;
  let sawImportPending = false;
  state.pollTimer = setInterval(async () => {
    ticks += 1;
    const wantedAtEntry = state.pollWanted;
    if (state.items.some((i) => i.jobStatus === 'queued' || i.jobStatus === 'sent')) sawImportPending = true;

    await refreshItems();
    if (state.detailItemId) {
      const openItem = state.items.find((i) => i.id === state.detailItemId);
      if (openItem) {
        // The whole sheet, not just the regen panel. The traits, the header and
        // the prompts all come off the item row too, and a re-roll changes them
        // - which is the one thing a user watching this page wants to see.
        // Repainting ~20 rows every two seconds is cheap.
        renderDetailFor(openItem);
        await refreshModel3d(state.detailItemId);
      }
    }

    const building3d = state.items.some((i) => i.model3dStatus === 'running');
    const stillPending = building3d || state.items.some((i) =>
      i.jobStatus === 'queued' || i.jobStatus === 'sent' || i.regenStatus === 'running');
    // An empty list is not "nothing is pending". generate-npc.py rewrites the
    // whole manifest at the very end of a regen and the server answers [] for a
    // half-written file, so the one tick most likely to read empty is the one
    // landing on exactly the transition this poller exists to see. Keep
    // polling; the cap below still bounds it.
    const listUnreadable = state.items.length === 0;
    // The cap is a safety net against an unreachable ComfyUI, not a deadline
    // for the job. A regen queues a portrait, a token and the background-removal
    // pass, each with generate-npc.py's own --timeout default of 1800s, so the
    // old 20 minutes cut off runs that were still perfectly fine. A 3D build -
    // a render, two reconstructions and a headless Blender assembly - is in the
    // same range, so both get one number rather than two.
    const cap = 2700;   // 90 minutes at 2s/tick
    if (((!stillPending && !listUnreadable) || ticks > cap)
        // Not over a job started while this tick was awaiting: that job is not
        // in the list above, so `stillPending` says nothing about it.
        && state.pollWanted === wantedAtEntry) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      if (!stillPending && sawImportPending) el.status.textContent = 'Import complete.';
      // Never stop silently on a job that is still going: the card keeps its
      // "Regenerating…" pill and nothing else on the page would say why.
      if (stillPending) {
        el.status.textContent = 'Still working after 90 minutes — reload the page to check on it.';
      }
    }
  }, 2000);
}

/* ==================================================================== */
/* Tabs                                                                  */
/* ==================================================================== */

const tabState = { current: 'import' };

for (const btn of document.querySelectorAll('#tabs button')) {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
}

function switchTab(tab) {
  if (tab === tabState.current) return;
  // #preset-preview sits inside the Tables panel rather than as a top-level
  // overlay, so hiding that panel alone would leave a pending preview
  // "open" (not hidden) but invisible - silently eating the first Esc
  // press and blocking arrow-key navigation on whatever tab comes next.
  // Dismiss it explicitly on the way out.
  if (tabState.current === 'tables' && !elTables.preview.hidden) cancelPresetPreview();
  tabState.current = tab;
  for (const btn of document.querySelectorAll('#tabs button')) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.hidden = panel.id !== `tab-${tab}`;
  }
  if (tab === 'create' && !createState.tablesLoaded) loadOverrideTables();
  // Re-listed on every visit rather than once, the way the Tables tab's own
  // presets are: a preset saved in another browser tab should be there when
  // this one comes back to the form, not after a reload.
  if (tab === 'create') refreshCreatePresets().catch(() => { /* the list stays empty */ });
  if (tab === 'traits') refreshTraitCandidates().catch((err) => {
    elTraits.status.textContent = `Failed to load: ${err.message}`;
  });
  if (tab === 'tables') {
    loadTables().catch((err) => {
      elTables.empty.hidden = false;
      elTables.empty.textContent = `Failed to load: ${err.message}`;
    });
    loadPresets().catch(() => { /* the preset list just stays empty on failure */ });
  }
}

/* ==================================================================== */
/* Batch-complete banner                                                 */
/* ==================================================================== */

const elBanner = {
  root: document.getElementById('batch-banner'),
  text: document.getElementById('batch-banner-text'),
  show: document.getElementById('batch-banner-show'),
  dismiss: document.getElementById('batch-banner-dismiss'),
};

/**
 * The ids of the run the banner currently on screen is announcing, so its ×
 * can clear those New tags and no others.
 *
 * Empty whenever the run could not name its own NPCs - an older server, or a
 * manifest that could not be read either side of the child, both of which also
 * make job.produced null and send the count back to what the form asked for.
 * Dismissing then clears nothing at all. That leaves tags up that arguably
 * should have gone, which is the cheap way to be wrong: an extra tag costs one
 * click to clear, while a tag cleared by mistake is gone for good.
 */
const bannerState = { announcedIds: [] };

/**
 * Announce a finished generate run wherever the user happens to be standing.
 *
 * pollCreateJob() used to call refreshItems() and nothing else, guarded on
 * `state.category === 'npc'`. That guard is correct as far as it goes -
 * refreshItems() reloads whichever category is currently selected, so from
 * any other one it would do nothing useful - but it meant a run finishing
 * while the user sat on the Create, Tables or Trait Imports tab left no trace
 * at all. The images were on disk and the page never said so, which is the
 * whole complaint: you had to know to reload.
 *
 * The banner lives outside every .tab-panel, so it is visible from all four
 * tabs rather than only the one that owns the list it refers to.
 *
 * `ids` is the server's list of the NPCs this run added (job.producedIds),
 * which the banner holds on to for its dismiss button - see bannerState.
 */
function announceBatchComplete(count, ids) {
  // Forget that this page marked these seen, before anything reloads. An id
  // outlives the card it was clicked on whenever the same name and seed roll a
  // second folder under it, which is why the server un-sees a run's own output
  // (see forgetSeen there); left here, the record would overrule that for the
  // rest of the page load and leave this run's NPCs the only ones with no tag.
  for (const id of Array.isArray(ids) ? ids : []) state.locallySeen.delete(id);
  // Reload the list on screen first, whatever the count says - ahead of the
  // zero guard below, deliberately. Putting it after would read as sensible (a
  // run that produced nothing has no new cards to show) and would be wrong: the
  // count is a measurement this page's server takes of the manifest, not a fact
  // the generator reports, and a measurement can miss. A zero we measured
  // ourselves is precisely where a reload earns its one request, being also
  // where a card may have landed that nothing else on this page will reveal
  // until the user reloads by hand. Still gated on the Import tab showing NPCs,
  // since refreshItems() reloads the selected category and from anywhere else
  // would do nothing useful.
  if (tabState.current === 'import' && state.category === 'npc') refreshItems();
  // The banner is the part that has to stay quiet on a zero: an exit code of 0
  // is not a promise that any NPC landed, and "0 new NPCs finished generating"
  // is worse than silence. The guard lives in the function rather than at the
  // call site so a future caller cannot bring the empty banner back.
  if (!(count > 0)) return;
  // Copied rather than aliased: the banner outlives this call by however long
  // it takes the user to notice it, and the array must not be something a later
  // poll can quietly extend or empty underneath the dismiss button.
  bannerState.announcedIds = Array.isArray(ids) ? [...ids] : [];
  elBanner.text.textContent = count === 1
    ? '1 new NPC finished generating.'
    : `${count} new NPCs finished generating.`;
  // Visible from all four tabs, since it lives outside every .tab-panel - and
  // it stays up even after the refresh above, as the "that run is over" signal.
  elBanner.root.hidden = false;
}

function dismissBatchBanner() {
  elBanner.root.hidden = true;
}

elBanner.dismiss.addEventListener('click', () => {
  // Read before the banner goes, and emptied as it goes, so that whatever the
  // × clears is the run the text on screen was talking about and can never be
  // re-cleared against a later one.
  const announced = bannerState.announcedIds;
  bannerState.announcedIds = [];
  dismissBatchBanner();
  // The banner and its run's New tags are two halves of one announcement, so
  // waving the banner away is a bulk "yes, I know about these" for that run -
  // otherwise the only way to clear a ten-NPC batch is to open all ten. Bound
  // here rather than folded into dismissBatchBanner() itself, because the Show
  // new NPCs button dismisses the banner too and must not erase the very tags
  // it is about to navigate the user to.
  markBatchSeen(announced);
});

elBanner.show.addEventListener('click', async () => {
  dismissBatchBanner();
  switchTab('import');
  // loadCategories() first, not selectCategory('npc') alone: on the very
  // first run there was no NPC category to render a button for, so selecting
  // it without reloading would leave the category row without the one that
  // is now showing. loadCategories() ends by selecting categories[0], which
  // is why the explicit selection has to come after it rather than before.
  try {
    await loadCategories();
    await selectCategory('npc');
  } catch (err) {
    el.status.textContent = `Couldn't load the new NPCs: ${err.message}`;
  }
});

/* ==================================================================== */
/* Regenerate-complete banner                                            */
/* ==================================================================== */

const elRegenBanner = {
  root: document.getElementById('regen-banner'),
  text: document.getElementById('regen-banner-text'),
  show: document.getElementById('regen-banner-show'),
  dismiss: document.getElementById('regen-banner-dismiss'),
};

/**
 * The regenStatus each item carried the last time a list load looked at it,
 * keyed by id.
 *
 * This exists because `done` on its own means nothing. regenStatus is read off
 * regenJobsByItemId in server.js, an in-memory map that keeps a finished job
 * for the life of the process - so an item regenerated this morning still
 * reports `done` to a page opened this evening, and to every page opened until
 * the server restarts. Announcing on the status alone would raise a banner for
 * a job the user watched finish hours ago, on every single load, forever. What
 * is worth announcing is the transition, and a transition needs a before.
 *
 * Never pruned, deliberately. An entry outlives the category it was seen in, so
 * a regen started on the NPC list and left to run while the user looks at Mechs
 * still has its `running` recorded when they come back - which is the only
 * reason that case announces at all (see the note in refreshItems). The cost is
 * one short string per item seen this page load, and it is emptied by the
 * reload that empties everything else.
 */
const regenSeen = new Map();

/**
 * The items the banner on screen is announcing, so its Show button knows where
 * to go after the list underneath it has moved on. Only what the button needs -
 * an item object here would be a snapshot that the next poll makes stale.
 */
const regenBannerState = { announced: [] };

/**
 * Raise the banner for any regen that finished or failed since the last look.
 *
 * A re-roll is a regen job on the server side - same map, same status - so a
 * re-rolled trait announces through here too. That is the intent rather than a
 * side effect: both are "the art you asked for is finished", and both take long
 * enough that the user has almost certainly gone to look at something else.
 */
function detectRegenFinished(items) {
  const finished = [];
  const failed = [];
  for (const item of items) {
    const previous = regenSeen.get(item.id);
    const current = item.regenStatus ?? null;
    regenSeen.set(item.id, current);
    // The gate. `previous` is undefined for every item on the first list load
    // of a page, which is exactly right: nothing that was already over when
    // this page opened has any business interrupting anyone.
    if (previous !== 'running') continue;
    if (current === 'done') finished.push(item);
    else if (current === 'error') failed.push(item);
  }
  if (finished.length || failed.length) announceRegenComplete(finished, failed);
}

/**
 * Record that THIS page started a regen for `id`, so the gate above is
 * satisfied from the click rather than from a poll that may arrive after the
 * job has already failed.
 *
 * startRegenJob records status:'error' synchronously when the spawn itself
 * fails and the route still answers 202, so a job can be over before the first
 * /api/items lands - and the gate, seeing no previous status, would drop the
 * one failure the user most needs telling about. Seeding here is also what
 * makes the gate mean what its own comment already claims: "this page started
 * or witnessed the job".
 */
function noteRegenStarted(id) {
  regenSeen.set(id, 'running');
}

/**
 * How the banner names what it is announcing.
 *
 * Kind-aware for the plural because Regenerate is offered on anything the
 * manifest recorded a seed for, which is not only NPCs - calling two mechs
 * "2 NPCs" would be a small lie told confidently. A mixed batch falls back to
 * "items", which is vague but true.
 */
function regenSubject(items) {
  if (items.length === 1) return `${items[0].name}'s art`;
  const kinds = new Set(items.map((i) => i.kind));
  const label = kinds.size === 1 ? (CATEGORY_LABELS[[...kinds][0]] || 'items') : 'items';
  return `${items.length} ${label}`;
}

function announceRegenComplete(finished, failed) {
  // Failures lead, and colour the whole banner, because they are the half that
  // needs the user to do something. A tick that carries both is rare - it takes
  // two regens running at once - but saying only one of them would drop a fact
  // the page has no other way of raising once the poller stops.
  const parts = [];
  if (finished.length) parts.push(`${regenSubject(finished)} finished regenerating`);
  if (failed.length) parts.push(`${regenSubject(failed)} failed to regenerate`);
  elRegenBanner.text.textContent = `${parts.join('; ')}.`;
  elRegenBanner.root.classList.toggle('error', failed.length > 0);

  // Failures first in the list too, so the Show button lands on the one with
  // an error message to read rather than on the one that went fine.
  const announced = [...failed, ...finished];
  regenBannerState.announced = announced.map((i) => ({ id: i.id, kind: i.kind, name: i.name }));
  elRegenBanner.show.textContent = announced.length === 1 ? 'Show NPC' : 'Show the first';
  elRegenBanner.root.hidden = false;
}

function dismissRegenBanner() {
  elRegenBanner.root.hidden = true;
}

elRegenBanner.dismiss.addEventListener('click', () => {
  // Hides it, and does nothing else. Emphatically not the batch banner's ×,
  // which doubles as a bulk "mark this run seen": a regenerated NPC is one the
  // user already knew about and carries no New tag of its own, so clearing tags
  // from here would clear ones this banner never announced - and nothing in
  // this UI can put a New tag back.
  regenBannerState.announced = [];
  dismissRegenBanner();
});

elRegenBanner.show.addEventListener('click', async () => {
  const target = regenBannerState.announced[0];
  dismissRegenBanner();
  regenBannerState.announced = [];
  if (!target) return;
  switchTab('import');
  // By the item's own kind, not a hardcoded 'npc' - Regenerate is offered on
  // anything with a seed, and sending someone to the NPC list to find a mech
  // would be worse than not offering the button. loadCategories() first for the
  // reason the batch banner's Show gives: it ends by selecting categories[0],
  // so an explicit selection has to come after it.
  try {
    await loadCategories();
    await selectCategory(target.kind);
    // The sheet, not just the list. The regenerated art is the thing being
    // announced and the sheet is where it is shown at full size, alongside the
    // new seed and - for a failure - the reason. With several announced this
    // opens the first; the sheet's arrow keys walk to the rest.
    const item = state.items.find((i) => i.id === target.id);
    if (item) openDetail(item);
    else el.status.textContent = `"${target.name}" is no longer in the library.`;
  } catch (err) {
    el.status.textContent = `Couldn't open "${target.name}": ${err.message}`;
  }
});

/* ==================================================================== */
/* Create NPC                                                            */
/* ==================================================================== */

const createState = {
  overrideTables: [],
  // The two lists --reroll-trait accepts, one per kind of manifest entry - see
  // openDetail(), which pairs them with the item's own hasRawTraits.
  rerollableTraits: [],
  rawRerollableTraits: [],
  // generate-npc.py's TRAIT_DEPENDENTS, as { trait: [traits it frees] } - the
  // direct edges, which traitCascade() closes over. Empty until /api/npc-tables
  // lands, and empty for good if the server could not parse it, which
  // rerollNeedsConfirm() treats as "assume the worst" rather than as "no
  // cascades exist".
  traitDependents: {},
  traitOptions: {},   // { [baseTableName]: Array<{ value, label, heading, isVariant, enabled }> }
  tablesLoaded: false,
  overrides: [], // { table, value, custom, search }
  // The saved Create-form presets, as /api/create-presets lists them. Kept so
  // the Load, Download and Delete buttons can resolve the chosen slug back to
  // a name for their own messages without a second round trip.
  presets: [],
  pollTimer: null,
};

const elCreate = {
  count: document.getElementById('create-count'),
  seed: document.getElementById('create-seed'),
  name: document.getElementById('create-name'),
  pronouns: document.getElementById('create-pronouns'),
  server: document.getElementById('create-server'),
  portrait: document.getElementById('create-portrait'),
  token: document.getElementById('create-token'),
  keepRaw: document.getElementById('create-keep-raw'),
  unarmed: document.getElementById('create-unarmed'),
  overrideRows: document.getElementById('override-rows'),
  addOverrideBtn: document.getElementById('add-override'),
  presetSelect: document.getElementById('create-preset-select'),
  presetLoad: document.getElementById('create-preset-load'),
  presetSave: document.getElementById('create-preset-save'),
  presetDownload: document.getElementById('create-preset-download'),
  presetDelete: document.getElementById('create-preset-delete'),
  presetImport: document.getElementById('create-preset-import'),
  presetStatus: document.getElementById('create-preset-status'),
  dryRunBtn: document.getElementById('create-dry-run-btn'),
  generateBtn: document.getElementById('create-generate-btn'),
  status: document.getElementById('create-status'),
  log: document.getElementById('create-log'),
};

async function loadOverrideTables() {
  try {
    const { tables, rerollable, rawRerollable, dependents } = await api('/api/npc-tables');
    createState.overrideTables = tables;
    createState.rerollableTraits = rerollable || [];
    createState.rawRerollableTraits = rawRerollable || [];
    createState.traitDependents = dependents || {};
    createState.tablesLoaded = true;
    renderOverrideRows();
  } catch (err) {
    elCreate.status.textContent = `Failed to load trait tables: ${err.message}`;
    return;
  }

  try {
    // Built from the tables file rather than hardcoded in the markup. The
    // generator removed they/them and the hardcoded option outlived it by
    // months, silently sending a value that matched nothing.
    //
    // Own try/catch: the tables fetch above already succeeded by this
    // point, so a pronouns failure must not be blamed on "trait tables",
    // and must not stop createState.tablesLoaded from being true - the
    // override rows it gates loaded fine.
    // Own try/catch for the same reason as pronouns below: the picker is an
    // enhancement over the free-text input, which still works without it.
    try {
      const { options } = await api('/api/trait-options');
      createState.traitOptions = options;
      renderOverrideRows();
    } catch {
      createState.traitOptions = {};   // every row falls back to free text
    }

    const { subjects } = await api('/api/pronouns');
    const select = document.getElementById('create-pronouns');
    select.innerHTML = '<option value="">Any</option>';
    for (const subject of subjects) {
      const option = document.createElement('option');
      option.value = subject;
      option.textContent = subject;
      select.appendChild(option);
    }
  } catch (err) {
    elCreate.status.textContent = `Failed to load pronoun options: ${err.message}`;
  }
}

/** Sentinel <option> value meaning "let me type something not in the table". */
const CUSTOM_OVERRIDE = '__custom__';

/**
 * Which of the two images a forced trait actually reaches, as the sentence
 * shown under its row - or null for the twenty-odd traits that reach both.
 *
 * Four of the tables the override dropdown offers are half-useless in a way
 * nothing on this form said out loud. Backdrop is the scene BEHIND the
 * subject, and the token renders on flat white so RMBG can cut it out, so
 * forcing a Backdrop and then generating only a token changes almost nothing:
 * the scene itself never appears. (Almost, not nothing - a Backdrop flagged
 * 'nogear' narrows the Gear roll, and the Gear does reach the token. The note
 * says "used by" rather than "affects" for that reason.) Stance is the
 * reverse: the token is a full-body figure and Stance is its pose, while the
 * portrait is framed by its Backdrop and never mentions one. A GM who forced
 * either and got an unchanged image had no way to tell whether the override
 * had failed or simply did not apply.
 *
 * Weather and Glow placement are here for the same reason even though nobody
 * asked about them: both are portrait-only in generate-npc.py's templates, and
 * naming two of the four would imply the other two reach both.
 *
 * Kept as a literal inside the function rather than a module constant so the
 * whole thing lifts into a test with no helper injection - see
 * ui.overrideRow.test.js, and the note on liftFunction in
 * ui.setTraitPicker.test.js for why that matters here.
 */
function traitScopeNote(table) {
  const NOTES = {
    Backdrop: 'Portrait images only — the token renders on flat white for background '
      + 'removal, so it has no scene for a backdrop to sit in.',
    Stance: 'Token images only — the token is the full-body figure and this is its pose. '
      + 'The portrait is framed by its Backdrop instead.',
    Weather: 'Portrait images only, and only when the rolled Backdrop is an outdoor one: '
      + 'rain inside a cockpit is nonsense, so the generator drops it otherwise.',
    'Glow placement': 'Portrait images only — the token has no scene to place a glow '
      + 'against and keeps its own unplaced wording.',
  };
  return NOTES[table] || null;
}

/**
 * Why this option cannot be picked under the currently chosen Pronouns, or
 * null when it can.
 *
 * The tables file carries per-pronoun variants - 'Outfit (she) +', 'Hair (he)
 * +' - and lib/traitOptions.js folds them into their base table's list so the
 * dropdown can offer them together. That is right for browsing and wrong for
 * choosing: --set-trait pastes the bullet verbatim, so picking a woman-only
 * outfit while Pronouns says "he" produces a render of a man wearing it. The
 * optgroup label said "(this pronoun set only)", which reads as a description
 * of what the value IS rather than as a rule about when it applies.
 *
 * "Any" is blocked too, and that is the case worth explaining rather than
 * defending. Leaving Pronouns blank means the generator ROLLS them, so a
 * she-only bullet forced under Any is a coin flip on whether the render
 * contradicts itself - which is a worse failure than the refusal, because it
 * only shows up in the finished image.
 *
 * Pure and self-contained for the lifting reason above.
 */
function pronounBlockReason(option, subject) {
  if (!option) return null;

  // The other half of the rule, and the half that is easy to miss: a variant
  // heading written WITHOUT a trailing '+' does not add to its base table, it
  // REPLACES it. Two live tables do that - Build and Height - because the
  // masculine builds should not reach a woman even as long odds. So with
  // Pronouns on "she" every bullet under plain '## Build' is unrollable, and
  // the form was offering all of them ungreyed, because a base bullet carries
  // no variant subject of its own to gate on. lib/traitOptions.js works out
  // which subjects each base table is superseded for and puts them here.
  const replaced = (option.replacedFor || []).includes(subject);
  if (replaced) {
    return `Pronouns is “${subject}”, and “${option.heading} (${subject})” replaces `
      + `“${option.heading}” outright for that pronoun rather than adding to it - so the `
      + 'generator would never roll this value. Pick one from the variant instead.';
  }

  const wants = option.variantSubject;
  if (!wants) return null;
  if (subject && subject === wants) return null;
  const from = option.heading ? `“${option.heading}”` : `the ${wants} table`;
  if (!subject) {
    return `Set Pronouns to “${wants}” to use values from ${from}. With Pronouns `
      + 'left on Any the generator rolls them, so this one may land on an NPC it contradicts.';
  }
  return `Needs Pronouns “${wants}”: this value comes from ${from}, and Pronouns `
    + `is “${subject}”.`;
}

/**
 * The options whose text matches every whitespace-separated term in `query`,
 * in the order they were given.
 *
 * Every term rather than the whole string, so "kimono civ" finds the bullet
 * that is both without the user having to remember which segment comes first -
 * these are single-line renderings of bullets whose own word order is the
 * tables file's, not anything a searcher would predict. The heading is part of
 * the haystack so typing "she" narrows to the variant tables, which is the
 * fastest way to answer "what are the women-only outfits".
 *
 * An empty query returns a copy rather than the array itself: the caller
 * splices the current selection into the result, and mutating the caller's own
 * options array would corrupt createState.traitOptions for every other row.
 */
function filterTraitOptions(options, query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return (options || []).slice();
  return (options || []).filter((option) => {
    const haystack = `${option.label || ''}\n${option.heading || ''}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * Fill one row's value <select> from the table's options, the row's own search
 * text and the form's chosen Pronouns.
 *
 * Separate from renderOverrideRows because the search box calls it on every
 * keystroke. Re-rendering the whole row there would rebuild the input the user
 * is typing into and drop focus after the first character, which is the bug
 * this split exists to avoid rather than a stylistic preference.
 *
 * Returns the count of options the pronoun rule blocked, which is what decides
 * whether the row prints an explanation.
 */
function populateOverrideValues(valueSelect, options, override, subject) {
  const filtered = filterTraitOptions(options, override.search);
  valueSelect.innerHTML = '';

  const blank = document.createElement('option');
  blank.value = '';
  if (!options.length) blank.textContent = '— no values loaded —';
  else if (!filtered.length) blank.textContent = '— nothing matches that search —';
  else blank.textContent = '— pick a value —';
  valueSelect.appendChild(blank);

  // A search that hides the value already chosen would silently reset the
  // row: the <select> would fall back to the blank option and the next change
  // event would write that emptiness into the override. Keeping the current
  // choice pinned at the top means narrowing the list can never lose it.
  const stillListed = filtered.some((option) => option.value === override.value);
  if (override.value && !override.custom && !stillListed) {
    const kept = document.createElement('optgroup');
    kept.label = 'Currently selected';
    const opt = document.createElement('option');
    opt.value = override.value;
    const known = options.find((option) => option.value === override.value);
    opt.textContent = known ? known.label : override.value;
    opt.selected = true;
    kept.appendChild(opt);
    valueSelect.appendChild(kept);
  }

  let group = null;
  let groupName = null;
  let blocked = 0;
  for (const option of filtered) {
    if (option.heading !== groupName) {
      groupName = option.heading;
      group = document.createElement('optgroup');
      group.label = option.isVariant ? `${option.heading} (this pronoun set only)` : option.heading;
      valueSelect.appendChild(group);
    }
    const reason = pronounBlockReason(option, subject);
    const opt = document.createElement('option');
    opt.value = option.value;
    // Two independent reasons a value can be marked, and they are not the
    // same thing: 'disabled' is a bullet the user switched off on the Tables
    // tab, which --set-trait may still legitimately force, while the pronoun
    // rule is a contradiction the render would have to draw. So the first is
    // annotated and left selectable and the second is annotated and disabled.
    let label = option.enabled ? option.label : `${option.label}  [disabled]`;
    if (reason) {
      blocked += 1;
      // A replaced base bullet has no variantSubject of its own, so it needs
      // its own suffix - "[needs pronouns: undefined]" was the first draft.
      label = option.variantSubject
        ? `${label}  [needs pronouns: ${option.variantSubject}]`
        : `${label}  [replaced for “${subject}”]`;
      opt.disabled = true;
      opt.className = 'trait-option-unavailable';
      opt.title = reason;
    } else if (!option.enabled) {
      opt.className = 'trait-option-disabled';
    }
    opt.textContent = label;
    opt.selected = !override.custom && option.value === override.value;
    group.appendChild(opt);
  }

  const customOpt = document.createElement('option');
  customOpt.value = CUSTOM_OVERRIDE;
  customOpt.textContent = 'Custom value…';
  customOpt.selected = !!override.custom;
  valueSelect.appendChild(customOpt);

  return blocked;
}

function renderOverrideRows() {
  elCreate.overrideRows.innerHTML = '';
  // Blank means Any, which the pronoun rule treats as "not she and not he" -
  // see pronounBlockReason for why a rolled pronoun set is not good enough to
  // unlock a bullet written for one.
  const subject = (elCreate.pronouns && elCreate.pronouns.value) || '';

  createState.overrides.forEach((override, index) => {
    if (!override.table) override.table = createState.overrideTables[0] || '';
    if (typeof override.search !== 'string') override.search = '';

    const row = document.createElement('div');
    row.className = 'filter-row';

    const tableSelect = document.createElement('select');
    for (const t of createState.overrideTables) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      opt.selected = t === override.table;
      tableSelect.appendChild(opt);
    }
    row.appendChild(tableSelect);

    // Everything about the value - search, picker, readout, notes - stacks
    // inside one cell so the row stays three columns wide however tall the
    // readout grows.
    const cell = document.createElement('div');
    cell.className = 'override-cell';
    row.appendChild(cell);

    // A picker over the table's own bullets, plus the free-text input that
    // was here before it. --set-trait takes a bullet verbatim including its
    // '||' flags, and those flags gate the Weapon, Gear and Backdrop rolls
    // that follow - so an option's value is the raw bullet text and only its
    // label is prettied up. Typing one by hand stays possible (the generator
    // accepts values that are in no table at all), which is what CUSTOM is
    // for; it is also the whole behaviour when /api/trait-options failed.
    const options = createState.traitOptions[override.table] || [];

    // The search box. Counting the per-pronoun variants folded in, Backdrop
    // offers 319 values and Outfit 192, and a native <select> has no way
    // through a list that long but the arrow keys and a one-character
    // type-ahead that matches from the start of the label - which for these is
    // always the same handful of opening phrases.
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'override-search';
    search.value = override.search;
    search.placeholder = options.length
      ? `Search ${override.table}… (${options.length} values)`
      : `Search ${override.table}…`;
    search.hidden = !options.length;
    cell.appendChild(search);

    const valueSelect = document.createElement('select');
    valueSelect.className = 'filter-value';
    cell.appendChild(valueSelect);

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'filter-value';
    valueInput.placeholder = 'value, e.g. "a field medic" or "in her sixties || young"';
    valueInput.value = override.value;
    // With no options to pick from - a table the generator has that the
    // tables file does not, or a failed /api/trait-options - the row falls
    // back to exactly the free-text input it was before the picker existed,
    // rather than making the user select 'Custom value...' to reach it.
    valueInput.hidden = !override.custom && options.length > 0;
    cell.appendChild(valueInput);

    // The full bullet, wrapped. The <select> above is capped at the width of
    // the form card, so a 250-character Backdrop bullet is a truncated line
    // in it whatever the browser does; this is where the rest of it goes.
    // Deliberately the RAW value rather than the prettied label: it is what
    // gets sent to --set-trait, flag segments and all, and the flags are the
    // part a reader most needs to check.
    const full = document.createElement('div');
    full.className = 'override-full';
    cell.appendChild(full);

    const note = document.createElement('div');
    note.className = 'override-note';
    cell.appendChild(note);

    // Both notes go in one element, since they are both "here is what this row
    // will and will not do" and two stacked grey lines read as one paragraph
    // anyway. The scope note comes first: it is true of the row whatever is
    // selected, while the pronoun note counts what is in the list right now -
    // which is why this is a function rather than a one-off. A search narrows
    // the list, so a count written once would go on claiming a number that was
    // true before the user typed.
    const showNotes = (blockedCount) => {
      const notes = [];
      const scope = traitScopeNote(override.table);
      if (scope) notes.push(scope);
      if (blockedCount) {
        notes.push(`${blockedCount} value${blockedCount === 1 ? ' is' : 's are'} greyed out because `
          + `Pronouns is ${subject ? `“${subject}”` : 'Any'}. Hover one for the reason.`);
      }
      note.textContent = notes.join(' ');
      note.hidden = !notes.length;
    };
    showNotes(populateOverrideValues(valueSelect, options, override, subject));

    const showFull = () => {
      full.textContent = override.value;
      full.hidden = !override.value;
    };
    showFull();

    search.addEventListener('input', () => {
      override.search = search.value;
      // Only the <select> and the note are rebuilt - see populateOverrideValues
      // on why the whole row must not be.
      showNotes(populateOverrideValues(valueSelect, options, override, subject));
    });

    valueInput.addEventListener('input', () => {
      override.value = valueInput.value;
      showFull();
    });

    valueSelect.addEventListener('change', () => {
      if (valueSelect.value === CUSTOM_OVERRIDE) {
        override.custom = true;
        valueInput.hidden = false;
        valueInput.focus();
        return;
      }
      override.custom = false;
      override.value = valueSelect.value;
      valueInput.value = valueSelect.value;
      valueInput.hidden = true;
      showFull();
    });

    // Changing the table changes which bullets are on offer, so the row has
    // to be rebuilt - and the old value, which belonged to the old table, is
    // dropped rather than carried into a table it means nothing in. The
    // search text goes with it for the same reason.
    tableSelect.addEventListener('change', () => {
      override.table = tableSelect.value;
      override.value = '';
      override.custom = false;
      override.search = '';
      renderOverrideRows();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'filter-remove';
    remove.textContent = '×';
    remove.title = 'Remove override';
    remove.addEventListener('click', () => {
      createState.overrides.splice(index, 1);
      renderOverrideRows();
    });
    row.appendChild(remove);

    elCreate.overrideRows.appendChild(row);
  });
}

/**
 * Drop any override whose chosen value the current Pronouns setting has just
 * ruled out, and report how many went.
 *
 * Changing Pronouns after choosing a value is the path the disabled options
 * cannot cover: the option was legal when it was picked, and leaving it
 * selected would send a she-only bullet on a run the form now says is "he".
 * Clearing the value rather than the whole row keeps the table choice and the
 * search text, so the fix is one more click rather than a rebuild.
 */
function clearOverridesBlockedByPronouns(overrides, traitOptions, subject) {
  let cleared = 0;
  for (const override of overrides || []) {
    if (!override.value || override.custom) continue;
    const options = (traitOptions || {})[override.table] || [];
    const chosen = options.find((option) => option.value === override.value);
    if (!chosen) continue;
    if (!pronounBlockReason(chosen, subject)) continue;
    override.value = '';
    cleared += 1;
  }
  return cleared;
}

elCreate.addOverrideBtn.addEventListener('click', () => {
  createState.overrides.push({ table: '', value: '' });
  renderOverrideRows();
});

// Pronouns gates which values each override row may offer, so changing it has
// to redraw every row - and clear any value the new setting has just ruled
// out. The disabled options cover the choice that has not been made yet; this
// covers the one that already was.
elCreate.pronouns.addEventListener('change', () => {
  const cleared = clearOverridesBlockedByPronouns(
    createState.overrides, createState.traitOptions, elCreate.pronouns.value);
  renderOverrideRows();
  if (cleared) {
    elCreate.status.textContent = `Cleared ${cleared} trait override${cleared === 1 ? '' : 's'} `
      + 'that the new pronoun set rules out — pick replacements below.';
  }
});

elCreate.count.addEventListener('input', () => {
  const single = Number(elCreate.count.value) === 1;
  elCreate.name.disabled = !single;
  if (!single) elCreate.name.value = '';
});

function createRequestBody(dryRun) {
  const count = Number(elCreate.count.value) || 1;
  const seed = elCreate.seed.value.trim() === '' ? null : Number(elCreate.seed.value);
  return {
    count,
    seed,
    name: elCreate.name.value.trim(),
    pronouns: elCreate.pronouns.value,
    server: elCreate.server.value.trim(),
    noPortrait: !elCreate.portrait.checked,
    noToken: !elCreate.token.checked,
    keepRawToken: elCreate.keepRaw.checked,
    unarmed: elCreate.unarmed.checked,
    overrides: createState.overrides.filter((o) => o.table && o.value.trim()),
    dryRun,
  };
}

async function startCreateJob(dryRun) {
  if (elCreate.portrait.checked === false && elCreate.token.checked === false) {
    elCreate.status.textContent = "Can't uncheck both portrait and token — nothing would be generated.";
    return;
  }
  elCreate.dryRunBtn.disabled = true;
  elCreate.generateBtn.disabled = true;
  elCreate.status.textContent = dryRun ? 'Rolling and building prompts…' : 'Starting…';
  elCreate.log.hidden = true;
  elCreate.log.textContent = '';

  const body = createRequestBody(dryRun);
  try {
    const res = await fetch('/api/create-npc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok) {
      elCreate.status.textContent = `Couldn't start: ${result.reason || result.error || res.status}`;
      elCreate.dryRunBtn.disabled = false;
      elCreate.generateBtn.disabled = false;
      return;
    }
    pollCreateJob(result.jobId, dryRun, body.count);
  } catch (err) {
    elCreate.status.textContent = `Couldn't start: ${err.message}`;
    elCreate.dryRunBtn.disabled = false;
    elCreate.generateBtn.disabled = false;
  }
}

function pollCreateJob(jobId, dryRun, jobCount) {
  if (createState.pollTimer) clearInterval(createState.pollTimer);
  let ticks = 0;
  createState.pollTimer = setInterval(async () => {
    ticks += 1;
    let job;
    try {
      job = await api(`/api/create-status?jobId=${encodeURIComponent(jobId)}`);
    } catch (err) {
      clearInterval(createState.pollTimer);
      createState.pollTimer = null;
      elCreate.status.textContent = `Lost track of the job: ${err.message}`;
      elCreate.dryRunBtn.disabled = false;
      elCreate.generateBtn.disabled = false;
      return;
    }

    elCreate.log.hidden = !job.log;
    elCreate.log.textContent = job.log || '';

    if (job.status === 'running') {
      elCreate.status.textContent = dryRun
        ? 'Rolling and building prompts…'
        : 'Generating… this can take a few minutes per image (ComfyUI must be running).';
      // 600 ticks (20 min) safety net, same as the import/regen poller. Giving
      // up on watching is a terminal path like any other, so it has to hand the
      // form back too: it used to only drop the timer, which left both buttons
      // disabled and the status line still claiming the run was in progress,
      // with no way out but a reload.
      if (ticks > 600) {
        clearInterval(createState.pollTimer);
        createState.pollTimer = null;
        elCreate.dryRunBtn.disabled = false;
        elCreate.generateBtn.disabled = false;
        elCreate.status.textContent =
          'Stopped watching this run after 20 minutes — it may still be going; reload to check.';
      }
      return;
    }

    clearInterval(createState.pollTimer);
    createState.pollTimer = null;
    elCreate.dryRunBtn.disabled = false;
    elCreate.generateBtn.disabled = false;

    if (job.status === 'done') {
      // job.produced is what the server measured against the manifest; jobCount
      // is only what was asked for, which is what this used to announce and is
      // why a run that quietly wrote fewer NPCs - or none - still claimed the
      // full batch. Keep the fallback: `produced` is null on an older server or
      // an unreadable manifest, and the request is the best guess we have then.
      const made = typeof job.produced === 'number' ? job.produced : jobCount;
      // A measured zero is worth saying, but only as far as the measurement
      // goes. It is the count of manifest entries that appeared while the child
      // ran, so "no new NPCs were written" is more than it knows: a run can
      // land an NPC the count misses, most sharply when it reuses a name and
      // seed. Hence "no new NPCs were detected", and a pointer at both of the
      // places that can settle it.
      elCreate.status.textContent = dryRun
        ? 'Preview complete — see the rolled NPC(s) and prompts below.'
        : made === 0
          ? 'Finished, but no new NPCs were detected — check the log below and the '
            + '"Import Generated Art" tab.'
          : 'Done — see the "Import Generated Art" tab for the new NPC(s).';
      // producedIds rides along with the count and comes from the same
      // measurement: the banner's dismiss button clears the New tag, and the
      // only tags it may clear are the ones this run put there.
      if (!dryRun) announceBatchComplete(made, job.producedIds);
    } else {
      elCreate.status.textContent = `Failed: ${job.error || 'unknown error'}`;
    }
  }, 2000);
}

elCreate.dryRunBtn.addEventListener('click', () => startCreateJob(true));
elCreate.generateBtn.addEventListener('click', () => startCreateJob(false));

/* -------------------------------------------------------------------- */
/* Create-form presets                                                    */
/* -------------------------------------------------------------------- */

/**
 * The Create form's settings, as the shape lib/createPresets.js stores.
 *
 * Deliberately NOT createRequestBody(): that one is the run request, and it
 * carries dryRun and the single-NPC name, neither of which belongs in a saved
 * recipe. A preset that restored a name would hand the next NPC the last
 * one's, and a preset that restored dryRun would decide for the user which
 * button they meant to press.
 *
 * The overrides are copied field by field rather than passed through, because
 * createState.overrides also carries the row's `search` text - live UI state
 * that has no business surviving into a file someone else may import.
 */
function createFormSettings() {
  return {
    count: Number(elCreate.count.value) || 1,
    seed: elCreate.seed.value.trim() === '' ? null : Number(elCreate.seed.value),
    pronouns: elCreate.pronouns.value,
    server: elCreate.server.value.trim(),
    portrait: elCreate.portrait.checked,
    token: elCreate.token.checked,
    keepRawToken: elCreate.keepRaw.checked,
    unarmed: elCreate.unarmed.checked,
    overrides: createState.overrides
      .filter((o) => o.table && String(o.value).trim())
      .map((o) => ({ table: o.table, value: o.value, custom: !!o.custom })),
  };
}

/**
 * Load a preset's settings into the form.
 *
 * Every field is written from the preset rather than merged over what is
 * there, including the ones a preset can legitimately have left falsy - an
 * unchecked box and an absent key have to end the same way, or applying a
 * preset saved with "Generate token" off would leave it on and the user would
 * blame the preset rather than the merge.
 *
 * The one thing not restored is the pronoun-gated legality of each override.
 * A preset can name a she-only Outfit and a preset can name Pronouns "he";
 * nothing stops a hand-edited file carrying both. The rows are re-rendered
 * after loading, so such a value arrives visibly greyed out with its reason on
 * hover, which is a better answer than silently dropping it on load.
 */
function applyCreateSettings(settings) {
  const s = settings || {};
  elCreate.count.value = String(s.count || 1);
  elCreate.seed.value = s.seed === null || s.seed === undefined ? '' : String(s.seed);
  elCreate.pronouns.value = s.pronouns || '';
  elCreate.server.value = s.server || '';
  elCreate.portrait.checked = s.portrait !== false;
  elCreate.token.checked = s.token !== false;
  elCreate.keepRaw.checked = !!s.keepRawToken;
  elCreate.unarmed.checked = !!s.unarmed;
  createState.overrides = (Array.isArray(s.overrides) ? s.overrides : []).map((o) => ({
    table: String(o.table || ''),
    value: String(o.value || ''),
    custom: !!o.custom,
    search: '',
  }));
  // The Name field is disabled for a batch, and count is what decides that -
  // so a preset that restores count > 1 has to restore that too, or the field
  // stays enabled and typing in it silently does nothing. It is CLEARED as
  // well as disabled, which is the half the count listener already does and
  // this one first did not: a name typed before the preset was loaded
  // otherwise survives into the request body behind a field the user can no
  // longer reach, and the server refuses the whole run with "--name only makes
  // sense with a single NPC" over a value that is not on screen.
  elCreate.name.disabled = Number(elCreate.count.value) !== 1;
  if (elCreate.name.disabled) elCreate.name.value = '';
  renderOverrideRows();
}

function setPresetStatus(text, isError) {
  elCreate.presetStatus.textContent = text || '';
  elCreate.presetStatus.classList.toggle('is-error', !!isError);
}

async function refreshCreatePresets(selectSlug) {
  try {
    const { presets } = await api('/api/create-presets');
    createState.presets = presets || [];
  } catch (err) {
    createState.presets = [];
    setPresetStatus(`Could not list presets: ${err.message}`, true);
    return;
  }
  const wanted = selectSlug || elCreate.presetSelect.value;
  elCreate.presetSelect.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = createState.presets.length ? '— pick a preset —' : '— no presets saved —';
  elCreate.presetSelect.appendChild(blank);
  for (const preset of createState.presets) {
    const opt = document.createElement('option');
    opt.value = preset.slug;
    const n = preset.overrideCount;
    opt.textContent = typeof n === 'number'
      ? `${preset.name} (${n} override${n === 1 ? '' : 's'})`
      : preset.name;
    opt.selected = preset.slug === wanted;
    elCreate.presetSelect.appendChild(opt);
  }
  // Every button but Save acts on a chosen preset, so with none chosen they
  // would each answer with an error the user could have been spared.
  const chosen = !!elCreate.presetSelect.value;
  elCreate.presetLoad.disabled = !chosen;
  elCreate.presetDownload.disabled = !chosen;
  elCreate.presetDelete.disabled = !chosen;
}

elCreate.presetSelect.addEventListener('change', () => {
  const chosen = !!elCreate.presetSelect.value;
  elCreate.presetLoad.disabled = !chosen;
  elCreate.presetDownload.disabled = !chosen;
  elCreate.presetDelete.disabled = !chosen;
  setPresetStatus('');
});

elCreate.presetLoad.addEventListener('click', () => {
  const preset = createState.presets.find((p) => p.slug === elCreate.presetSelect.value);
  if (!preset) return;
  // The list route carries only the summary, so the settings are fetched from
  // the export route - the same JSON the Download button hands over, which is
  // one shape to keep true rather than two.
  api(`/api/create-presets/export?slug=${encodeURIComponent(preset.slug)}`)
    .then((full) => {
      applyCreateSettings(full.settings);
      setPresetStatus(`Loaded “${full.name || preset.name}”.`);
    })
    .catch((err) => setPresetStatus(`Could not load that preset: ${err.message}`, true));
});

elCreate.presetSave.addEventListener('click', async () => {
  const name = window.prompt('Name this preset');
  if (name === null) return;
  try {
    const { slug } = await api('/api/create-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, settings: createFormSettings() }),
    });
    await refreshCreatePresets(slug);
    setPresetStatus(`Saved “${name.trim()}”.`);
  } catch (err) {
    setPresetStatus(err.message, true);
  }
});

elCreate.presetDownload.addEventListener('click', () => {
  const slug = elCreate.presetSelect.value;
  if (!slug) return;
  // Through a hidden <a download> rather than window.location. Both fetch the
  // same attachment the server already names, but a location assignment
  // NAVIGATES: when the route answers 404 - a preset deleted in another tab -
  // the browser leaves this page and renders the JSON error, throwing away
  // whatever was typed into the form. A link that the browser declines to
  // follow leaves the page alone.
  const link = document.createElement('a');
  link.href = `/api/create-presets/export?slug=${encodeURIComponent(slug)}`;
  link.download = `${slug}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
});

elCreate.presetDelete.addEventListener('click', async () => {
  const preset = createState.presets.find((p) => p.slug === elCreate.presetSelect.value);
  if (!preset) return;
  if (!window.confirm(`Delete the preset “${preset.name}”? The form itself is not changed.`)) return;
  try {
    await api('/api/create-presets/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: preset.slug }),
    });
    await refreshCreatePresets('');
    setPresetStatus(`Deleted “${preset.name}”.`);
  } catch (err) {
    setPresetStatus(err.message, true);
  }
});

elCreate.presetImport.addEventListener('change', async () => {
  const file = elCreate.presetImport.files && elCreate.presetImport.files[0];
  // Cleared straight away so importing the same file twice in a row still
  // fires a change event the second time.
  elCreate.presetImport.value = '';
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (err) {
    setPresetStatus(`That file is not valid JSON: ${err.message}`, true);
    return;
  }
  try {
    // Validated by the server rather than here. The same normaliser that
    // guards the save route has to guard this one, or an imported file would
    // be the way to get an unchecked value into the form and from there onto
    // the generator's command line.
    const { name, settings } = await api('/api/create-presets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    });
    applyCreateSettings(settings);
    setPresetStatus(`Loaded “${name}” from file. Save it if you want to keep it.`);
  } catch (err) {
    setPresetStatus(err.message, true);
  }
});

/* ==================================================================== */
/* Trait imports                                                         */
/* ==================================================================== */

const traitState = {
  candidates: [],
  visible: [],
  selected: new Set(),
  search: '',
  tableFilter: '',
  sort: 'table',
};

const elTraits = {
  list: document.getElementById('trait-list'),
  empty: document.getElementById('trait-empty'),
  status: document.getElementById('trait-status'),
  importBtn: document.getElementById('trait-import-btn'),
  selectAll: document.getElementById('trait-select-all'),
  search: document.getElementById('trait-search'),
  tableFilter: document.getElementById('trait-table-filter'),
  sortSelect: document.getElementById('trait-sort-select'),
  overlay: document.getElementById('trait-detail-overlay'),
  detailClose: document.getElementById('trait-detail-close'),
  detailTable: document.getElementById('trait-detail-table'),
  detailSource: document.getElementById('trait-detail-source'),
  detailBullet: document.getElementById('trait-detail-bullet'),
  detailPlacement: document.getElementById('trait-detail-placement'),
  detailBookkeeping: document.getElementById('trait-detail-bookkeeping'),
  detailNotes: document.getElementById('trait-detail-notes'),
  detailImage: document.getElementById('trait-detail-image'),
};

// The same hover-to-full-size the generated-art detail sheet uses. A reference
// image is a wide hero crop that a bullet describes one corner of, so the
// thumbnail in the sheet is for recognising it and the zoom is for reading it.
attachImageZoom(elTraits.detailImage);

async function refreshTraitCandidates() {
  const { candidates } = await api('/api/trait-candidates');
  traitState.candidates = candidates;
  for (const id of [...traitState.selected]) {
    if (!candidates.some((c) => candidateKey(c) === id && !c.imported)) traitState.selected.delete(id);
  }
  renderTraitTableFilter();
  renderTraits();
}

function candidateKey(c) {
  return `${c.file}::${c.id}`;
}

function renderTraitTableFilter() {
  const tables = [...new Set(traitState.candidates.map((c) => c.table))].sort();
  const current = elTraits.tableFilter.value;
  elTraits.tableFilter.innerHTML = '<option value="">All tables</option>'
    + tables.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  if (tables.includes(current)) elTraits.tableFilter.value = current;
}

function traitMatchesFilters(c) {
  if (traitState.tableFilter && c.table !== traitState.tableFilter) return false;
  const search = traitState.search.trim().toLowerCase();
  if (!search) return true;
  return [c.bullet, c.sourceImage, c.notes, c.table].filter(Boolean).join('\n').toLowerCase().includes(search);
}

function compareTraitCandidates(a, b) {
  if (traitState.sort === 'when-asc') return (a.generatedAt || '').localeCompare(b.generatedAt || '');
  if (traitState.sort === 'table') {
    return a.table.localeCompare(b.table) || (b.generatedAt || '').localeCompare(a.generatedAt || '');
  }
  return (b.generatedAt || '').localeCompare(a.generatedAt || ''); // when-desc, the default
}

function renderTraits() {
  elTraits.list.innerHTML = '';
  traitState.visible = traitState.candidates.filter(traitMatchesFilters).sort(compareTraitCandidates);
  elTraits.empty.hidden = traitState.visible.length > 0;
  elTraits.empty.textContent = traitState.candidates.length
    ? 'No candidates match the current filters.'
    : 'No staged trait candidates yet — run the npc-trait-import skill, then reload.';

  for (const c of traitState.visible) {
    const key = candidateKey(c);
    const row = document.createElement('div');
    row.className = 'trait-row' + (c.imported ? ' imported' : '');

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = traitState.selected.has(key);
    check.disabled = c.imported;
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => {
      if (check.checked) traitState.selected.add(key);
      else traitState.selected.delete(key);
      updateTraitToolbar();
    });
    row.appendChild(check);

    const badge = document.createElement('span');
    badge.className = 'badge table-badge';
    badge.textContent = c.table;
    row.appendChild(badge);

    const bullet = document.createElement('span');
    bullet.className = 'trait-bullet';
    bullet.textContent = c.bullet.length > 160 ? `${c.bullet.slice(0, 160)}…` : c.bullet;
    row.appendChild(bullet);

    if (c.generatedAt) {
      const generatedBadge = document.createElement('span');
      generatedBadge.className = 'badge date-badge';
      generatedBadge.textContent = new Date(c.generatedAt).toLocaleDateString();
      row.appendChild(generatedBadge);
    }

    if (c.imported) {
      const importedBadge = document.createElement('span');
      importedBadge.className = 'badge';
      importedBadge.textContent = 'Imported';
      row.appendChild(importedBadge);
      if (c.importedAt) {
        const importedDateBadge = document.createElement('span');
        importedDateBadge.className = 'badge date-badge';
        importedDateBadge.textContent = `on ${new Date(c.importedAt).toLocaleDateString()}`;
        row.appendChild(importedDateBadge);
      }
    }

    row.addEventListener('click', () => openTraitDetail(c));
    elTraits.list.appendChild(row);
  }

  updateTraitToolbar();
}

function updateTraitToolbar() {
  elTraits.importBtn.textContent = `Import Selected (${traitState.selected.size})`;
  elTraits.importBtn.disabled = traitState.selected.size === 0;
  const notImported = traitState.visible.filter((c) => !c.imported);
  elTraits.selectAll.checked = notImported.length > 0
    && notImported.every((c) => traitState.selected.has(candidateKey(c)));
}

function openTraitDetail(c) {
  elTraits.detailTable.textContent = c.table;
  elTraits.detailSource.textContent = c.sourceImage ? `From: ${c.sourceImage}` : '';
  // hasSourceImage is the server's answer about refs/, not a guess from the
  // filename: a run staged before the skill copied its images, or one whose
  // copies have since been cleaned out, still names its source but has nothing
  // to show, and falls back to the line above on its own.
  if (c.hasSourceImage) {
    elTraits.detailImage.src = `/api/trait-image?file=${encodeURIComponent(c.file)}`
      + `&id=${encodeURIComponent(c.id)}`;
    elTraits.detailImage.alt = `Reference image ${c.sourceImage}`;
    elTraits.detailImage.hidden = false;
  } else {
    // Cleared rather than just hidden, so opening a candidate that has no
    // reference image cannot flash the last one that did.
    elTraits.detailImage.removeAttribute('src');
    elTraits.detailImage.alt = '';
    elTraits.detailImage.hidden = true;
  }
  elTraits.detailBullet.textContent = c.bullet;
  elTraits.detailPlacement.textContent = c.placementHint || '—';
  elTraits.detailBookkeeping.textContent = c.bookkeepingNote || '—';
  elTraits.detailNotes.textContent = c.notes || '—';
  elTraits.overlay.hidden = false;
}

elTraits.detailClose.addEventListener('click', () => { elTraits.overlay.hidden = true; });
elTraits.overlay.addEventListener('click', (e) => {
  if (e.target === elTraits.overlay) elTraits.overlay.hidden = true;
});

elTraits.search.addEventListener('input', () => {
  traitState.search = elTraits.search.value;
  renderTraits();
});
elTraits.tableFilter.addEventListener('change', () => {
  traitState.tableFilter = elTraits.tableFilter.value;
  renderTraits();
});
elTraits.sortSelect.addEventListener('change', () => {
  traitState.sort = elTraits.sortSelect.value;
  renderTraits();
});
elTraits.selectAll.addEventListener('change', () => {
  const notImported = traitState.visible.filter((c) => !c.imported);
  if (elTraits.selectAll.checked) notImported.forEach((c) => traitState.selected.add(candidateKey(c)));
  else notImported.forEach((c) => traitState.selected.delete(candidateKey(c)));
  renderTraits();
});

elTraits.importBtn.addEventListener('click', async () => {
  const items = [...traitState.selected].map((key) => {
    const [file, id] = key.split('::');
    return { file, id };
  });
  if (!items.length) return;
  elTraits.importBtn.disabled = true;
  const { results } = await api('/api/trait-candidates/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const failed = results.filter((r) => !r.imported);
  elTraits.status.textContent = failed.length
    ? `Imported ${results.length - failed.length}, failed ${failed.length} (${failed.map((f) => f.reason).join('; ')})`
    : `Imported ${results.length} candidate(s) into npc-generator-tables.md.`;
  traitState.selected.clear();
  await refreshTraitCandidates();
});

el.detailTraits.addEventListener('click', async (event) => {
  const button = event.target.closest('.reroll-btn');
  if (!button) return;
  const id = state.detailItemId;
  if (!id) return;
  const trait = button.dataset.trait;

  // Ask first when the re-roll can reach past the trait named on the button -
  // see rerollNeedsConfirm(). Awaited before anything is disabled or posted, so
  // backing out leaves the sheet exactly as it was.
  if (rerollNeedsConfirm(trait) && !(await confirmReroll(trait))) return;

  await stageTraitEdit({ id, op: 'reroll', table: trait, button });
});

el.detailTraits.addEventListener('click', async (event) => {
  const button = event.target.closest('.set-trait-btn');
  if (!button) return;
  const id = state.detailItemId;
  if (!id) return;
  const trait = button.dataset.trait;
  const item = state.items.find((i) => i.id === id);
  if (!item) return;

  // No separate cascade confirmation, unlike Re-roll's. The dialog already
  // shows what each value would cost before anything is chosen, and the
  // release checkbox is the consent - a second modal would ask about a
  // decision the user has just finished making.
  const picked = await openSetTrait(item, trait);
  if (!picked) return;

  await stageTraitEdit({
    id, op: 'set', table: trait, value: picked.value, release: picked.release, button,
  });
});

/**
 * What the generator said travelled, as one sentence.
 *
 * A re-roll on the raw path re-draws the named trait's whole cascade, and the
 * generator reports each one it moved on stderr as `  with Hair colour: 'x' ->
 * 'y'`. Somebody who clicked Re-roll on Theme and got a new outfit, weapon and
 * hair needs that said here rather than left to be found in the trait table.
 *
 * Null when nothing matched, so the caller falls back to the plain sentence: an
 * edit that moved exactly the trait named on the button has nothing extra to
 * report, and "and 0 others" is worse than silence.
 */
function cascadeSummary(table, log) {
  const also = [...String(log || '').matchAll(/^\s+with (.+?): /gm)].map((m) => m[1]);
  if (!also.length) return null;
  // Named up to three, counted past that - the same rule releaseLabel() uses,
  // for the same reason: a line naming eleven traits is not read.
  const named = also.length <= 3 ? also.join(', ') : `${also.length} other traits`;
  return `${table} updated — ${named} also changed. The art is now out of date `
    + '— press Regenerate when you are done editing.';
}

/**
 * Apply one trait edit to the stored NPC, with no render.
 *
 * The whole point of the redesign. A re-roll used to queue two ComfyUI jobs and
 * take minutes, so trying three haircuts cost the better part of an hour - and
 * because the server refuses a second regen while one is running, they could
 * not be done back to back at all. Now the edit lands in the manifest in about
 * a second, edits accumulate on the entry itself, and the Regenerate button -
 * unchanged, and now the only thing that makes a picture - is what renders
 * whatever the user has settled on. `artStale` is what says the two have parted
 * company in the meantime.
 *
 * The item comes back on the response rather than being fetched again: the
 * server re-reads the entry after the generator has written it, so what arrives
 * is the stored truth and not an echo of what was asked for.
 */
async function stageTraitEdit({ id, op, table, value, release, button }) {
  const label = op === 'reroll' ? `re-roll ${table}` : `set ${table}`;
  state.stagingItemId = id;
  state.regenRunningMessage = op === 'reroll' ? `Re-rolling ${table}…` : `Setting ${table}…`;
  el.regenStatus.textContent = state.regenRunningMessage;
  button.disabled = true;
  setTraitGuttersDisabled(true);

  let fresh = null;
  let message;
  try {
    const res = await fetch('/api/stage-trait', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, op, table, value, release }),
    });
    const result = await res.json();
    if (!res.ok) {
      message = `Couldn't ${label}: ${result.reason || result.error || res.status}`;
    } else {
      fresh = result.item || null;
      message = cascadeSummary(table, result.log)
        || `${table} updated. The art is now out of date — press Regenerate when you are done editing.`;
    }
  } catch (err) {
    message = `Couldn't ${label}: ${err.message}`;
  }

  // Cleared before anything repaints, not after. renderRegenPanel() reads it to
  // decide whether the panel is shut, so a repaint that still saw this edit in
  // flight would leave Regenerate disabled and labelled "Regenerating…" - with
  // no poller running to ever turn it back.
  state.stagingItemId = null;
  state.regenRunningMessage = null;
  if (fresh) {
    const at = state.items.findIndex((i) => i.id === id);
    if (at !== -1) state.items[at] = fresh;
    // The sheet, for the new trait value and the stale-art notice, and the grid
    // behind it, for the card's badge.
    renderDetailFor(fresh);
    render();
  } else {
    // Nothing was replaced, so reopen by hand what the click shut.
    setTraitGuttersDisabled(false);
    button.disabled = false;
  }
  el.regenStatus.textContent = message;
}

loadCategories().catch((err) => {
  el.status.textContent = `Failed to load: ${err.message}`;
});

// The reroll buttons need this list, and the detail sheet can be opened
// without ever visiting the Create tab that would otherwise load it. Failure
// is silent by design: the buttons simply do not appear, which is the same
// state as a generator too old to have REROLLABLE_TRAITS at all.
api('/api/npc-tables')
  .then(({ tables, rerollable, rawRerollable, dependents }) => {
    createState.overrideTables = tables;
    createState.rerollableTraits = rerollable || [];
    createState.rawRerollableTraits = rawRerollable || [];
    createState.traitDependents = dependents || {};
  })
  .catch(() => { /* no reroll buttons; the Create tab reports its own failure */ });

/* ==================================================================== */
/* Tables (per-bullet enable/disable)                                   */
/* ==================================================================== */

const tablesState = {
  tables: [],
  groups: [],
  selectedTable: null,
  presets: [],
  pendingPreset: null, // the parsed preset object currently shown in the preview, or null
  odds: null,          // the last settled /api/table-odds report, or null
  oddsStale: false,    // an edit has landed that the settled odds predate
  oddsReason: null,    // why the last run failed, or null
};

const elTables = {
  headingList: document.getElementById('table-heading-list'),
  bulletHeading: document.getElementById('table-bullet-heading'),
  bulletList: document.getElementById('table-bullet-list'),
  empty: document.getElementById('tables-empty'),
  presetList: document.getElementById('preset-list'),
  saveBtn: document.getElementById('preset-save-btn'),
  importInput: document.getElementById('preset-import-input'),
  preview: document.getElementById('preset-preview'),
  previewSummary: document.getElementById('preset-preview-summary'),
  previewList: document.getElementById('preset-preview-list'),
  applyBtn: document.getElementById('preset-apply-btn'),
  cancelBtn: document.getElementById('preset-cancel-btn'),
  chanceNote: document.getElementById('chance-note'),
};

async function loadTables() {
  const { groups } = await api('/api/table-bullets');
  tablesState.groups = groups;
  // The server sends only the grouped shape - groups[].rows[].table are the
  // same table objects as a flat list would contain, but that object
  // identity does not survive JSON.parse. Deriving tables from groups here
  // (rather than the server sending both) keeps the client to one object
  // graph, so a mutation like toggleBullet's stays visible everywhere,
  // including the next renderTableHeadingList() rebuild.
  const tables = groups.flatMap((g) => g.rows.map((r) => r.table));
  tablesState.tables = tables;
  elTables.empty.hidden = tables.length > 0;
  if (!tablesState.selectedTable || !tables.some((t) => t.name === tablesState.selectedTable)) {
    tablesState.selectedTable = tables[0]?.name ?? null;
  }
  renderTableHeadingList();
  renderTableBullets();
  // Not queueOdds(): nothing has been edited, so there is nothing to debounce,
  // and the server serves an unchanged tables file from cache. This is also
  // what makes the odds follow a trait import with no plumbing of its own -
  // importing rewrites the tables file, and coming back to this tab reloads.
  refreshOdds();
}

function renderTableHeadingList() {
  elTables.headingList.innerHTML = '';
  for (const { group, rows } of tablesState.groups) {
    const header = document.createElement('div');
    header.className = 'table-group-header';
    header.textContent = group;
    elTables.headingList.appendChild(header);

    for (const { table, isVariant } of rows) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'table-heading-row'
        + (isVariant ? ' variant' : '')
        + (table.name === tablesState.selectedTable ? ' active' : '');
      row.dataset.table = table.name;
      row.textContent = headingLabel(table);
      row.addEventListener('click', () => {
        tablesState.selectedTable = table.name;
        renderTableHeadingList();
        renderTableBullets();
      });
      elTables.headingList.appendChild(row);
    }
  }
}

/** The row's label, including its disabled-count badge. */
function headingLabel(table) {
  const disabledCount = table.bullets.filter((b) => !b.enabled).length;
  return disabledCount
    ? `${table.name} (${table.bullets.length}, ${disabledCount} disabled)`
    : `${table.name} (${table.bullets.length})`;
}

function renderTableBullets() {
  const table = tablesState.tables.find((t) => t.name === tablesState.selectedTable);
  elTables.bulletHeading.textContent = table ? table.name : 'Select a table';
  elTables.bulletList.innerHTML = '';
  if (!table) return;
  for (const bullet of table.bullets) {
    const row = document.createElement('label');
    row.className = 'table-bullet-row';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = bullet.enabled;
    check.addEventListener('change', () => toggleBullet(table.name, bullet, check));
    row.appendChild(check);

    const weightInput = document.createElement('input');
    weightInput.type = 'number';
    weightInput.className = 'weight-input';
    weightInput.min = '1';
    weightInput.step = '1';
    weightInput.value = String(bullet.weight);
    weightInput.title = 'Weight (relative roll chance)';
    weightInput.addEventListener('change', () => queueBulletWeight(table.name, bullet, weightInput));
    // The write is debounced and the sampled odds take seconds; the estimate
    // costs an arithmetic pass over one table, so it can follow the typing.
    // Held apart from bullet.weight, which stays what the FILE says until a
    // write has actually succeeded.
    weightInput.addEventListener('input', () => {
      const typed = Math.trunc(Number(weightInput.value));
      bullet.pendingWeight = Number.isInteger(typed) && typed >= 1 ? typed : undefined;
      renderChances();
    });
    row.appendChild(weightInput);

    const chance = document.createElement('span');
    chance.className = 'chance-cell';
    row.appendChild(chance);

    const text = document.createElement('span');
    text.className = 'table-bullet-text';
    text.textContent = bullet.text;
    row.appendChild(text);
    elTables.bulletList.appendChild(row);
  }
  renderChances();
}

/* ==================================================================== */
/* Roll chances                                                          */
/* ==================================================================== */

/*
 * How often a bullet actually gets rolled, which is not what its weight says.
 *
 * A weight compares a bullet to its neighbour. It does not give a rate, and
 * dividing by the table total does not either: disabled bullets are not in the
 * pool, and generate-npc.py filters most tables before drawing from them - a
 * Stance flagged '|| gun' needs the Weapon roll to have produced a firearm.
 *
 * So there are two numbers, and the cell shows both in turn. The estimate is
 * the local weight share, computed here, instantly, on every keystroke. The
 * settled figure comes from `generate-npc.py --trait-odds`, which samples its
 * own roller, and takes a few seconds.
 *
 * The tilde on the estimate is doing real work. On a filtered table the two
 * legitimately differ - that is the entire point of the feature - so the cell
 * visibly changes when the sampled value lands. Marked as an estimate, that
 * reads as "the estimate resolved". Unmarked, it reads as "the number moved on
 * its own", and a number that appears to move on its own is worse than none.
 */

/**
 * The share of this table's enabled weight one bullet holds.
 *
 * Reads pendingWeight where there is one - the value currently typed into a
 * weight box, which has not been written to the file yet. Without it the
 * estimate would lag the typing by the write's own debounce and then jump.
 */
function effectiveWeight(bullet) {
  return bullet.pendingWeight ?? bullet.weight;
}

function weightShare(table, bullet) {
  const total = table.bullets.reduce(
    (sum, b) => sum + (b.enabled ? effectiveWeight(b) : 0), 0);
  return total ? effectiveWeight(bullet) / total : 0;
}

/**
 * A probability as a whole percentage.
 *
 * Whole numbers because the sampling error at the default 20,000 rolls is
 * about 0.2 points - stable here, and not at one decimal place, which would
 * need roughly a hundred times the rolls. A digit that flickered between runs
 * would read as though the edit had done something.
 *
 * '<1%' rather than '0%' below half a point: the difference between rare and
 * unreachable is exactly what someone reads this column for.
 */
function formatChance(probability) {
  if (probability <= 0) return '0%';
  return probability < 0.005 ? '<1%' : `${Math.round(probability * 100)}%`;
}

/** Repaint every chance cell in the open table from whatever is currently known. */
function renderChances() {
  const table = tablesState.tables.find((t) => t.name === tablesState.selectedTable);
  if (!table) return;
  const settled = tablesState.odds?.tables?.[table.name] ?? null;
  const cells = elTables.bulletList.querySelectorAll('.chance-cell');
  // A weight typed but not yet written makes every settled figure in this
  // table out of date, not just its own row's.
  const typing = table.bullets.some((b) => b.pendingWeight !== undefined);

  table.bullets.forEach((bullet, i) => {
    const cell = cells[i];
    if (!cell) return;
    cell.className = 'chance-cell';
    cell.title = '';

    if (!bullet.enabled) {
      // Not '0%': a disabled bullet was never in the running, and 0% would
      // say it was in the running and lost.
      cell.textContent = '—';
      cell.title = 'Disabled — never rolled';
      return;
    }

    const sampled = settled ? settled[bullet.text] : undefined;
    if (sampled === undefined || tablesState.oddsStale || typing) {
      cell.textContent = `~${formatChance(weightShare(table, bullet))}`;
      cell.classList.add('estimate');
      cell.title = settled
        ? 'Estimate from the weights — the sampled figure is being recalculated'
        : 'Estimate from the weights alone, ignoring the generator\'s filters';
      return;
    }
    cell.textContent = formatChance(sampled);
    cell.title = `Rolled on about ${(sampled * 100).toFixed(1)}% of NPCs, `
      + `sampled over ${tablesState.odds.samples.toLocaleString()} rolls`;
  });

  renderChanceNote(table);
}

function renderChanceNote(table) {
  const note = elTables.chanceNote;
  const lines = [];

  if (tablesState.oddsReason) {
    lines.push(`Percentages are estimates from the weights alone — the generator could not be sampled (${tablesState.oddsReason}).`);
  } else if (!tablesState.odds || tablesState.oddsStale) {
    lines.push('Percentages are estimates from the weights alone; sampling the generator…');
  } else {
    lines.push(`Chance a rolled NPC gets this option, sampled over ${tablesState.odds.samples.toLocaleString()} rolls. `
      + 'The generator\'s filters are included, so a flagged option can read well below its weight.');
  }

  // Two facts about specific headings, hardcoded because they are facts about
  // specific headings. A general "which tables are conditional" facility would
  // be inventing a category to hold one member.
  if (table.name === 'Weather') {
    lines.push('Weather is always rolled, but only reaches the prompt when the Backdrop is flagged `weather` — most NPCs show none.');
  }
  if (/\(\w+\)/.test(table.name)) {
    lines.push('This is a per-pronoun variant table, so its rows total less than 100% — only some NPCs roll from it.');
  }

  note.textContent = lines.join(' ');
  note.hidden = false;
}

/**
 * Debounce beyond the weight input's own 400ms, so holding an arrow key is one
 * run and not thirty. A run costs a Python process and several seconds.
 */
const ODDS_DEBOUNCE_MS = 1000;
let oddsTimer = null;
let oddsRequest = 0;

function queueOdds() {
  tablesState.oddsStale = true;
  renderChances();
  clearTimeout(oddsTimer);
  oddsTimer = setTimeout(refreshOdds, ODDS_DEBOUNCE_MS);
}

async function refreshOdds() {
  const mine = ++oddsRequest;
  let result;
  try {
    result = await api('/api/table-odds');
  } catch (err) {
    result = { ok: false, reason: err.message };
  }
  // A slower earlier run must not overwrite a newer one's answer.
  if (mine !== oddsRequest) return;

  if (result.ok) {
    tablesState.odds = result;
    tablesState.oddsReason = null;
  } else {
    tablesState.oddsReason = result.reason;
  }
  tablesState.oddsStale = false;
  renderChances();
}

async function toggleBullet(tableName, bullet, checkboxEl) {
  const nextEnabled = checkboxEl.checked;
  checkboxEl.disabled = true;
  try {
    await api('/api/table-bullets/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: tableName, text: bullet.text, enabled: nextEnabled }),
    });
    bullet.enabled = nextEnabled;
    // Only this row's badge changed. Rebuilding the whole list -- thirty-odd
    // buttons and their group headers -- also threw away the list's scroll
    // position on every click.
    const table = tablesState.tables.find((t) => t.name === tableName);
    const row = elTables.headingList.querySelector(`[data-table="${CSS.escape(tableName)}"]`);
    if (table && row) row.textContent = headingLabel(table);
    // Enabling or disabling a bullet changes the denominator for every other
    // row in the table, not just this one's own chance.
    queueOdds();
  } catch (err) {
    checkboxEl.checked = !nextEnabled; // revert - the write failed
    alert(`Couldn't update that bullet: ${err.message}`);
  } finally {
    checkboxEl.disabled = false;
  }
}

/**
 * Debounce window for a weight edit, in ms.
 *
 * A number input fires 'change' on every spinner click and every arrow
 * keypress, not only when the field is left, so holding an arrow key sent one
 * POST per repeat - each of which was a full read-parse-write of
 * npc-generator-tables.md on the server. Long enough that a burst of clicks
 * settles into one request; short enough that a single deliberate edit still
 * feels immediate.
 */
const WEIGHT_DEBOUNCE_MS = 400;
const weightTimers = new Map();

/** Key a pending weight write by the bullet it targets, not by the element. */
function weightKey(tableName, bullet) {
    return `${tableName}\u0000${bullet.text}`;
}

/**
 * Schedule a weight write, replacing any still-pending one for that bullet.
 *
 * Only the last value in a burst is ever sent: the intermediate ones are
 * values the user scrolled past, and writing them would be both wasted work
 * and a sequence of file states nobody asked for.
 */
function queueBulletWeight(tableName, bullet, inputEl) {
  const key = weightKey(tableName, bullet);
  clearTimeout(weightTimers.get(key));
  weightTimers.set(key, setTimeout(() => {
    weightTimers.delete(key);
    setBulletWeight(tableName, bullet, inputEl);
  }, WEIGHT_DEBOUNCE_MS));
}

async function setBulletWeight(tableName, bullet, inputEl) {
  const nextWeight = Math.trunc(Number(inputEl.value));
  if (!Number.isInteger(nextWeight) || nextWeight < 1) {
    inputEl.value = bullet.weight;
    bullet.pendingWeight = undefined;
    renderChances();
    alert('Weight must be a whole number of 1 or more.');
    return;
  }
  if (nextWeight === bullet.weight) {
    bullet.pendingWeight = undefined;
    renderChances();
    return;
  }
  inputEl.disabled = true;
  try {
    await api('/api/table-bullets/set-weight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: tableName, text: bullet.text, weight: nextWeight }),
    });
    bullet.weight = nextWeight;
    queueOdds();
  } catch (err) {
    inputEl.value = bullet.weight;
    alert(`Couldn't update that bullet's weight: ${err.message}`);
  } finally {
    bullet.pendingWeight = undefined;   // the file and the box agree again, either way
    inputEl.disabled = false;
    renderChances();
  }
}

/* ==================================================================== */
/* Presets                                                               */
/* ==================================================================== */

async function loadPresets() {
  const { presets } = await api('/api/presets');
  tablesState.presets = presets;
  renderPresetList();
}

function renderPresetList() {
  elTables.presetList.innerHTML = '';
  if (!tablesState.presets.length) {
    elTables.presetList.textContent = 'No saved presets yet.';
    return;
  }
  for (const preset of tablesState.presets) {
    const row = document.createElement('div');
    row.className = 'preset-row';

    const name = document.createElement('span');
    name.className = 'preset-name';
    // "(12 selected)", not a bare "(12)". The number used to be the count of
    // *disabled* bullets and is now the count of selected ones - the opposite
    // reading - and nothing in the UI said which, so an old preset and a new
    // one showed the same kind of number meaning inverse things.
    name.textContent = `${preset.name} (${preset.count} selected)`;
    row.appendChild(name);

    const date = document.createElement('span');
    date.className = 'preset-date';
    date.textContent = new Date(preset.created).toLocaleDateString();
    row.appendChild(date);

    const download = document.createElement('a');
    download.className = 'preset-download';
    download.href = `/api/presets/export?slug=${encodeURIComponent(preset.slug)}`;
    download.textContent = 'Download';
    download.download = `${preset.slug}.json`;
    row.appendChild(download);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = 'Delete';
    del.addEventListener('click', () => deletePresetRow(preset.slug));
    row.appendChild(del);

    elTables.presetList.appendChild(row);
  }
}

async function deletePresetRow(slug) {
  if (!confirm('Delete this preset? This cannot be undone.')) return;
  await api('/api/presets/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  });
  await loadPresets();
}

elTables.saveBtn.addEventListener('click', async () => {
  const name = prompt('Name this preset:');
  if (!name || !name.trim()) return;
  try {
    await api('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    await loadPresets();
  } catch (err) {
    alert(`Couldn't save preset: ${err.message}`);
  }
});

elTables.importInput.addEventListener('change', async () => {
  const file = elTables.importInput.files[0];
  elTables.importInput.value = '';
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (err) {
    alert(`That file isn't valid JSON: ${err.message}`);
    return;
  }
  let diff;
  try {
    diff = await api('/api/presets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    });
  } catch (err) {
    alert(`Couldn't preview that preset: ${err.message}`);
    return;
  }
  tablesState.pendingPreset = parsed;
  renderPresetPreview(diff);
});

function renderPresetPreview(diff) {
  elTables.preview.hidden = false;
  const changing = diff.willEnable.length + diff.willDisable.length + diff.willReweight.length;
  elTables.previewSummary.textContent =
    `Will change ${changing} bullet(s): ${diff.willEnable.length} to enable, `
    + `${diff.willDisable.length} to disable, ${diff.willReweight.length} to reweight. `
    + `Already matching ${diff.alreadyMatching.length}, not found locally ${diff.notFound.length}.`;
  elTables.previewList.innerHTML = '';
  for (const { table, text, weight } of diff.willEnable) {
    const li = document.createElement('li');
    li.textContent = `${table}: enable "${text}" (x${weight})`;
    elTables.previewList.appendChild(li);
  }
  for (const { table, text, weight } of diff.willReweight) {
    const li = document.createElement('li');
    li.textContent = `${table}: reweight "${text}" to x${weight}`;
    elTables.previewList.appendChild(li);
  }
  for (const { table, text } of diff.willDisable) {
    const li = document.createElement('li');
    li.textContent = `${table}: disable "${text}"`;
    elTables.previewList.appendChild(li);
  }
  for (const { table, text } of diff.notFound) {
    const li = document.createElement('li');
    li.className = 'preset-preview-not-found';
    li.textContent = `${table}: ${text} (not found locally)`;
    elTables.previewList.appendChild(li);
  }
}

elTables.applyBtn.addEventListener('click', async () => {
  if (!tablesState.pendingPreset) return;
  let result;
  try {
    result = await api('/api/presets/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tablesState.pendingPreset),
    });
  } catch (err) {
    alert(`Couldn't apply preset: ${err.message}`);
    return;
  }
  // A 200 no longer means every bullet was written. The route reports the
  // edits its own guards rejected instead of discarding them, so say which -
  // silently applying most of a preset and calling it done is the thing this
  // list exists to stop.
  const failed = result?.failed ?? [];
  if (failed.length) {
    const lines = failed.slice(0, 10).map((f) => `  ${f.table}: "${f.text}" - ${f.error}`);
    const more = failed.length > 10 ? `\n  ...and ${failed.length - 10} more` : '';
    alert(`Applied, but ${failed.length} bullet(s) could not be written:\n\n`
      + lines.join('\n') + more);
  }
  tablesState.pendingPreset = null;
  elTables.preview.hidden = true;
  await loadTables();
});

/** Dismiss the pending preset-import preview without applying it. */
function cancelPresetPreview() {
  tablesState.pendingPreset = null;
  elTables.preview.hidden = true;
}
elTables.cancelBtn.addEventListener('click', cancelPresetPreview);
