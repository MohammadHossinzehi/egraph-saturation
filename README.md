# egraph-saturation

E-graphs and equality saturation from scratch in plain JavaScript. No dependencies, nothing to install, Node 18 or newer.

```
$ node bin/egsat.js simplify "(/ (* a 2) 2)"
a
$ node bin/egsat.js simplify "(* (+ x y) 2)" --cost machine
(<< (+ x y) 1)
$ node bin/egsat.js prove "(* (+ a b) (+ a b))" "(+ (+ (* a a) (* 2 (* a b))) (* b b))" --nodes 60000
equal
```

## What problem this solves

A conventional term rewriter applies one rule at a time and commits to it. That makes rule order matter: rewrite `(/ (* a 2) 2)` with `(* ?x 2) => (<< ?x 1)` first and the division can never cancel, because the `* 2` it needed is gone. This is the phase ordering problem that compilers have fought with for decades.

An **e-graph** sidesteps it. It stores a huge (often infinite) set of equivalent terms compactly by grouping e-nodes into equivalence classes. **Equality saturation** applies every rule everywhere, but instead of replacing anything it only *adds* equalities. When nothing new can be learned (or a budget runs out) an **extractor** picks the cheapest term from the class of the input under whatever cost model you choose. Rule order stops mattering, and the same saturated graph can be mined with different cost functions.

This is the technique behind [egg](https://egraphs-good.github.io/), Cranelift's mid end optimiser, Herbie's floating point rewriting and a growing list of superoptimisers and synthesis tools. This repo is a small, readable, tested implementation of the whole pipeline.

## What is in here

| File | What it does |
| --- | --- |
| `src/unionfind.js` | Disjoint set forest, path halving, union by size |
| `src/egraph.js` | Hashconsed e-graph, deferred rebuilding (egg's algorithm), e-class analyses, invariant checker, Graphviz export |
| `src/pattern.js` | Backtracking e-matching with nonlinear patterns, instantiation and non-inserting lookup |
| `src/rewrite.js` | Rewrite rules (syntactic or procedural right sides, guards), the saturation runner and egg's backoff scheduler |
| `src/extract.js` | Fixed point extraction that works on cyclic e-graphs, with AST size, depth and weighted operator costs |
| `src/rules/arith.js` | Ring axioms, guarded division facts, shift strength reduction and a BigInt constant folding analysis |
| `src/rules/bool.js` | Boolean algebra: De Morgan, absorption, distribution, excluded middle and friends |
| `bin/egsat.js` | CLI: `simplify`, `prove`, `dot`, `rules` |
| `examples/demo.js` | A guided tour of everything above |

## Running it

```
git clone https://github.com/MohammadHossinzehi/egraph-saturation
cd egraph-saturation
npm test           # or: node --test
npm run demo       # or: node examples/demo.js
node bin/egsat.js --help
```

The CLI options:

```
egsat simplify <expr>        saturate and print the cheapest equivalent term
egsat prove <expr> <expr>    try to show two terms are equal
egsat dot <expr>             print the saturated e-graph as Graphviz
egsat rules                  list the rules of the selected rule set

--rules arith|bool   --cost size|depth|machine   --iters N   --nodes N   --time MS   --stats
```

`--stats` prints a per iteration table of e-class and e-node counts and which rules fired, which is the quickest way to watch associativity and commutativity blow up a graph. `egsat dot "(+ x 0)" | dot -Tsvg > g.svg` draws the e-graph with one dashed cluster per e-class.

### As a library

```js
import { EGraph, rewrite, runSaturation, Extractor, parseTerm, print } from './src/index.js';

const rules = [
  rewrite('comm-mul', '(* ?a ?b)', '(* ?b ?a)'),
  rewrite('mul-one',  '(* ?a 1)',  '?a'),
];
const eg = new EGraph();
const root = eg.addTerm(parseTerm('(* 1 (* y 1))'));
const report = runSaturation(eg, rules);          // { stopReason: 'saturated', iterations, ... }
console.log(print(new Extractor(eg).extract(root))); // y
```

Rules can also have a function as the right side and a `when` guard, both receiving `(egraph, eclass, substitution)`. An e-class analysis is any object with `make`, `merge` and `modify`; `ConstantFolding` in `src/rules/arith.js` is a complete example.

## Design notes

**Deferred rebuilding.** `union` only merges the two classes and pushes the survivor on a worklist; it does not restore congruence. `rebuild()` drains the worklist in batches, rekeys each parent e-node under its canonical form, and unions parents that collapsed to the same key. Batching is the main idea of the egg paper (Willsey et al., POPL 2021): one rebuild after a whole iteration of rule applications does far less work than repairing after every union. A subtle bug I hit along the way: during repair a congruence union can append parents to the very class being repaired, so the old parent list is detached up front and new entries are appended rather than overwriting the list.

**Search, then apply.** Each iteration searches every rule against the same frozen graph and only then applies the matches. That keeps the result independent of rule order within an iteration, which is the whole point of saturation.

**Backoff scheduling.** Commutativity and associativity alone generate every bracketing and ordering of a sum, so a few rules can starve the rest. The `BackoffScheduler` bans a rule for a while when it produces more matches than its threshold, doubling both the threshold and the ban length each time. If an iteration changes nothing while rules are banned, the bans are lifted instead of declaring saturation, so a reported `saturated` really is saturated. A test checks that the backoff run reaches exactly the same fixed point as the unscheduled run.

**Extraction on cyclic graphs.** `x = (* x 1)` makes a class its own descendant, so a naive recursive extractor loops forever. The extractor computes the least fixed point of `best(c) = min over nodes of cost(node, best(children))` by relaxation, which terminates for any cost that strictly grows with its children.

**Analyses keep the rules honest.** Constant folding is an e-class analysis rather than a pile of rules: every class carries the BigInt it is known to equal, and `modify` unions the class with the literal. If two classes with different constants are ever merged, `merge` throws `unsound rewrite`, which turned out to be a great way to catch bad rules during development. Division facts are guarded by the analysis, so `(/ x x)` is left alone (x might be zero) while `(/ 5 5)` becomes `1`.

**Partiality.** `mul-zero` turns `(* (/ x 0) 0)` into `0`, which is only "equal where defined". E-graph equality is transitive, so mixing partial operations with such rules can in principle equate a defined term with an undefined one. The arithmetic rule set is sound for total terms, and the fuzzer only divides by nonzero literals for that reason. A production system would track definedness in an analysis.

## Testing

`npm test` runs 38 tests with `node:test` in about five seconds. The interesting ones compare against independent oracles rather than hand picked answers:

* **Congruence closure vs a naive oracle.** Forty random e-graphs get random unions with randomly interleaved rebuilds, and the resulting partition must match a brute force fixed point congruence closure built on a separate union-find. `checkInvariants()` also verifies that every node is canonical, the hashcons is fresh and no e-node lives in two classes.
* **E-matching vs brute force.** For each pattern, every assignment of pattern variables to e-classes is enumerated and kept if the instantiated pattern already exists. The matcher's output must equal that set exactly, which checks soundness and completeness together, including nonlinear patterns like `(+ ?a ?a)`.
* **Extraction vs a depth indexed DP.** On saturated graphs the fixed point extractor's optimum must equal a separately formulated dynamic program bounded by the class count, and the extracted term must look up to the root class.
* **Rule soundness by evaluation.** Random arithmetic terms are simplified and evaluated at random points in exact rational arithmetic; random Boolean terms are checked on full truth tables. One test goes further and extracts several different terms from each saturated class under random cost models, then checks they all evaluate to the same value, which exercises far more of the graph than the single winning term.
* **Behaviour.** Textbook simplifications, the binomial square proof, stop reasons (`saturated`, `nodeLimit`, `iterLimit`, `goal`), guarded and procedural rules, and the unsound rule detector.

## Limitations

* Matching is top down backtracking over every class. Relational e-matching (generic join over the e-graph as a database) would be much faster for large patterns.
* No proof production: `prove` says *that* two terms are equal, not *why*. Explanations in the style of egg's `explain` would need a proof forest alongside the union-find.
* Extraction is the greedy tree cost optimum, which ignores sharing. DAG optimal extraction is NP hard and usually done with ILP.

## License

MIT
