#!/usr/bin/env node
// egsat: command line front end for the equality saturation engine.
import {
  EGraph, parseTerm, print, simplify, prove, runSaturation, describeRule,
  arithRules, arithCost, boolRules, ConstantFolding, AstSize, AstDepth, opCost,
} from '../src/index.js';

const HELP = `usage:
  egsat simplify <expr>        saturate and print the cheapest equivalent term
  egsat prove <expr> <expr>    try to show two terms are equal
  egsat dot <expr>             print the saturated e-graph as Graphviz
  egsat rules                  list the rules of the selected rule set

options:
  --rules arith|bool   rule set (default: arith)
  --cost size|depth|machine   extraction cost (default: size; machine = arith op costs)
  --iters N            iteration limit (default 30)
  --nodes N            e-node limit (default 10000)
  --time MS            time limit in milliseconds (default 5000)
  --stats              print per-iteration statistics to stderr

examples:
  egsat simplify "(/ (* a 2) 2)"
  egsat simplify "(* x 2)" --cost machine
  egsat prove "(not (and a (not b)))" "(or (not a) b)" --rules bool`;

function parseArgs(argv) {
  const pos = [];
  const opt = { rules: 'arith', cost: 'size', iters: 30, nodes: 10000, time: 5000, stats: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--stats') opt.stats = true;
    else if (a === '-h' || a === '--help') opt.help = true;
    else if (a.startsWith('--')) {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      opt[a.slice(2)] = ['iters', 'nodes', 'time'].includes(a.slice(2)) ? Number(v) : v;
    } else pos.push(a);
  }
  return { pos, opt };
}

function ruleSet(name) {
  if (name === 'arith') return { rules: arithRules, analysis: ConstantFolding };
  if (name === 'bool') return { rules: boolRules, analysis: undefined };
  throw new Error(`unknown rule set: ${name}`);
}

function costFn(name) {
  if (name === 'size') return AstSize;
  if (name === 'depth') return AstDepth;
  if (name === 'machine') return opCost(arithCost);
  throw new Error(`unknown cost: ${name}`);
}

function printStats(report) {
  for (const it of report.iterations) {
    const top = Object.entries(it.applied).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k}:${v}`).join(' ');
    console.error(`iter ${String(it.iter).padStart(2)}  classes ${String(it.classes).padStart(6)}  nodes ${String(it.nodes).padStart(6)}  ${String(it.ms).padStart(4)}ms  ${top}`);
  }
  console.error(`stop: ${report.stopReason} after ${report.iterations.length} iterations, ${report.ms}ms`);
}

function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const [cmd, ...args] = pos;
  if (opt.help || !cmd) {
    console.log(HELP);
    return 0;
  }
  const { rules, analysis } = ruleSet(opt.rules);
  const limits = { iterLimit: opt.iters, nodeLimit: opt.nodes, timeLimit: opt.time };

  switch (cmd) {
    case 'simplify': {
      if (args.length !== 1) throw new Error('simplify takes one expression');
      const r = simplify(args[0], rules, { analysis, cost: costFn(opt.cost), ...limits });
      if (opt.stats) printStats(r.report);
      console.log(print(r.term));
      return 0;
    }
    case 'prove': {
      if (args.length !== 2) throw new Error('prove takes two expressions');
      const r = prove(args[0], args[1], rules, { analysis, ...limits });
      if (opt.stats) printStats(r.report);
      console.log(r.equal ? 'equal' : `not shown equal (stopped: ${r.report.stopReason})`);
      return r.equal ? 0 : 1;
    }
    case 'dot': {
      if (args.length !== 1) throw new Error('dot takes one expression');
      const eg = new EGraph(analysis);
      eg.addTerm(parseTerm(args[0]));
      const rep = runSaturation(eg, rules, limits);
      if (opt.stats) printStats(rep);
      console.log(eg.toDot());
      return 0;
    }
    case 'rules':
      for (const r of rules) console.log(describeRule(r));
      return 0;
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(`egsat: ${e.message}`);
  process.exitCode = 2;
}
