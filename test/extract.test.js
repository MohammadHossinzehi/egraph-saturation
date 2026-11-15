import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EGraph, Extractor, AstSize, AstDepth, opCost, parseTerm, print, termSize, runSaturation, arithRules, ConstantFolding } from '../src/index.js';
import { rng, randomArith } from './helpers.js';

const T = parseTerm;

test('extracts the smallest term from a cyclic class', () => {
  const eg = new EGraph();
  const big = eg.addTerm(T('(* x 1)'));
  eg.union(big, eg.lookupTerm(T('x'))); // x = x * 1: a self loop
  eg.rebuild();
  const ex = new Extractor(eg);
  assert.equal(print(ex.extract(big)), 'x');
  assert.equal(ex.costOf(big), 1);
});

test('custom op costs change the winner', () => {
  const eg = new EGraph();
  const mul = eg.addTerm(T('(* x 2)'));
  eg.union(mul, eg.addTerm(T('(<< x 1)')));
  eg.rebuild();
  assert.equal(print(new Extractor(eg, opCost({ '*': 4, '<<': 1 })).extract(mul)), '(<< x 1)');
  assert.equal(print(new Extractor(eg, opCost({ '*': 1, '<<': 4 })).extract(mul)), '(* x 2)');
});

test('depth cost prefers balanced trees', () => {
  const eg = new EGraph();
  const chain = eg.addTerm(T('(+ a (+ b (+ c d)))'));
  eg.union(chain, eg.addTerm(T('(+ (+ a b) (+ c d))')));
  eg.rebuild();
  assert.equal(print(new Extractor(eg, AstDepth).extract(chain)), '(+ (+ a b) (+ c d))');
});

// Independent formulation: with positive costs an optimal term never revisits
// a class on a root-to-leaf path, so a depth-indexed DP bounded by the class
// count gives the exact optimum.
function dpOptimum(eg, root) {
  const n = eg.classCount;
  let prev = new Map();
  for (let d = 1; d <= n; d++) {
    const cur = new Map();
    for (const [id, cls] of eg.classes) {
      let best = Infinity;
      for (const node of cls.nodes) {
        let c = 1;
        for (const ch of node.children) c += prev.get(eg.find(ch)) ?? Infinity;
        best = Math.min(best, c);
      }
      cur.set(id, best);
    }
    prev = cur;
  }
  return prev.get(eg.find(root));
}

test('fixed-point extraction matches a depth-indexed DP on saturated graphs', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const r = rng(seed);
    const eg = new EGraph(ConstantFolding);
    const root = eg.addTerm(randomArith(r, 3));
    runSaturation(eg, arithRules, { iterLimit: 4, nodeLimit: 600 });
    const ex = new Extractor(eg, AstSize);
    const t = ex.extract(root);
    assert.equal(ex.costOf(root), dpOptimum(eg, root), `seed ${seed}`);
    assert.equal(termSize(t), ex.costOf(root));
    assert.equal(eg.lookupTerm(t), eg.find(root), 'extracted term must live in the root class');
  }
});
