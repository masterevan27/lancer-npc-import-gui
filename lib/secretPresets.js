const createPresets = require('./createPresets');
const secretTables = require('./secretTables');
const secretPrompts = require('./secretPrompts');
const { normaliseDimensions } = require('./imageDimensions');
const { normaliseLayout } = require('./promptComposer');

const KIND = 'secret-create-form';

function normaliseSettings(raw, listing, overrideData, { checkGates = true } = {}) {
    const base = createPresets.normaliseSettings(raw);
    if (!base.ok) throw new Error(base.error);
    for (const override of base.settings.overrides) {
        if (!overrideData.tables.includes(override.table)) throw new Error(`unknown table "${override.table}"`);
    }
    const selection = secretTables.validateSelection(raw, listing, overrideData.disableable, { checkGates });
    const settings = { ...base.settings, ...normaliseDimensions(raw), extraTables: selection.selected, disabledTables: selection.disabledTables };
    if (raw.promptLayout != null) settings.promptLayout = normaliseLayout(raw.promptLayout);
    const secretPrompt = secretPrompts.normaliseSelection(raw.secretPrompt);
    if (secretPrompt) settings.secretPrompt = secretPrompt;
    for (const key of ['artStyle', 'workflow', 'colorGuidance']) {
        const value = raw[key] ?? 'default';
        if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string`);
        settings[key] = value;
    }
    return settings;
}

module.exports = { KIND, normaliseSettings };
