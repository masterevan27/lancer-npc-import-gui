const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

for (const ship of [false, true]) {
    test(`${ship ? 'ship' : 'NPC'} requests carry the applied preset, independently of the picker`, () => {
        const controls = Object.fromEntries(['count', 'seed', 'name', 'pronouns', 'server',
            'portrait', 'token', 'keepRaw', 'unarmed', 'presetSelect'].map(key => [key, { value: '', checked: true }]));
        controls.count.value = '1';
        controls.presetSelect.value = 'some-other-preset';
        const state = { presetName: 'Dock crew', overrides: [], pinned: {} };
        const functionName = ship ? 'shipCreateRequestBody' : 'createRequestBody';
        const endName = ship ? 'startShipCreateJob' : 'startCreateJob';
        const implementation = source.slice(source.indexOf(`function ${functionName}(`), source.indexOf(`async function ${endName}(`));
        const request = new Function(ship ? 'elShipCreate' : 'elCreate', ship ? 'shipCreateState' : 'createState',
            'SHIP_PINNED_TABLES', `${implementation}; return ${functionName};`)(controls, state, []);
        assert.equal(request(false).presetName, 'Dock crew');
        state.presetName = '';
        assert.equal(request(false).presetName, undefined, 'picking without loading must not label an image');
    });
}
