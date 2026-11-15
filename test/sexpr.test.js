import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTerm, parsePattern, print, termSize, termDepth, ParseError } from '../src/index.js';

test('round trips terms and patterns', () => {
  for (const s of ['x', '42', '(+ x 1)', '(f (g a b) h -3)', '(<< (* a 2) 1)']) {
    assert.equal(print(parseTerm(s)), s);
  }
  assert.equal(print(parsePattern('(+ ?a (* ?b 0))')), '(+ ?a (* ?b 0))');
  assert.deepEqual(parsePattern('?x'), { var: 'x' });
});

test('terms treat ?x as an ordinary symbol, patterns do not', () => {
  assert.deepEqual(parseTerm('?x'), { op: '?x', children: [] });
});

test('comments and whitespace are ignored', () => {
  assert.equal(print(parseTerm('  (+ x ; a comment\n   1)  ')), '(+ x 1)');
});

test('size and depth', () => {
  const t = parseTerm('(+ (* x 1) 0)');
  assert.equal(termSize(t), 5);
  assert.equal(termDepth(t), 3);
});

test('reports malformed input', () => {
  for (const bad of ['', '(', ')', '(+ x', '(+ x) y', '((f) x)', '(?f x)']) {
    assert.throws(() => (bad === '(?f x)' ? parsePattern(bad) : parseTerm(bad)), ParseError, bad);
  }
});

test('a nullary application prints as a bare atom', () => {
  assert.equal(print(parseTerm('(h)')), 'h');
});
