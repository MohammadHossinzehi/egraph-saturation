import { EGraph } from './egraph.js';
import { runSaturation } from './rewrite.js';
import { Extractor, AstSize } from './extract.js';
import { parseTerm } from './sexpr.js';

export { EGraph, NoAnalysis, nodeKey } from './egraph.js';
export { UnionFind } from './unionfind.js';
export { parseTerm, parsePattern, print, termSize, termDepth, ParseError } from './sexpr.js';
export { search, instantiate, lookupPattern, patternVars } from './pattern.js';
export { rewrite, birewrite, describeRule, runSaturation, BackoffScheduler, SimpleScheduler } from './rewrite.js';
export { Extractor, AstSize, AstDepth, opCost } from './extract.js';
export { arithRules, arithCost, ConstantFolding } from './rules/arith.js';
export { boolRules } from './rules/bool.js';

const asTerm = (t) => (typeof t === 'string' ? parseTerm(t) : t);

// One-call simplification: saturate, then extract the cheapest equivalent.
export function simplify(term, rules, { analysis, cost = AstSize, ...runOpts } = {}) {
  const eg = new EGraph(analysis);
  const root = eg.addTerm(asTerm(term));
  const report = runSaturation(eg, rules, runOpts);
  const ex = new Extractor(eg, cost);
  return { term: ex.extract(root), cost: ex.costOf(root), report, egraph: eg };
}

// Try to show a == b by saturating both in one e-graph until they meet.
// A `false` result means "not found within limits", not "not equal".
export function prove(a, b, rules, { analysis, ...runOpts } = {}) {
  const eg = new EGraph(analysis);
  const ia = eg.addTerm(asTerm(a));
  const ib = eg.addTerm(asTerm(b));
  const report = runSaturation(eg, rules, { ...runOpts, until: (g) => g.equiv(ia, ib) });
  return { equal: eg.equiv(ia, ib), report, egraph: eg };
}
