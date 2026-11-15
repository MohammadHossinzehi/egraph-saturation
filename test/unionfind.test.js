import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UnionFind } from '../src/index.js';
import { rng } from './helpers.js';

test('agrees with a naive labelling on random unions', () => {
  const r = rng(7);
  const uf = new UnionFind();
  const n = 200;
  const label = [];
  for (let i = 0; i < n; i++) { uf.makeSet(); label.push(i); }
  for (let k = 0; k < 400; k++) {
    const a = Math.floor(r() * n), b = Math.floor(r() * n);
    const merged = uf.union(a, b);
    const la = label[a], lb = label[b];
    assert.equal(merged !== null, la !== lb);
    if (la !== lb) for (let i = 0; i < n; i++) if (label[i] === lb) label[i] = la;
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j += 7) {
    assert.equal(uf.find(i) === uf.find(j), label[i] === label[j]);
  }
});
