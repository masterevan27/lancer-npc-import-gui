const createPresets = require('./createPresets');
const secretTables = require('./secretTables');

const KIND = 'secret-create-form';

function normaliseSettings(raw, listing, overrideData) {
    const base = createPresets.normaliseSettings(raw);
    if (!base.ok) throw new Error(base.error);
    for (const override of base.settings.overrides) {
        if (!overrideData.tables.includes(override.table)) throw new Error(`unknown table "${override.table}"`);
    }
    const selection = secretTables.validateSelection(raw, listing, overrideData.disableable);
    const settings = { ...base.settings, extraTables: selection.selected, disabledTables: selection.disabledTables };
    for (const key of ['artStyle', 'workflow', 'colorGuidance']) {
        const value = raw[key] ?? 'default';
        if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string`);
        settings[key] = value;
    }
    return settings;
}

module.exports = { KIND, normaliseSettings };
