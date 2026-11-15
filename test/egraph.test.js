import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EGraph, parseTerm, UnionFind } from '../src/index.js';
import { rng } from './helpers.js';

const T = parseTerm;

test('hashconsing shares identical subterms', () => {
  const eg = new EGraph();
  const a = eg.addTerm(T('(+ (f x) (f x))'));
  assert.equal(eg.classCount, 3);
  assert.equal(eg.addTerm(T('(f x)')), eg.lookupTerm(T('(f x)')));
  assert.equal(eg.lookupTerm(T('(+ (f x) (f x))')), a);
  assert.equal(eg.lookupTerm(T('(g x)')), null);
});

test('union then rebuild restores congruence', () => {
  const eg = new EGraph();
  const fa = eg.addTerm(T('(f a)'));
  const fb = eg.addTerm(T('(f b)'));
  assert.ok(!eg.equiv(fa, fb));
  eg.union(eg.lookupTerm(T('a')), eg.lookupTerm(T('b')));
  eg.rebuild();
  assert.ok(eg.equiv(fa, fb));
  eg.checkInvariants();
});

test('classic congruence closure: f^3(a)=a and f^5(a)=a imply f(a)=a', () => {
  const eg = new EGraph();
  const a = eg.addTerm(T('a'));
  const f3 = eg.addTerm(T('(f (f (f a)))'));
  const f5 = eg.addTerm(T('(f (f (f (f (f a)))))'));
  const f1 = eg.lookupTerm(T('(f a)'));
  eg.union(f3, a);
  eg.union(f5, a);
  eg.rebuild();
  assert.ok(eg.equiv(f1, a));
  assert.equal(eg.classCount, 1);
  eg.checkInvariants();
});

test('upward merging cascades through deep terms', () => {
  const eg = new EGraph();
  const deep = (leafName) => {
    let t = T(leafName);
    for (let i = 0; i < 50; i++) t = { op: i % 2 ? 'g' : 'h', children: [t, T('k')] };
    return t;
  };
  const x = eg.addTerm(deep('x'));
  const y = eg.addTerm(deep('y'));
  eg.union(eg.lookupTerm(T('x')), eg.lookupTerm(T('y')));
  eg.rebuild();
  assert.ok(eg.equiv(x, y));
  eg.checkInvariants();
});

// Reference: naive congruence closure over the original e-nodes, iterated to
// a fixed point with an independent union-find.
function naiveClosure(nodes, unions) {
  const uf = new UnionFind();
  for (let i = 0; i < nodes.length; i++) uf.makeSet();
  for (const [a, b] of unions) uf.union(a, b);
  let changed = true;
  while (changed) {
    changed = false;
    const sig = new Map();
    nodes.forEach((n, i) => {
      const k = n.op + '|' + n.children.map((c) => uf.find(c)).join(',');
      if (sig.has(k)) { if (uf.union(sig.get(k), i)) changed = true; } else sig.set(k, i);
    });
  }
  return uf;
}

test('random unions match a naive congruence closure oracle', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed);
    const eg = new EGraph();
    const nodes = []; // index = id of the class it created
    const ops = ['f', 'g', 'h'];
    for (let i = 0; i < 40; i++) {
      let n;
      if (i < 5 || r() < 0.2) n = { op: 'c' + Math.floor(r() * 5), children: [] };
      else {
        const arity = 1 + Math.floor(r() * 2);
        n = { op: ops[Math.floor(r() * 3)], children: Array.from({ length: arity }, () => Math.floor(r() * nodes.length)) };
      }
      const before = eg.uf.length;
      const id = eg.add(n);
      if (eg.uf.length > before) nodes[id] = n; // fresh node
    }
    const ids = Object.keys(nodes).map(Number);
    const unions = [];
    for (let k = 0; k < 8; k++) {
      const a = ids[Math.floor(r() * ids.length)], b = ids[Math.floor(r() * ids.length)];
      unions.push([a, b]);
      eg.union(a, b);
      if (r() < 0.3) eg.rebuild(); // interleave rebuilds at random
    }
    eg.rebuild();
    eg.checkInvariants();

    // dense re-index of the oracle input
    const index = new Map(ids.map((id, i) => [id, i]));
    const dense = ids.map((id) => ({ op: nodes[id].op, children: nodes[id].children.map((c) => index.get(c)) }));
    const oracle = naiveClosure(dense, unions.map(([a, b]) => [index.get(a), index.get(b)]));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      assert.equal(eg.equiv(ids[i], ids[j]), oracle.find(i) === oracle.find(j), `seed ${seed}: ${ids[i]} vs ${ids[j]}`);
    }
  }
});

test('dot export mentions every class', () => {
  const eg = new EGraph();
  eg.addTerm(T('(+ x (* y 2))'));
  const dot = eg.toDot();
  assert.match(dot, /^digraph egraph/);
  for (const id of eg.classes.keys()) assert.ok(dot.includes(`cluster_${id}`));
});
