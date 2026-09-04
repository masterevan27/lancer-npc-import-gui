const test = require('node:test');
const assert = require('node:assert/strict');
const { subjectsFrom } = require('../lib/pronouns');

const TABLES = [
    '## Pronouns',
    '',
    '<!-- Subject/object/possessive/noun; the script splits on the slashes. -->',
    '',
    '- she/her/her/woman',
    '- he/him/his/man',
    '',
    '## Gear',
    '- a battered data-slate',
    '',
].join('\n');

test('subjectsFrom reads the subject field of every Pronouns bullet', () => {
    assert.deepEqual(subjectsFrom(TABLES), ['she', 'he']);
});

test('subjectsFrom does not offer they, which the generator removed', () => {
    // The generator dropped they/them/their/person deliberately - the noun
    // "person" was not a strong enough signal and renders came back
    // androgynous. The GUI kept offering it long after it stopped working.
    assert.ok(!subjectsFrom(TABLES).includes('they'));
});

test('subjectsFrom picks up a pronoun set added to the table later', () => {
    const extended = TABLES.replace('- he/him/his/man', '- he/him/his/man\n- xe/xem/xyr/person');
    assert.deepEqual(subjectsFrom(extended), ['she', 'he', 'xe']);
});

test('subjectsFrom tolerates a three-field bullet', () => {
    // Dropping the fourth field is supported: the noun is inferred.
    assert.deepEqual(subjectsFrom('## Pronouns\n- she/her/her\n'), ['she']);
});

test('subjectsFrom returns an empty list when there is no Pronouns table', () => {
    assert.deepEqual(subjectsFrom('## Gear\n- a thermos\n'), []);
});

test('subjectsFrom ignores a disabled bullet', () => {
    // The Tables tab comments bullets out to disable them; a disabled pronoun
    // set is one the generator will not roll, so the GUI must not offer it.
    const withDisabled = TABLES.replace('- he/him/his/man', '<!-- - he/him/his/man -->');
    assert.deepEqual(subjectsFrom(withDisabled), ['she']);
});
