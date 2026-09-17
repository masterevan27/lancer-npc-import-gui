const test = require('node:test');
const assert = require('node:assert/strict');
const gates = require('../public/secret-gates');

/*
 * The gate rules shared by the Create form, the roll order panel and the
 * server's validateSelection. They mirror generate-npc.py's
 * load_extra_tables()/roll_extra() and must produce the same refusal texts
 * (see test/test_extra_table_gates.py in lancer-art-generator).
 */

const STYLES = {
    file: 'styles.md',
    tables: [
        { name: 'Styles', count: 3, values: ['Rugged dockworker', 'Sharp-suited broker', 'Elegant courtesan'],
            tags: { 'Rugged dockworker': ['man'], 'Sharp-suited broker': ['man'], 'Elegant courtesan': ['woman', 'noble'] } },
        { name: "Men's Attributes", count: 2, values: ['heavy stubble', 'broad shoulders'], when: ['man'],
            tags: { 'heavy stubble': ['scarred'] } },
        { name: 'Scars', count: 1, values: ['a burn scar across one cheek'], when: ['scarred'] },
        { name: 'Jewellery', count: 1, values: ['a thin gold circlet'], when: ['woman', 'noble'] },
    ],
};
const TWO = { file: 'two.md', tables: [
    { name: 'A', count: 2, values: ['a', 'c'], tags: { a: ['m'] } },
    { name: 'B', count: 1, values: ['b'], tags: { b: ['m'] } },
    { name: 'G', count: 1, values: ['g'], when: ['m'] },
] };
const key = (name, file = 'styles.md') => gates.entryKey(file, name);
const picks = (entries, file = 'styles.md') => new Map(Object.entries(entries).map(([name, value]) => [key(name, file), value]));
const ALL = { Styles: '', "Men's Attributes": '', Scars: '', Jewellery: '' };

test('trailing tags are split off and lower-cased; other hashes are text', () => {
    assert.deepEqual(gates.splitTags('Rugged dockworker #man #Noble'), { value: 'Rugged dockworker', tags: ['man', 'noble'] });
    assert.deepEqual(gates.splitTags('a #3 jersey worn loose'), { value: 'a #3 jersey worn loose', tags: [] });
    assert.deepEqual(gates.splitTags('#man'), { value: '#man', tags: [] });
    assert.deepEqual(gates.splitTags('a value#man'), { value: 'a value#man', tags: [] });
    assert.deepEqual(gates.splitTags('a #x #x'), { value: 'a', tags: ['x'] });
});

test('a when suffix is split off a heading with the generator texts', () => {
    assert.deepEqual(gates.splitWhen("Men's Attributes (when: man, Noble)"), { name: "Men's Attributes", when: ['man', 'noble'] });
    assert.deepEqual(gates.splitWhen('Styles'), { name: 'Styles', when: null });
    assert.throws(() => gates.splitWhen('T (when: )'), { message: "table 'T' has an empty (when:)" });
    assert.throws(() => gates.splitWhen('T (when: a, )'), { message: "table 'T' has an empty entry in (when:)" });
    assert.throws(() => gates.splitWhen('T (when: a b)'), { message: "table 'T': 'a b' is not a tag (letters, digits, - and _)" });
    assert.throws(() => gates.checkWhen('T', []), { message: "table 'T' has an empty (when:)" });
});

test('roll order lists tables in file order with depth, openers and what each opens', () => {
    const order = gates.rollOrder([STYLES, { file: 'bad.md', tables: [], error: 'nope' }]);
    assert.deepEqual(order.map(e => [e.name, e.depth]), [['Styles', 0], ["Men's Attributes", 1], ['Scars', 2], ['Jewellery', 1]]);
    assert.deepEqual(order[3].openers, [{ file: 'styles.md', name: 'Styles', tags: ['woman', 'noble'] }]);
    assert.deepEqual(order[0].opens, [{ tag: 'man', tables: ["Men's Attributes"] }, { tag: 'woman', tables: ['Jewellery'] }, { tag: 'noble', tables: ['Jewellery'] }]);
    assert.deepEqual(order[1].rows, [{ value: 'heavy stubble', tags: ['scarred'] }, { value: 'broad shoulders', tags: [] }]);
});

test('a table value named like an Object property has no tags', () => {
    const order = gates.rollOrder([{ file: 'x.md', tables: [{ name: 'T', count: 1, values: ['constructor'] }] }]);
    assert.deepEqual(order[0].rows, [{ value: 'constructor', tags: [] }]);
});

test('order errors: a gate above its opener, and a tag nothing in the folder carries', () => {
    const errors = gates.orderErrors([
        { file: 'a.md', tables: [{ name: 'G', count: 1, values: ['b'], when: ['m'] }] },
        { file: 'b.md', tables: [{ name: 'S', count: 1, values: ['a'], tags: { a: ['m'] } }, { name: 'H', count: 1, values: ['h'], when: ['zzz'] }] },
    ]);
    assert.equal(errors.get('a.md'), "gated table 'G' comes before 'S', the table that opens it (when: m)");
    assert.equal(errors.get('b.md'), "gated table 'H' has no table in the folder carrying its tags (when: zzz)");
    assert.equal(gates.orderErrors([STYLES]).size, 0);
});

test('with everything Random, gated tables may roll and say what opens them', () => {
    const { error, status } = gates.resolveGates(gates.rollOrder([STYLES]), picks(ALL));
    assert.equal(error, null);
    assert.deepEqual(status.get(key('Styles')), { state: 'rolls', text: 'rolls', limited: false });
    assert.deepEqual(status.get(key("Men's Attributes")), { state: 'maybe', text: 'rolls only if Styles rolls #man', limited: false });
    assert.deepEqual(status.get(key('Scars')), { state: 'maybe', text: "rolls only if Men's Attributes rolls #scarred", limited: false });
    assert.deepEqual(status.get(key('Jewellery')), { state: 'maybe', text: 'rolls only if Styles rolls #woman or #noble', limited: false });
});

test('a fixed opener opens its gates and closes the others', () => {
    const { error, status } = gates.resolveGates(gates.rollOrder([STYLES]), picks({ ...ALL, Styles: 'Sharp-suited broker' }));
    assert.equal(error, null);
    assert.equal(status.get(key("Men's Attributes")).state, 'rolls');
    assert.deepEqual(status.get(key('Jewellery')), { state: 'closed', limited: false,
        text: "closed — 'Styles' is fixed to 'Sharp-suited broker', which is not #woman or #noble" });
});

test('unticked tables are not selected and open nothing', () => {
    const { status } = gates.resolveGates(gates.rollOrder([STYLES]), picks({ "Men's Attributes": '' }));
    assert.deepEqual(status.get(key('Styles')), { state: 'unselected', text: 'not selected', limited: false });
    assert.deepEqual(status.get(key("Men's Attributes")), { state: 'closed', limited: false,
        text: 'closed — nothing selected can open it (when: man)' });
});

test('a fixed gated value limits its single Random opener, through a chain', () => {
    const { error, status } = gates.resolveGates(gates.rollOrder([STYLES]), picks({ ...ALL, Scars: 'a burn scar across one cheek' }));
    assert.equal(error, null);
    assert.deepEqual(status.get(key('Styles')), { state: 'rolls', limited: true, text: "rolls, limited to #man by 'Men's Attributes'" });
    assert.deepEqual(status.get(key("Men's Attributes")), { state: 'rolls', limited: true,
        text: "rolls, limited to #scarred by 'Scars'; limits 'Styles' to #man" });
    assert.deepEqual(status.get(key('Scars')), { state: 'rolls', limited: false, text: "rolls; limits 'Men's Attributes' to #scarred" });
    assert.equal(status.get(key('Jewellery')).state, 'closed');
});

test('impossible selections carry the generator refusal texts', () => {
    const order = gates.rollOrder([STYLES]);
    const cases = [
        [{ Styles: 'Elegant courtesan', "Men's Attributes": 'broad shoulders' },
            "extra table 'Men's Attributes' has a fixed value but 'Styles' is fixed to 'Elegant courtesan', which is not #man"],
        [{ "Men's Attributes": 'broad shoulders' },
            "extra table 'Men's Attributes' has a fixed value but nothing selected can open it (when: man)"],
        [{ ...ALL, "Men's Attributes": 'broad shoulders', Jewellery: 'a thin gold circlet' },
            "extra table 'Jewellery' has a fixed value but 'Styles' is already limited to #man by 'Men's Attributes'"],
    ];
    for (const [selection, message] of cases) {
        assert.equal(gates.resolveGates(order, picks(selection)).error, message);
    }
    assert.equal(gates.resolveGates(gates.rollOrder([TWO]), picks({ A: '', B: '', G: 'g' }, 'two.md')).error,
        "extra table 'G' has a fixed value but 'A' and 'B' could each open it (when: m); fix or untick all but one");
    assert.equal(gates.resolveGates(gates.rollOrder([TWO]), picks({ A: 'a', B: '', G: 'g' }, 'two.md')).error, null);
});

test('in the form, a fixed gated table nothing can open is closed rather than refused', () => {
    const order = gates.rollOrder([STYLES]);
    const shut = gates.resolveGates(order, picks({ Styles: 'Elegant courtesan', "Men's Attributes": 'broad shoulders' }), { dropClosed: true });
    assert.equal(shut.error, null);
    assert.deepEqual(shut.status.get(key("Men's Attributes")), { state: 'closed', limited: false,
        text: "closed — 'Styles' is fixed to 'Elegant courtesan', which is not #man" });
    const chained = gates.resolveGates(order, picks({ Styles: 'Elegant courtesan', "Men's Attributes": '', Scars: 'a burn scar across one cheek' }), { dropClosed: true });
    assert.equal(chained.error, null);
    assert.equal(chained.status.get(key('Scars')).text, "closed — 'Men's Attributes' is closed");
    const conflict = gates.resolveGates(order, picks({ ...ALL, "Men's Attributes": 'broad shoulders', Jewellery: 'a thin gold circlet' }), { dropClosed: true });
    assert.match(conflict.error, /already limited to #man/);
});

test('the roll order view summarises and describes every entry', () => {
    const order = gates.rollOrder([STYLES]);
    const result = gates.resolveGates(order, picks({ Styles: '', "Men's Attributes": '' }), { dropClosed: true });
    const view = gates.rollOrderView(order, result, [{ file: 'bad.md', error: 'not valid JSON' }]);
    assert.equal(view.summary, 'Roll order and gates (4 tables, 3 gated)');
    assert.deepEqual(view.items[0], { depth: 0, title: 'Styles', file: 'styles.md', gate: 'always',
        opens: "can open: #man → Men's Attributes; #woman → Jewellery; #noble → Jewellery", status: 'rolls' });
    assert.deepEqual(view.items[1], { depth: 1, title: "Men's Attributes", file: 'styles.md',
        gate: 'when: #man — opened by Styles (#man)', opens: 'can open: #scarred → Scars', status: 'rolls only if Styles rolls #man' });
    assert.equal(view.items[2].status, 'not selected');
    assert.deepEqual(view.items[4], { depth: 0, title: 'bad.md', file: 'bad.md', gate: '', opens: '', status: 'not valid JSON' });
    assert.equal(gates.rollOrderView([], gates.resolveGates([], new Map()), []).summary, 'Roll order and gates (no tables)');
});

test('preview sources of gated tables are marked as conditional', () => {
    const preview = { portrait: [{ id: 'extra:G', randomSources: ['G'] }, { id: 'shot', randomSources: ['Backdrop'] }, { id: 'x' }], token: [] };
    const marked = gates.markGatedSources(preview, ['G']);
    assert.deepEqual(marked.portrait[0].randomSources, ['G if opened']);
    assert.deepEqual(marked.portrait[1].randomSources, ['Backdrop']);
    assert.deepEqual(marked.portrait[2], { id: 'x' });
    assert.deepEqual(preview.portrait[0].randomSources, ['G']);
});
