(function (root) {
    'use strict';
    const key = entry => typeof entry === 'string' ? entry : entry.id;
    function ordered(parts, entries = []) {
        const remaining = new Map(parts.map(part => [part.id, part]));
        const result = [];
        for (const entry of entries) {
            if (typeof entry === 'object') result.push({ ...entry, value: entry.text, prefix: '', suffix: '', sources: [], custom: true });
            else if (remaining.has(entry)) { result.push(remaining.get(entry)); remaining.delete(entry); }
        }
        return [...result, ...remaining.values()];
    }
    function display(part) {
        return part.randomSources?.length
            ? `${part.prefix || ''}[Random value from ${part.randomSources.join(' + ')}]${part.suffix || ''}`
            : part.text;
    }
    function join(parts, customized) {
        if (!customized) return parts.map(display).join('');
        let text = '';
        for (const part of parts) {
            const value = display(part);
            if (!value) continue;
            if (text && !/\s$/.test(text) && !/^[\s,.;:!?]/.test(value)) text += ' ';
            text += value;
        }
        return text.trim();
    }
    function move(entries, parts, id, before) {
        const full = [...entries];
        for (const part of parts) if (!full.some(entry => key(entry) === part.id)) full.push(part.id);
        const index = full.findIndex(entry => key(entry) === id);
        if (index < 0 || id === before) return full;
        const [item] = full.splice(index, 1);
        const destination = full.findIndex(entry => key(entry) === before);
        full.splice(destination < 0 ? full.length : destination, 0, item);
        return full;
    }
    function create({ element, getRequest, request, active, locked = () => false }) {
        let layout = {}, data = { portrait: [], token: [] }, target = 'portrait';
        let timer, revision = 0, signature = '', dragging = null, ready = false;
        const query = selector => element.querySelector(selector);
        const list = query('[data-composer-pills]');
        const status = query('[data-composer-status]');
        const prose = query('[data-composer-prose]');
        const label = () => target === 'portrait' ? 'Portrait' : 'Token';
        function visible() { return locked() ? data[target] : ordered(data[target], layout[target]); }
        function updateProse() {
            const parts = visible();
            prose.textContent = join(parts, !!layout[target]?.length && !locked());
        }
        function changed() { updateProse(); }
        function movePart(id, before) {
            layout[target] = move(layout[target] || [], data[target], id, before);
            render();
            const handle = [...list.querySelectorAll('[data-handle]')].find(node => node.dataset.handle === id);
            handle?.focus();
            status.textContent = `${label()} snippet moved. Save a Secret preset to keep this arrangement.`;
        }
        function button(text, title, action) {
            const node = document.createElement('button'); node.type = 'button';
            node.textContent = text; node.title = title; node.setAttribute('aria-label', title);
            node.addEventListener('click', action);
            return node;
        }
        function render() {
            const fixed = locked();
            list.replaceChildren();
            const parts = visible();
            for (const [index, part] of parts.entries()) {
                const card = document.createElement('div');
                card.className = 'prompt-pill' + (part.custom ? ' prompt-pill-custom' : part.sources.length ? ' prompt-pill-table' : ' prompt-pill-prose');
                card.setAttribute('role', 'listitem');
                card.dataset.partId = part.id;
                const source = part.custom ? 'Your text' : part.sources.join(' + ') || 'Prompt text';
                let hue = 0;
                for (const letter of source) hue = (hue * 31 + letter.charCodeAt(0)) % 360;
                card.style.setProperty('--pill-hue', hue);
                const header = document.createElement('div'); header.className = 'prompt-pill-header';
                const caption = document.createElement('span'); caption.textContent = source;
                if (fixed) {
                    header.append(caption);
                } else {
                    const handle = button('⠿', `Move ${source}; use left and right arrow keys`, () => {});
                    handle.dataset.handle = part.id; handle.draggable = true;
                    handle.addEventListener('dragstart', event => {
                        dragging = part.id; event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', part.id); card.classList.add('dragging');
                    });
                    handle.addEventListener('dragend', () => { dragging = null; card.classList.remove('dragging'); });
                    handle.addEventListener('keydown', event => {
                        if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); movePart(part.id, parts[index - 1].id); }
                        if (event.key === 'ArrowRight' && index < parts.length - 1) { event.preventDefault(); movePart(part.id, parts[index + 2]?.id); }
                    });
                    const previous = button('←', `Move ${source} earlier`, () => movePart(part.id, parts[index - 1]?.id));
                    const next = button('→', `Move ${source} later`, () => movePart(part.id, parts[index + 2]?.id));
                    previous.disabled = index === 0; next.disabled = index === parts.length - 1;
                    header.append(handle, caption, previous, next);
                }
                card.append(header);
                if (part.custom) {
                    const input = document.createElement('textarea'); input.value = part.text;
                    input.maxLength = 4000; input.rows = 2; input.placeholder = 'Write your prompt text…';
                    input.setAttribute('aria-label', 'Custom prompt text');
                    input.addEventListener('input', () => {
                        layout[target].find(entry => key(entry) === part.id).text = input.value; changed();
                    });
                    card.append(input, button('Remove', 'Remove custom text', () => {
                        layout[target] = layout[target].filter(entry => key(entry) !== part.id); render();
                    }));
                } else {
                    const text = document.createElement('span'); text.className = 'prompt-pill-value';
                    text.textContent = display(part); card.append(text);
                }
                if (!fixed) {
                    card.addEventListener('dragover', event => { if (dragging) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
                    card.addEventListener('drop', event => {
                        if (!dragging) return;
                        event.preventDefault(); event.stopPropagation(); movePart(dragging, part.id); dragging = null;
                    });
                }
                list.append(card);
            }
            query('[data-composer-reset]').textContent = `Reset ${label().toLowerCase()}`;
            query('[data-composer-add]').disabled = !ready || fixed;
            query('[data-composer-reset]').disabled = !ready || fixed;
            updateProse();
        }
        async function refresh(epoch) {
            if (!active()) return;
            const body = getRequest();
            const nextSignature = JSON.stringify(body);
            if (signature === nextSignature && ready) { element.setAttribute('aria-busy', 'false'); return; }
            status.textContent = 'Updating prompt preview…';
            element.setAttribute('aria-busy', 'true');
            try {
                const result = await request(body);
                if (epoch !== revision || !active()) return;
                data = result; signature = nextSignature; ready = true; render();
                status.textContent = locked()
                    ? 'Secret prompt selected: the template fixes the order. Random values resolve when you generate.'
                    : 'Preview updated. Random values resolve when you generate; conditional snippets may change with the roll.';
            } catch (error) {
                if (epoch !== revision || !active()) return;
                ready = false; list.replaceChildren(); prose.textContent = '';
                query('[data-composer-add]').disabled = true;
                query('[data-composer-reset]').disabled = true;
                status.textContent = `Could not preview prompts: ${error.message}`;
            } finally { if (epoch === revision) element.setAttribute('aria-busy', 'false'); }
        }
        function schedule() {
            clearTimeout(timer); const epoch = ++revision;
            if (!active()) return;
            element.hidden = false;
            timer = setTimeout(() => refresh(epoch), 250);
        }
        query('[data-composer-target]').addEventListener('change', event => { target = event.target.value; render(); });
        query('[data-composer-add]').addEventListener('click', () => {
            layout[target] ||= data[target].map(part => part.id);
            const id = root.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            layout[target].push({ id: 'custom:' + id, text: '' });
            render(); list.querySelectorAll('textarea')[list.querySelectorAll('textarea').length - 1]?.focus();
        });
        query('[data-composer-reset]').addEventListener('click', () => {
            delete layout[target]; render(); status.textContent = `${label()} restored to the generator’s order.`;
        });
        list.addEventListener('dragover', event => { if (dragging) event.preventDefault(); });
        list.addEventListener('drop', event => { if (dragging) { event.preventDefault(); movePart(dragging); dragging = null; } });
        const form = element.closest('.create-form');
        for (const type of ['input', 'change', 'click']) form.addEventListener(type, event => {
            if (!element.contains(event.target)) schedule();
        });
        const overrides = document.getElementById('override-rows');
        if (overrides) new MutationObserver(schedule).observe(overrides, { childList: true, subtree: true });
        schedule();
        return {
            getLayout: () => locked() ? {} : JSON.parse(JSON.stringify(layout)),
            setLayout(value) { layout = JSON.parse(JSON.stringify(value || {})); render(); signature = ''; schedule(); },
            refresh: schedule,
            clear() {
                clearTimeout(timer); revision += 1; layout = {}; data = { portrait: [], token: [] }; ready = false; signature = '';
                list.replaceChildren(); prose.textContent = ''; status.textContent = ''; element.hidden = true;
            },
        };
    }
    const api = { ordered, display, join, move, create };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.PromptComposer = api;
})(typeof window === 'undefined' ? globalThis : window);
