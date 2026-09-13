const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_JS = path.join(__dirname, '..', 'public', 'app.js');

function extractSource(js, name) {
    const start = js.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `app.js no longer defines ${name}`);
    let depth = 0;
    for (let i = js.indexOf('{', start); i < js.length; i += 1) {
        if (js[i] === '{') depth += 1;
        if (js[i] === '}' && --depth === 0) return js.slice(start, i + 1);
    }
    throw new Error(`could not find the end of ${name}`);
}

function chanceCell() {
    return {
        className: '', textContent: '', title: '',
        classList: { add() {} },
    };
}

test('expression descriptions show exact enabled-weight chances while edits are pending', () => {
    const js = fs.readFileSync(APP_JS, 'utf8');
    const cells = [chanceCell(), chanceCell(), chanceCell()];
    const table = {
        name: 'Joy',
        bullets: [
            { text: 'a quiet smile', weight: 1, enabled: true },
            { text: 'a bright grin', weight: 1, pendingWeight: 3, enabled: true },
            { text: 'laughing openly', weight: 9, enabled: false },
        ],
    };
    const tablesState = {
        kind: 'expression',
        capabilities: { chances: true, odds: false },
        tables: [table],
        selectedTable: 'Joy',
        odds: null,
        oddsStale: false,
    };
    const elTables = {
        chanceNote: { hidden: false },
        bulletList: { querySelectorAll: () => cells },
    };
    let noted = null;
    const names = ['tablesState', 'elTables', 'groupEntryShare', 'renderChanceNote'];
    const source = [
        extractSource(js, 'effectiveWeight'),
        extractSource(js, 'weightShare'),
        extractSource(js, 'formatChance'),
        extractSource(js, 'renderChances'),
        'return renderChances;',
    ].join('\n');
    // eslint-disable-next-line no-new-func
    const renderChances = new Function(...names, source)(
        tablesState, elTables, () => 1, (selected) => { noted = selected; },
    );

    renderChances();

    assert.deepEqual(cells.map((cell) => cell.textContent), ['25%', '75%', '—']);
    assert.doesNotMatch(cells[0].textContent, /^~/, 'an exact expression probability is not an estimate');
    assert.match(cells[0].title, /when Joy is requested/i);
    assert.equal(noted, table);
});
