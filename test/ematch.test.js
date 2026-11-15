import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EGraph, parseTerm, parsePattern, search, lookupPattern, instantiate } from '../src/index.js';
import { rng, randomArith } from './helpers.js';

const T = parseTerm;

test('finds simple and nonlinear matches', () => {
  const eg = new EGraph();
  eg.addTerm(T('(+ (* x 2) (* x x))'));
  const lin = search(eg, '(* ?a ?b)');
  assert.equal(lin.total, 2);
  const nonlinear = search(eg, '(* ?a ?a)');
  assert.equal(nonlinear.total, 1);
  const s = nonlinear[0].substs[0];
  assert.equal(s.get('a'), eg.lookupTerm(T('x')));
});

test('matching sees through unions', () => {
  const eg = new EGraph();
  eg.addTerm(T('(* a b)'));
  eg.union(eg.lookupTerm(T('a')), eg.lookupTerm(T('b')));
  eg.rebuild();
  assert.equal(search(eg, '(* ?x ?x)').total, 1);
});

test('one e-class can match many ways', () => {
  const eg = new EGraph();
  const p = eg.addTerm(T('(+ a b)'));
  const q = eg.addTerm(T('(+ b a)'));
  eg.union(p, q);
  eg.rebuild();
  const res = search(eg, '(+ ?x ?y)');
  assert.equal(res.length, 1);
  assert.equal(res[0].substs.length, 2);
});

test('limit truncates the result', () => {
  const eg = new EGraph();
  for (let i = 0; i < 10; i++) eg.addTerm(T(`(f c${i})`));
  const res = search(eg, '(f ?x)', 4);
  assert.equal(res.total, 4);
  assert.ok(res.truncated);
});

test('instantiate inserts, lookupPattern does not', () => {
  const eg = new EGraph();
  const x = eg.addTerm(T('x'));
  const s = new Map([['a', x]]);
  assert.equal(lookupPattern(eg, '(g ?a)', s), null);
  const id = instantiate(eg, '(g ?a)', s);
  assert.equal(lookupPattern(eg, '(g ?a)', s), id);
});

// Oracle: enumerate every assignment of pattern variables to e-classes and
// keep those under which the instantiated pattern already exists. That set
// must equal what the matcher returns, exactly.
function bruteForce(eg, pat, vars) {
  const ids = [...eg.classes.keys()];
  const out = new Set();
  const rec = (i, s) => {
    if (i === vars.length) {
      const c = lookupPattern(eg, pat, s);
      if (c !== null) out.add(c + ':' + vars.map((v) => s.get(v)).join(','));
      return;
    }
    for (const id of ids) rec(i + 1, new Map(s).set(vars[i], id));
  };
  rec(0, new Map());
  return out;
}

test('matcher is sound and complete against brute force', () => {
  const patterns = [
    ['(+ ?a ?b)', ['a', 'b']],
    ['(* ?a (+ ?b ?c))', ['a', 'b', 'c']],
    ['(+ ?a ?a)', ['a']],
    ['(* (+ ?a ?b) ?a)', ['a', 'b']],
    ['(- ?a 1)', ['a']],
  ];
  for (let seed = 1; seed <= 25; seed++) {
    const r = rng(seed);
    const eg = new EGraph();
    const roots = [];
    for (let i = 0; i < 4; i++) roots.push(eg.addTerm(randomArith(r, 3)));
    for (let k = 0; k < 3; k++) {
      const ids = [...eg.classes.keys()];
      eg.union(ids[Math.floor(r() * ids.length)], ids[Math.floor(r() * ids.length)]);
    }
    eg.rebuild();
    if (eg.classCount > 30) continue; // keep the brute force cheap
    for (const [src, vars] of patterns) {
      const pat = parsePattern(src);
      const got = new Set();
      for (const { eclass, substs } of search(eg, pat)) {
        for (const s of substs) got.add(eclass + ':' + vars.map((v) => s.get(v)).join(','));
      }
      assert.deepEqual(got, bruteForce(eg, pat, vars), `seed ${seed}, ${src}`);
    }
  }
});
