// The e-graph: a union-find over e-class ids, a hashcons from canonical
// e-nodes to e-classes, and egg-style deferred rebuilding that restores the
// congruence invariant in batches instead of after every union.
//
// An e-node is { op: string, children: number[] } where children are e-class
// ids. A node is canonical when every child id is a union-find root.

import { UnionFind } from './unionfind.js';

export const nodeKey = (n) =>
  n.children.length === 0 ? n.op : n.op + '\u0000' + n.children.join(',');

// The analysis used when none is supplied: carries no data.
export const NoAnalysis = {
  make: () => null,
  merge: (a) => a,
  modify: () => {},
};

export class EGraph {
  constructor(analysis = NoAnalysis) {
    this.uf = new UnionFind();
    this.hashcons = new Map(); // nodeKey(canonical node) -> class id
    this.classes = new Map(); // root id -> { id, nodes, parents, data }
    this.worklist = [];
    this.analysis = { ...NoAnalysis, ...analysis };
    this.unionCount = 0; // successful unions ever performed
    this.clean = true; // true when invariants hold (no pending rebuild)
  }

  find(id) {
    return this.uf.find(id);
  }

  canon(node) {
    if (node.children.length === 0) return node;
    let changed = false;
    const ch = node.children.map((c) => {
      const r = this.uf.find(c);
      if (r !== c) changed = true;
      return r;
    });
    return changed ? { op: node.op, children: ch } : node;
  }

  getClass(id) {
    return this.classes.get(this.uf.find(id));
  }

  data(id) {
    return this.getClass(id).data;
  }

  // Look up an e-node without inserting it. Returns a class id or null.
  lookup(node) {
    const id = this.hashcons.get(nodeKey(this.canon(node)));
    return id === undefined ? null : this.uf.find(id);
  }

  add(node) {
    const n = this.canon(node);
    const k = nodeKey(n);
    const hit = this.hashcons.get(k);
    if (hit !== undefined) return this.uf.find(hit);

    const id = this.uf.makeSet();
    const cls = { id, nodes: [n], parents: [], data: null };
    this.classes.set(id, cls);
    for (const c of n.children) this.classes.get(c).parents.push({ node: n, cls: id });
    this.hashcons.set(k, id);
    cls.data = this.analysis.make(this, n);
    this.analysis.modify(this, id);
    return this.uf.find(id);
  }

  addTerm(term) {
    const children = term.children.map((c) => this.addTerm(c));
    return this.add({ op: term.op, children });
  }

  // Look up a whole term without inserting anything.
  lookupTerm(term) {
    const children = [];
    for (const c of term.children) {
      const id = this.lookupTerm(c);
      if (id === null) return null;
      children.push(id);
    }
    return this.lookup({ op: term.op, children });
  }

  // Merge two e-classes. Congruence is NOT restored until rebuild().
  // Returns true when the classes were previously distinct.
  union(a, b) {
    const r = this.uf.union(a, b);
    if (r === null) return false;
    const [root, gone] = r;
    const rc = this.classes.get(root);
    const gc = this.classes.get(gone);
    for (const n of gc.nodes) rc.nodes.push(n);
    for (const p of gc.parents) rc.parents.push(p);
    rc.data = this.analysis.merge(rc.data, gc.data);
    this.classes.delete(gone);
    this.worklist.push(root);
    this.unionCount++;
    this.clean = false;
    return true;
  }

  equiv(a, b) {
    return this.uf.find(a) === this.uf.find(b);
  }

  // Restore the hashcons and congruence invariants (egg, Willsey et al. 2021).
  rebuild() {
    let repairs = 0;
    while (this.worklist.length > 0) {
      const todo = new Set(this.worklist.map((id) => this.uf.find(id)));
      this.worklist = [];
      for (const id of todo) {
        this.repair(id);
        repairs++;
      }
    }
    // Canonicalise and deduplicate the node lists so matching sees each
    // distinct e-node once.
    for (const cls of this.classes.values()) {
      const seen = new Map();
      for (const n of cls.nodes) {
        const c = this.canon(n);
        const k = nodeKey(c);
        if (!seen.has(k)) seen.set(k, c);
      }
      cls.nodes = [...seen.values()];
    }
    this.clean = true;
    return repairs;
  }

  repair(id) {
    let cls = this.classes.get(this.uf.find(id));
    const old = cls.parents;
    cls.parents = [];

    // 1. Re-key every parent under its canonical form.
    for (const { node, cls: pc } of old) {
      this.hashcons.delete(nodeKey(node));
      const n = this.canon(node);
      this.hashcons.set(nodeKey(n), this.uf.find(pc));
    }

    // 2. Parents that became identical are congruent: merge their classes.
    const fresh = new Map();
    for (const { node, cls: pc } of old) {
      const n = this.canon(node);
      const k = nodeKey(n);
      const prev = fresh.get(k);
      if (prev) this.union(pc, prev.cls);
      fresh.set(k, { node: n, cls: this.uf.find(pc) });
    }
    cls = this.classes.get(this.uf.find(id));
    for (const p of fresh.values()) cls.parents.push(p);

    // 3. Propagate analysis data upward.
    for (const { node, cls: pc } of fresh.values()) {
      const pcls = this.classes.get(this.uf.find(pc));
      const d = this.analysis.make(this, this.canon(node));
      const merged = this.analysis.merge(pcls.data, d);
      if (!dataEqual(merged, pcls.data)) {
        pcls.data = merged;
        this.worklist.push(pcls.id);
      }
    }
    this.analysis.modify(this, this.uf.find(id));
  }

  get classCount() {
    return this.classes.size;
  }

  get nodeCount() {
    let n = 0;
    for (const c of this.classes.values()) n += c.nodes.length;
    return n;
  }

  // Throws if any invariant is violated. Only meaningful after rebuild().
  checkInvariants() {
    if (this.worklist.length) throw new Error('pending worklist: call rebuild() first');
    const owner = new Map();
    for (const [id, cls] of this.classes) {
      if (this.uf.find(id) !== id) throw new Error(`class ${id} is not a root`);
      for (const n of cls.nodes) {
        const c = this.canon(n);
        if (nodeKey(c) !== nodeKey(n)) throw new Error(`non-canonical node in class ${id}`);
        const k = nodeKey(n);
        if (owner.has(k) && owner.get(k) !== id) {
          throw new Error(`congruence violated: ${k} in classes ${owner.get(k)} and ${id}`);
        }
        owner.set(k, id);
        const h = this.hashcons.get(k);
        if (h === undefined || this.uf.find(h) !== id) throw new Error(`hashcons stale for ${k}`);
      }
    }
    return true;
  }

  // Graphviz rendering: one cluster per e-class, edges from e-nodes to classes.
  toDot() {
    const lines = ['digraph egraph {', '  compound=true; node [shape=box, fontname="monospace"];'];
    const esc = (s) => s.replace(/"/g, '\\"');
    for (const [id, cls] of this.classes) {
      lines.push(`  subgraph cluster_${id} { label="e${id}"; style=dashed;`);
      cls.nodes.forEach((n, i) => lines.push(`    n${id}_${i} [label="${esc(n.op)}"];`));
      lines.push(`    c${id} [shape=point, style=invis];`, '  }');
    }
    for (const [id, cls] of this.classes) {
      cls.nodes.forEach((n, i) => {
        n.children.forEach((c) => {
          const r = this.uf.find(c);
          lines.push(`  n${id}_${i} -> c${r} [lhead=cluster_${r}];`);
        });
      });
    }
    lines.push('}');
    return lines.join('\n');
  }
}

function dataEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a, (_, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v)) ===
    JSON.stringify(b, (_, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v));
}
