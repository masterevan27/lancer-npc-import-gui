const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_EXPRESSION_LABELS,
    sanitizeExpressionLabel,
    classifyExpressionFiles,
    expressionArgs,
} = require('../lib/expressions');

test('expression labels match the generator declaration and sanitize to flat sprite labels', () => {
    assert.deepEqual(DEFAULT_EXPRESSION_LABELS, [
        'admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring',
        'confusion', 'curiosity', 'desire', 'disappointment', 'disapproval',
        'disgust', 'embarrassment', 'excitement', 'fear', 'gratitude', 'grief',
        'joy', 'love', 'nervousness', 'neutral', 'optimism', 'pride',
        'realization', 'relief', 'remorse', 'sadness', 'surprise',
    ]);
    assert.equal(sanitizeExpressionLabel('  Happy / Now!  '), 'happy_now');
    assert.throws(() => sanitizeExpressionLabel(' / ! '), /empty/i);
});

test('expression file classifier groups only safe webp sprite suffix forms in natural order', () => {
    assert.deepEqual(classifyExpressionFiles([
        'joy.webp', 'joy-2.webp', 'joy-1.webp', 'joy.soft.webp',
        'expressions.json', 'joy.png', '../joy.webp', 'Joy.webp', 'joy-.webp',
    ]), {
        joy: ['joy.webp', 'joy-1.webp', 'joy-2.webp', 'joy.soft.webp'],
    });
});

test('expression argv carries configured source and tables paths with every supported option', () => {
    assert.deepEqual(expressionArgs({
        script: 'g.py', id: 'npc-7', manifest: 'manifest.json', tables: 'expressions.md',
        labels: ['joy', 'Battle Focus'],
        custom: [{ label: 'Battle Focus', text: 'grim resolve' }, { label: 'quiet awe' }],
        count: 2, mode: 'replace', keepBackground: true, server: '127.0.0.1:8000',
    }), [
        'g.py', '--id', 'npc-7', '--manifest', 'manifest.json', '--tables', 'expressions.md',
        '-e', 'joy,battle_focus', '--custom', 'battle_focus=grim resolve', '--custom', 'quiet_awe',
        '--count', '2', '--replace', '--keep-background', '--server', '127.0.0.1:8000',
    ]);
});

test('expression argv rejects unsafe file redo and invalid run options', () => {
    const base = { script: 'g.py', id: 'npc-7' };
    assert.deepEqual(expressionArgs({ ...base, labels: ['joy'], count: 2, mode: 'replace' }),
        ['g.py', '--id', 'npc-7', '-e', 'joy', '--count', '2', '--replace']);
    assert.throws(() => expressionArgs({ ...base, file: '../joy.webp' }), /safe .*webp/i);
    assert.throws(() => expressionArgs({ ...base, count: 0 }), /count/i);
    assert.throws(() => expressionArgs({ ...base, mode: 'overwrite' }), /mode/i);
    assert.throws(() => expressionArgs({ ...base, custom: [{ label: ' / ! ' }] }), /empty/i);
    for (const custom of [{}, { label: null }, { label: 42 }]) {
        assert.throws(() => expressionArgs({ ...base, custom: [custom] }), /label.*string/i);
    }
});
