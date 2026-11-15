// E-matching: find every (e-class, substitution) such that the pattern,
// instantiated with the substitution, is represented by that e-class.
//
// The matcher is a backtracking search over e-nodes, the classic top-down
// approach from Simplify / de Moura & Bjorner. Substitutions map pattern
// variable names to canonical e-class ids.

import { parsePattern } from './sexpr.js';

export function patternVars(p, out = new Set()) {
  if (p.var !== undefined) out.add(p.var);
  else for (const c of p.children) patternVars(c, out);
  return out;
}

export function toPattern(p) {
  return typeof p === 'string' ? parsePattern(p) : p;
}

// Yield substitutions extending `subst` under which `pat` matches class `id`.
function* matchClass(eg, pat, id, subst) {
  id = eg.find(id);
  if (pat.var !== undefined) {
    const bound = subst.get(pat.var);
    if (bound === undefined) {
      const s = new Map(subst);
      s.set(pat.var, id);
      yield s;
    } else if (eg.find(bound) === id) {
      yield subst;
    }
    return;
  }
  const cls = eg.classes.get(id);
  const arity = pat.children.length;
  for (const node of cls.nodes) {
    if (node.op !== pat.op || node.children.length !== arity) continue;
    yield* matchChildren(eg, pat.children, node.children, 0, subst);
  }
}

function* matchChildren(eg, pats, ids, i, subst) {
  if (i === pats.length) {
    yield subst;
    return;
  }
  for (const s of matchClass(eg, pats[i], ids[i], subst)) {
    yield* matchChildren(eg, pats, ids, i + 1, s);
  }
}

// Search the whole e-graph. Returns [{ eclass, substs: Map[] }].
// `limit` caps the total number of substitutions returned (Infinity by default);
// the result carries `truncated: true` when the cap was hit.
export function search(eg, pattern, limit = Infinity) {
  const pat = toPattern(pattern);
  const results = [];
  let total = 0;
  let truncated = false;
  for (const id of eg.classes.keys()) {
    if (pat.var === undefined) {
      // cheap pre-filter on the root operator
      const cls = eg.classes.get(id);
      if (!cls.nodes.some((n) => n.op === pat.op && n.children.length === pat.children.length)) continue;
    }
    const substs = [];
    for (const s of matchClass(eg, pat, id, new Map())) {
      if (total >= limit) {
        truncated = true;
        break;
      }
      substs.push(s);
      total++;
    }
    if (substs.length) results.push({ eclass: id, substs });
    if (truncated) break;
  }
  results.total = total;
  results.truncated = truncated;
  return results;
}

// Insert the pattern instantiated with `subst`; returns its e-class id.
export function instantiate(eg, pattern, subst) {
  const pat = toPattern(pattern);
  if (pat.var !== undefined) {
    const id = subst.get(pat.var);
    if (id === undefined) throw new Error(`unbound pattern variable ?${pat.var}`);
    return eg.find(id);
  }
  const children = pat.children.map((c) => instantiate(eg, c, subst));
  return eg.add({ op: pat.op, children });
}

// Like instantiate, but never inserts. Returns an e-class id or null.
export function lookupPattern(eg, pattern, subst) {
  const pat = toPattern(pattern);
  if (pat.var !== undefined) {
    const id = subst.get(pat.var);
    return id === undefined ? null : eg.find(id);
  }
  const children = [];
  for (const c of pat.children) {
    const id = lookupPattern(eg, c, subst);
    if (id === null) return null;
    children.push(id);
  }
  return eg.lookup({ op: pat.op, children });
}
