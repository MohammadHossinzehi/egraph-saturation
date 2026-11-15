// Rewrite rules and the equality saturation runner.

import { search, instantiate, toPattern, patternVars } from './pattern.js';
import { print } from './sexpr.js';

// rewrite('comm-add', '(+ ?a ?b)', '(+ ?b ?a)')
// rhs may also be a function (egraph, eclass, subst) => classId | null,
// and opts.when is an optional guard (egraph, eclass, subst) => boolean.
export function rewrite(name, lhs, rhs, opts = {}) {
  const l = toPattern(lhs);
  const r = typeof rhs === 'function' ? rhs : toPattern(rhs);
  if (typeof r !== 'function') {
    const lv = patternVars(l);
    for (const v of patternVars(r)) {
      if (!lv.has(v)) throw new Error(`rule ${name}: ?${v} appears on the right but not the left`);
    }
  }
  return { name, lhs: l, rhs: r, when: opts.when ?? null };
}

// Both directions of an equation, as two rules.
export function birewrite(name, a, b, opts = {}) {
  return [rewrite(name, a, b, opts), rewrite(name + '-rev', b, a, opts)];
}

export function describeRule(rule) {
  const r = typeof rule.rhs === 'function' ? '<fn>' : print(rule.rhs);
  return `${rule.name}: ${print(rule.lhs)} => ${r}${rule.when ? ' if <cond>' : ''}`;
}

// egg's BackoffScheduler: a rule that produces too many matches is banned for
// a while, and its threshold doubles every time it is banned. This keeps
// explosive rules (associativity, commutativity) from starving the others.
export class BackoffScheduler {
  constructor({ matchLimit = 1000, banLength = 5 } = {}) {
    this.matchLimit = matchLimit;
    this.banLength = banLength;
    this.stats = new Map();
  }

  #s(rule) {
    let s = this.stats.get(rule.name);
    if (!s) this.stats.set(rule.name, (s = { timesBanned: 0, bannedUntil: 0 }));
    return s;
  }

  isBanned(rule, iter) {
    return this.#s(rule).bannedUntil > iter;
  }

  anyBanned(iter) {
    for (const s of this.stats.values()) if (s.bannedUntil > iter) return true;
    return false;
  }

  unbanAll() {
    for (const s of this.stats.values()) s.bannedUntil = 0;
  }

  search(eg, rule, iter) {
    const s = this.#s(rule);
    const threshold = this.matchLimit << s.timesBanned;
    const res = search(eg, rule.lhs, threshold + 1);
    if (res.total > threshold) {
      s.bannedUntil = iter + (this.banLength << s.timesBanned);
      s.timesBanned++;
      return null;
    }
    return res;
  }
}

export class SimpleScheduler {
  isBanned() {
    return false;
  }
  anyBanned() {
    return false;
  }
  unbanAll() {}
  search(eg, rule) {
    return search(eg, rule.lhs);
  }
}

function applyMatches(eg, rule, matches) {
  let applied = 0;
  for (const { eclass, substs } of matches) {
    for (const subst of substs) {
      if (rule.when && !rule.when(eg, eclass, subst)) continue;
      const id = typeof rule.rhs === 'function' ? rule.rhs(eg, eclass, subst) : instantiate(eg, rule.rhs, subst);
      if (id === null || id === undefined) continue;
      if (eg.union(eclass, id)) applied++;
    }
  }
  return applied;
}

// Run equality saturation. Stops when saturated, or a limit is reached, or
// `until(egraph)` returns true (checked after every iteration).
export function runSaturation(eg, rules, opts = {}) {
  const {
    iterLimit = 30,
    nodeLimit = 10_000,
    timeLimit = 5_000,
    scheduler = new BackoffScheduler(),
    until = null,
  } = opts;
  const t0 = Date.now();
  const iterations = [];
  let stopReason = null;
  if (!eg.clean) eg.rebuild();
  if (until && until(eg)) stopReason = 'goal';

  for (let iter = 0; stopReason === null; iter++) {
    if (iter >= iterLimit) {
      stopReason = 'iterLimit';
      break;
    }
    const before = eg.unionCount;
    const ts = Date.now();

    // Search every rule against the same snapshot, then apply all at once.
    const found = [];
    for (const rule of rules) {
      if (scheduler.isBanned(rule, iter)) continue;
      const m = scheduler.search(eg, rule, iter);
      if (m) found.push([rule, m]);
    }
    const applied = {};
    for (const [rule, m] of found) {
      const n = applyMatches(eg, rule, m);
      if (n) applied[rule.name] = (applied[rule.name] ?? 0) + n;
      if (eg.nodeCount > nodeLimit) break;
    }
    const repairs = eg.rebuild();
    iterations.push({
      iter,
      applied,
      unions: eg.unionCount - before,
      repairs,
      classes: eg.classCount,
      nodes: eg.nodeCount,
      ms: Date.now() - ts,
    });

    if (until && until(eg)) stopReason = 'goal';
    else if (eg.nodeCount > nodeLimit) stopReason = 'nodeLimit';
    else if (Date.now() - t0 > timeLimit) stopReason = 'timeLimit';
    else if (eg.unionCount === before) {
      // Nothing changed. If rules are banned the graph may not truly be
      // saturated, so lift the bans and keep going, like egg does.
      if (scheduler.anyBanned(iter + 1)) scheduler.unbanAll();
      else stopReason = 'saturated';
    }
  }
  return { stopReason, iterations, ms: Date.now() - t0, classes: eg.classCount, nodes: eg.nodeCount };
}
