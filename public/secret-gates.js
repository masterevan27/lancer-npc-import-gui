/* Tag gates for Secret mode's private tables, shared by the Create form,
 * its roll order panel and the server (lib/secretTables.js). A bullet's
 * trailing '#tag's name the gated tables its value opens; '(when: a, b)' at
 * the end of a heading makes a table roll only once an earlier value carries
 * a or b. Mirrors generate-npc.py (split_extra_tags, extra_when,
 * _check_gate_order, _open_fixed_gates, roll_extra), texts included. */
(function (root) {
  'use strict';
  const TAG_RE = /^[A-Za-z0-9_-]+$/;
  const unique = list => [...new Set(list)];
  const tagList = tags => tags.map(tag => `#${tag}`).join(' or ');
  const hasTag = (row, need) => row.tags.some(tag => need.includes(tag));

  function splitTags(text) {
    const match = text.match(/((?:\s+#[A-Za-z0-9_-]+)+)\s*$/);
    if (!match || !text.slice(0, match.index).trim()) return { value: text, tags: [] };
    return { value: text.slice(0, match.index).trimEnd(),
      tags: unique(match[1].match(/#[A-Za-z0-9_-]+/g).map(tag => tag.slice(1).toLowerCase())) };
  }

  function checkWhen(name, list) {
    if (!Array.isArray(list) || !list.length || list.every(tag => typeof tag === 'string' && !tag.trim())) {
      throw new Error(`table '${name}' has an empty (when:)`);
    }
    return unique(list.map(tag => {
      if (typeof tag !== 'string' || !tag.trim()) throw new Error(`table '${name}' has an empty entry in (when:)`);
      const trimmed = tag.trim();
      if (!TAG_RE.test(trimmed)) throw new Error(`table '${name}': '${trimmed}' is not a tag (letters, digits, - and _)`);
      return trimmed.toLowerCase();
    }));
  }

  function splitWhen(heading) {
    const match = heading.match(/^(.*?)\s*\(when:([^)]*)\)\s*$/i);
    if (!match) return { name: heading, when: null };
    const name = match[1].trim();
    return { name, when: checkWhen(name, match[2].split(',')) };
  }

  const entryKey = (file, name) => `${file}\n${name}`;

  function rollOrder(files) {
    const order = [];
    for (const file of files) {
      if (file.error) continue;
      for (const table of file.tables || []) {
        const tags = table.tags || {};
        order.push({ key: entryKey(file.file, table.name), file: file.file, name: table.name, when: table.when || null,
          rows: table.values.map(value => ({ value, tags: Object.hasOwn(tags, value) ? tags[value] : [] })) });
      }
    }
    order.forEach((entry, index) => {
      const earlier = order.slice(0, index);
      entry.openers = !entry.when ? [] : earlier
        .filter(other => other.rows.some(row => hasTag(row, entry.when)))
        .map(other => ({ file: other.file, name: other.name,
          tags: entry.when.filter(tag => other.rows.some(row => row.tags.includes(tag))) }));
      entry.depth = !entry.when ? 0 : 1 + Math.max(0, ...entry.openers.map(opener =>
        earlier.find(other => other.file === opener.file && other.name === opener.name).depth));
    });
    for (const entry of order) {
      entry.opens = unique(entry.rows.flatMap(row => row.tags))
        .map(tag => ({ tag, tables: order.filter(other => other.when?.includes(tag)
          && other.openers.some(opener => opener.file === entry.file && opener.name === entry.name)).map(other => other.name) }))
        .filter(item => item.tables.length);
    }
    return order;
  }

  function orderErrors(files) {
    const order = rollOrder(files);
    const errors = new Map();
    order.forEach((entry, index) => {
      if (!entry.when || entry.openers.length || errors.has(entry.file)) return;
      const label = entry.when.join(', ');
      const later = order.slice(index + 1).find(other => other.rows.some(row => hasTag(row, entry.when)));
      errors.set(entry.file, later
        ? `gated table '${entry.name}' comes before '${later.name}', the table that opens it (when: ${label})`
        : `gated table '${entry.name}' has no table in the folder carrying its tags (when: ${label})`);
    });
    return errors;
  }

  function resolveGates(order, picks, { dropClosed = false } = {}) {
    const selected = order.filter(entry => picks.has(entry.key));
    const rows = new Map(selected.map(entry => [entry.key, entry.rows]));
    const fixed = new Map();
    for (const entry of selected) {
      const value = picks.get(entry.key);
      if (!value) continue;
      rows.set(entry.key, entry.rows.filter(row => row.value === value));
      fixed.set(entry.key, { by: null, need: null });
    }
    const dropped = new Map();
    const done = new Set();

    function follow(opener) {
      const inner = require(opener);
      if (inner?.drop) { dropped.set(opener.key, inner.drop); return { drop: `'${opener.name}' is closed` }; }
      return inner;
    }

    function require(entry) {
      if (done.has(entry.key)) return null;
      done.add(entry.key);
      if (!entry.when) return null;
      const need = entry.when;
      const live = selected.filter(other => !dropped.has(other.key));
      const earlier = live.slice(0, live.indexOf(entry));
      const sure = earlier.find(other => fixed.has(other.key) && rows.get(other.key).every(row => hasTag(row, need)));
      if (sure) return follow(sure);
      const openers = earlier.filter(other => !fixed.has(other.key) && rows.get(other.key).some(row => hasTag(row, need)));
      if (openers.length === 1) {
        const [opener] = openers;
        rows.set(opener.key, rows.get(opener.key).filter(row => hasTag(row, need)));
        fixed.set(opener.key, { by: entry.name, need });
        return follow(opener);
      }
      const head = `extra table '${entry.name}' has a fixed value but `;
      if (openers.length) {
        return { error: `${head}${openers.map(other => `'${other.name}'`).join(' and ')} could each open it (when: ${need.join(', ')}); fix or untick all but one` };
      }
      const carriers = earlier.filter(other => fixed.has(other.key) && other.rows.some(row => hasTag(row, need)));
      const narrowed = carriers.find(other => fixed.get(other.key).by);
      if (narrowed) {
        const { by, need: limit } = fixed.get(narrowed.key);
        return { error: `${head}'${narrowed.name}' is already limited to ${tagList(limit)} by '${by}'` };
      }
      const reason = carriers.length
        ? `'${carriers[0].name}' is fixed to '${rows.get(carriers[0].key)[0].value}', which is not ${tagList(need)}`
        : `nothing selected can open it (when: ${need.join(', ')})`;
      return dropClosed ? { drop: reason } : { error: head + reason };
    }

    let error = null;
    for (const entry of selected) {
      if (!picks.get(entry.key) || !entry.when) continue;
      const outcome = require(entry);
      if (outcome?.drop) dropped.set(entry.key, outcome.drop);
      if (outcome?.error) { error = outcome.error; break; }
    }

    const status = new Map();
    const state = new Map();
    for (const entry of order) {
      const limit = fixed.get(entry.key);
      const limited = Boolean(limit?.by);
      if (!picks.has(entry.key)) { status.set(entry.key, { state: 'unselected', text: 'not selected', limited: false }); continue; }
      let current;
      let text;
      if (dropped.has(entry.key)) {
        current = 'closed'; text = `closed — ${dropped.get(entry.key)}`;
      } else if (!entry.when) {
        current = 'rolls';
      } else {
        const earlier = selected.slice(0, selected.indexOf(entry)).filter(other => state.get(other.key) !== 'closed');
        const could = earlier.filter(other => rows.get(other.key).some(row => hasTag(row, entry.when)));
        if (!could.length) {
          const carrier = earlier.find(other => fixed.has(other.key) && !fixed.get(other.key).by && other.rows.some(row => hasTag(row, entry.when)));
          current = 'closed';
          text = `closed — ${carrier
            ? `'${carrier.name}' is fixed to '${rows.get(carrier.key)[0].value}', which is not ${tagList(entry.when)}`
            : `nothing selected can open it (when: ${entry.when.join(', ')})`}`;
        } else if (could.some(other => state.get(other.key) === 'rolls' && rows.get(other.key).every(row => hasTag(row, entry.when)))) {
          current = 'rolls';
        } else {
          current = 'maybe';
          text = `rolls only if ${could.map(other => other.name).join(' or ')} rolls ${tagList(entry.when)}`;
        }
      }
      if (current === 'rolls') {
        const limits = selected.filter(other => fixed.get(other.key)?.by === entry.name)
          .map(other => `limits '${other.name}' to ${tagList(fixed.get(other.key).need)}`);
        text = [limited ? `rolls, limited to ${tagList(limit.need)} by '${limit.by}'` : 'rolls', ...limits].join('; ');
      }
      state.set(entry.key, current);
      status.set(entry.key, { state: current, text, limited });
    }
    return { error, status };
  }

  function rollOrderView(order, result, fileErrors = []) {
    const gated = order.filter(entry => entry.when).length;
    const summary = order.length ? `Roll order and gates (${order.length} tables, ${gated} gated)` : 'Roll order and gates (no tables)';
    const items = order.map(entry => ({
      depth: entry.depth,
      title: entry.name,
      file: entry.file,
      gate: !entry.when ? 'always' : `when: ${entry.when.map(tag => `#${tag}`).join(', ')} — ${entry.openers.length
        ? `opened by ${entry.openers.map(opener => `${opener.name} (${opener.tags.map(tag => `#${tag}`).join(', ')})`).join(', ')}`
        : 'nothing listed opens it'}`,
      opens: entry.opens.length ? `can open: ${entry.opens.map(item => `#${item.tag} → ${item.tables.join(', ')}`).join('; ')}` : '',
      status: result.status.get(entry.key)?.text || 'not selected',
    }));
    for (const { file, error } of fileErrors) items.push({ depth: 0, title: file, file, gate: '', opens: '', status: error });
    return { summary, items };
  }

  function markGatedSources(preview, gatedNames) {
    const copy = {};
    for (const [target, parts] of Object.entries(preview || {})) {
      copy[target] = !Array.isArray(parts) ? parts : parts.map(part => !part?.randomSources ? part
        : { ...part, randomSources: part.randomSources.map(source => gatedNames.includes(source) ? `${source} if opened` : source) });
    }
    return copy;
  }

  const api = { splitTags, checkWhen, splitWhen, entryKey, rollOrder, orderErrors, resolveGates, rollOrderView, markGatedSources, TAG_RE };
  root.SecretGates = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
