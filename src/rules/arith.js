// Integer/rational arithmetic: ring axioms, a few division facts, strength
// reduction to shifts, and a constant-folding e-class analysis.
//
// Semantics: variables range over the rationals, `/` is exact division,
// `(<< a n)` means a * 2^n for a non-negative integer literal n.

import { rewrite, birewrite } from '../rewrite.js';
import { isIntLiteral } from '../sexpr.js';

// Each e-class may carry the BigInt constant it is known to equal.
export const ConstantFolding = {
  make(eg, node) {
    if (node.children.length === 0) return isIntLiteral(node.op) ? BigInt(node.op) : null;
    if (node.children.length !== 2) return null;
    const a = eg.data(node.children[0]);
    const b = eg.data(node.children[1]);
    if (a === null || b === null) return null;
    switch (node.op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b !== 0n && a % b === 0n ? a / b : null;
      case '<<': return b >= 0n && b < 64n ? a << b : null;
      default: return null;
    }
  },
  merge(a, b) {
    if (a !== null && b !== null && a !== b) {
      throw new Error(`unsound rewrite: merged constants ${a} and ${b}`);
    }
    return a ?? b;
  },
  modify(eg, id) {
    const v = eg.data(id);
    if (v !== null) eg.union(id, eg.add({ op: v.toString(), children: [] }));
  },
};

const isConst = (v) => (eg, _id, s) => eg.data(s.get(v)) !== null;
const isNonzeroConst = (v) => (eg, _id, s) => {
  const d = eg.data(s.get(v));
  return d !== null && d !== 0n;
};

export const arithRules = [
  rewrite('comm-add', '(+ ?a ?b)', '(+ ?b ?a)'),
  rewrite('comm-mul', '(* ?a ?b)', '(* ?b ?a)'),
  ...birewrite('assoc-add', '(+ ?a (+ ?b ?c))', '(+ (+ ?a ?b) ?c)'),
  ...birewrite('assoc-mul', '(* ?a (* ?b ?c))', '(* (* ?a ?b) ?c)'),
  rewrite('sub-canon', '(- ?a ?b)', '(+ ?a (* -1 ?b))'),
  rewrite('add-zero', '(+ ?a 0)', '?a'),
  rewrite('mul-one', '(* ?a 1)', '?a'),
  rewrite('mul-zero', '(* ?a 0)', '0'),
  rewrite('cancel-sub', '(+ ?a (* -1 ?a))', '0'),
  rewrite('add-double', '(+ ?a ?a)', '(* 2 ?a)'),
  rewrite('distribute', '(* ?a (+ ?b ?c))', '(+ (* ?a ?b) (* ?a ?c))'),
  rewrite('factor', '(+ (* ?a ?b) (* ?a ?c))', '(* ?a (+ ?b ?c))'),
  ...birewrite('mul-two-shift', '(* ?a 2)', '(<< ?a 1)'),
  rewrite('div-assoc', '(/ (* ?a ?b) ?c)', '(* ?a (/ ?b ?c))', { when: isNonzeroConst('c') }),
  rewrite('div-self', '(/ ?a ?a)', '1', { when: isNonzeroConst('a') }),
  rewrite('div-one', '(/ ?a 1)', '?a'),
  rewrite('fold-shift', '(<< ?a ?n)', '(* ?a (<< 1 ?n))', { when: isConst('n') }),
];

// Machine-ish costs: shifts are cheap, multiplies cost more, division most.
export const arithCost = { '+': 2, '-': 2, '*': 4, '/': 8, '<<': 1 };
