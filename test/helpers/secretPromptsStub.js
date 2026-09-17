/**
 * A Node script standing in for generate-npc.py in the secret prompt tests.
 * Echoes its argv (so a create's command line can be asserted on), answers
 * --prompt-preview with fragments, and answers --list-secret-prompts by
 * reading each --secret-prompts file: a '## Name' line is a template, and a
 * file whose first line is 'broken' is listed with an error. The comment
 * block carries the constants lib/overrideTables.js scrapes.
 */
const STUB = [
    '/*',
    'REQUIRED_TABLES = [',
    '    "Pronouns", "Age", "Gear",',
    ']',
    'REROLLABLE_TRAITS = ("Gear",)',
    'RAW_REROLLABLE_TRAITS = tuple(t for t in REQUIRED_TABLES if t not in ("Pronouns"))',
    'DISABLEABLE_TABLES = (',
    '    "Stance", "Gear",',
    ')',
    '*/',
    'const fs = require("fs"), path = require("path");',
    'const argv = process.argv.slice(2);',
    'if (argv.includes("--list-secret-prompts")) {',
    '  const files = argv.flatMap((a, i) => a === "--secret-prompts" ? [argv[i + 1]] : []);',
    '  console.log(JSON.stringify({ dir: path.dirname(files[0]), files: files.map(file => {',
    '    const text = fs.readFileSync(file, "utf8");',
    '    if (text.startsWith("broken")) return { file: path.basename(file), error: `${path.basename(file)}, line 1: broken on purpose` };',
    '    const templates = [...text.matchAll(/^## (.+)$/gm)].map(m => ({ name: m[1], weight: 1,',
    '      pins: { Pronouns: "she/her" }, npcSlots: ["identity"], secretSlots: ["Poses", "Clothing"] }));',
    '    return { file: path.basename(file), templates };',
    '  }) }));',
    '} else if (argv.includes("--prompt-preview")) {',
    '  console.log(JSON.stringify({ portrait: [{ id: "npc:identity", text: "a mechanic", sources: ["Role"], randomSources: ["Role"] },',
    '    { id: "secret:Poses", text: " kneeling", sources: ["Poses"], randomSources: ["Poses"] }], token: [], argv }));',
    '} else console.log(argv.join(" "));',
].join('\n');

module.exports = { STUB };
