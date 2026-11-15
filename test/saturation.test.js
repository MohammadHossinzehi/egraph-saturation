import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EGraph, parseTerm, print, simplify, prove, rewrite, runSaturation, Extractor, opCost,
  arithRules, arithCost, boolRules, ConstantFolding, BackoffScheduler, SimpleScheduler,
} from '../src/index.js';
import { rng, randomArith, evalArith, randomBool, evalBool, rat } from './helpers.js';

const arith = (s, opts = {}) =>
  print(simplify(s, arithRules, { analysis: ConstantFolding, nodeLimit: 3000, ...opts }).term);

test('textbook simplifications', () => {
  assert.equal(arith('(+ (* x 1) 0)'), 'x');
  assert.equal(arith('(/ (* a 2) 2)'), 'a');
  assert.equal(arith('(- (+ a b) b)'), 'a');
  assert.equal(arith('(+ (* 3 4) (- y y))'), '12');
  assert.equal(arith('(* (- x x) (+ y z))'), '0');
});

test('strength reduction under a machine cost model', () => {
  assert.equal(arith('(* x 2)', { cost: opCost(arithCost) }), '(<< x 1)');
  assert.equal(arith('(* (<< y 2) 1)', { cost: opCost(arithCost) }), '(<< y 2)');
});

test('constant folding analysis tags classes with values', () => {
  const eg = new EGraph(ConstantFolding);
  const id = eg.addTerm(parseTerm('(+ (* 2 3) (<< 1 4))'));
  assert.equal(eg.data(id), 22n);
  assert.equal(eg.lookupTerm(parseTerm('22')), id);
});

test('contradictory constants are reported, not silently merged', () => {
  const eg = new EGraph(ConstantFolding);
  const bogus = rewrite('bogus', '(+ ?a ?b)', '?a');
  eg.addTerm(parseTerm('(+ 1 2)'));
  assert.throws(() => runSaturation(eg, [bogus]), /unsound rewrite/);
});

test('guards stop unsound rewrites', () => {
  // (/ x x) must not become 1: x may be zero.
  assert.equal(arith('(/ x x)'), '(/ x x)');
  assert.equal(arith('(/ 5 5)'), '1');
});

test('proves the binomial square', () => {
  const r = prove(
    '(* (+ a b) (+ a b))',
    '(+ (+ (* a a) (* 2 (* a b))) (* b b))',
    arithRules,
    { analysis: ConstantFolding, nodeLimit: 60000, iterLimit: 40, timeLimit: 30000 },
  );
  assert.ok(r.equal);
  assert.equal(r.report.stopReason, 'goal');
});

test('proves boolean identities', () => {
  const cases = [
    ['(not (and a (not b)))', '(or (not a) b)'],
    ['(or a (and a b))', 'a'],
    ['(and (or a b) (or a (not b)))', 'a'],
    ['(not (or (not a) (not b)))', '(and a b)'],
  ];
  for (const [x, y] of cases) assert.ok(prove(x, y, boolRules, { nodeLimit: 20000 }).equal, `${x} = ${y}`);
});

test('arith rules are sound: random terms keep their value', () => {
  const r = rng(2026);
  for (let i = 0; i < 60; i++) {
    const t = randomArith(r, 4);
    const out = simplify(t, arithRules, { analysis: ConstantFolding, iterLimit: 6, nodeLimit: 2500 }).term;
    for (let k = 0; k < 5; k++) {
      const env = { x: rat(Math.floor(r() * 21) - 10), y: rat(Math.floor(r() * 21) - 10), z: rat(Math.floor(r() * 21) - 10) };
      assert.deepEqual(evalArith(out, env), evalArith(t, env), `${print(t)} => ${print(out)}`);
    }
  }
});

test('every term in a saturated class has the same value', () => {
  // Stronger than checking the extracted term: sample several terms per class
  // by extracting under different random cost models.
  const r = rng(99);
  for (let i = 0; i < 15; i++) {
    const t = randomArith(r, 3);
    const eg = new EGraph(ConstantFolding);
    const root = eg.addTerm(t);
    runSaturation(eg, arithRules, { iterLimit: 5, nodeLimit: 2000 });
    const env = { x: rat(3), y: rat(-7), z: rat(5) };
    const want = evalArith(t, env);
    for (let k = 0; k < 6; k++) {
      const table = { '+': 1 + r() * 9, '-': 1 + r() * 9, '*': 1 + r() * 9, '/': 1 + r() * 9, '<<': 1 + r() * 9 };
      const alt = new Extractor(eg, opCost(table)).extract(root);
      assert.deepEqual(evalArith(alt, env), want, `${print(t)} vs ${print(alt)}`);
    }
  }
});

test('bool rules are sound: truth tables agree', () => {
  const r = rng(5);
  const envs = [];
  for (let m = 0; m < 8; m++) envs.push({ p: !!(m & 1), q: !!(m & 2), s: !!(m & 4) });
  for (let i = 0; i < 80; i++) {
    const t = randomBool(r, 4);
    const out = simplify(t, boolRules, { iterLimit: 6, nodeLimit: 3000 }).term;
    for (const env of envs) assert.equal(evalBool(out, env), evalBool(t, env), `${print(t)} => ${print(out)}`);
  }
});

test('stop reasons', () => {
  const comm = [rewrite('comm', '(+ ?a ?b)', '(+ ?b ?a)')];
  const sat = simplify('(+ x y)', comm);
  assert.equal(sat.report.stopReason, 'saturated');
  const assoc = [
    rewrite('assoc', '(+ ?a (+ ?b ?c))', '(+ (+ ?a ?b) ?c)'),
    rewrite('assoc-r', '(+ (+ ?a ?b) ?c)', '(+ ?a (+ ?b ?c))'),
    ...comm,
  ];
  const big = simplify('(+ a (+ b (+ c (+ d (+ e (+ f g))))))', assoc, { nodeLimit: 500 });
  assert.equal(big.report.stopReason, 'nodeLimit');
  const few = simplify('(+ a (+ b (+ c (+ d (+ e (+ f g))))))', assoc, { iterLimit: 2 });
  assert.equal(few.report.stopReason, 'iterLimit');
  assert.equal(few.report.iterations.length, 2);
});

test('backoff scheduler bans explosive rules and still saturates', () => {
  const rules = [
    rewrite('comm', '(+ ?a ?b)', '(+ ?b ?a)'),
    rewrite('assoc', '(+ ?a (+ ?b ?c))', '(+ (+ ?a ?b) ?c)'),
    rewrite('assoc-r', '(+ (+ ?a ?b) ?c)', '(+ ?a (+ ?b ?c))'),
  ];
  const sched = new BackoffScheduler({ matchLimit: 8, banLength: 2 });
  const eg = new EGraph();
  const root = eg.addTerm(parseTerm('(+ a (+ b (+ c d)))'));
  const rep = runSaturation(eg, rules, { scheduler: sched, iterLimit: 200, nodeLimit: 1e6 });
  assert.equal(rep.stopReason, 'saturated');
  assert.ok([...sched.stats.values()].some((s) => s.timesBanned > 0), 'something should have been banned');
  // All 4! orderings times 5 bracketings of a 4-sum land in one class.
  const simple = new EGraph();
  const r2 = simple.addTerm(parseTerm('(+ a (+ b (+ c d)))'));
  runSaturation(simple, rules, { scheduler: new SimpleScheduler(), iterLimit: 200, nodeLimit: 1e6 });
  assert.equal(eg.getClass(root).nodes.length, simple.getClass(r2).nodes.length);
  eg.checkInvariants();
});

test('conditional rules with function right-hand sides', () => {
  // (f ?x) => (g ?x), only when ?x is a known constant, built procedurally.
  const rule = rewrite('f-const', '(f ?x)', (eg, _id, s) => eg.add({ op: 'g', children: [s.get('x')] }), {
    when: (eg, _id, s) => eg.data(s.get('x')) !== null,
  });
  const eg = new EGraph(ConstantFolding);
  const a = eg.addTerm(parseTerm('(f 3)'));
  const b = eg.addTerm(parseTerm('(f y)'));
  runSaturation(eg, [rule]);
  assert.ok(eg.equiv(a, eg.lookupTerm(parseTerm('(g 3)'))));
  assert.equal(eg.lookupTerm(parseTerm('(g y)')), null);
  assert.ok(!eg.equiv(a, b));
});

test('rules reject unbound right-hand variables', () => {
  assert.throws(() => rewrite('bad', '(f ?a)', '(g ?b)'), /\?b appears on the right/);
});
