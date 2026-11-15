// A guided tour: run with `npm run demo`.
import {
  EGraph, parseTerm, print, simplify, prove, opCost,
  arithRules, arithCost, boolRules, ConstantFolding,
} from '../src/index.js';

const line = (s = '') => console.log(s);

line('1. Congruence closure by hand');
const eg = new EGraph();
const a = eg.addTerm(parseTerm('a'));
const f3 = eg.addTerm(parseTerm('(f (f (f a)))'));
const f5 = eg.addTerm(parseTerm('(f (f (f (f (f a)))))'));
eg.union(f3, a);
eg.union(f5, a);
eg.rebuild();
line(`   f^3(a) = a and f^5(a) = a  =>  f(a) = a ? ${eg.equiv(eg.lookupTerm(parseTerm('(f a)')), a)}`);
line(`   the whole chain collapsed into ${eg.classCount} e-class`);
line();

line('2. Simplification with arithmetic rules and constant folding');
for (const src of ['(+ (* x 1) 0)', '(/ (* a 2) 2)', '(- (+ a b) b)', '(+ (* 3 4) (- y y))', '(* (+ a 1) (- a 1))']) {
  const r = simplify(src, arithRules, { analysis: ConstantFolding, nodeLimit: 5000 });
  line(`   ${src.padEnd(24)} => ${print(r.term).padEnd(18)} [${r.report.stopReason}, ${r.report.nodes} e-nodes]`);
}
line();

line('3. The same e-graph, two cost models');
for (const [name, cost] of [['ast size', undefined], ['machine costs', opCost(arithCost)]]) {
  const r = simplify('(* (+ x y) 2)', arithRules, { analysis: ConstantFolding, nodeLimit: 3000, cost });
  line(`   ${name.padEnd(14)} => ${print(r.term)}`);
}
line();

line('4. Equivalence proofs');
const goals = [
  ['(* (+ a b) (+ a b))', '(+ (+ (* a a) (* 2 (* a b))) (* b b))', arithRules, ConstantFolding],
  ['(not (and a (not b)))', '(or (not a) b)', boolRules, undefined],
  ['(and (or a b) (or a (not b)))', 'a', boolRules, undefined],
];
for (const [x, y, rules, analysis] of goals) {
  const r = prove(x, y, rules, { analysis, nodeLimit: 60000, iterLimit: 40, timeLimit: 30000 });
  line(`   ${x} == ${y}: ${r.equal} (${r.report.iterations.length} iterations)`);
}
