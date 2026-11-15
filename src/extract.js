// Extraction: pick the cheapest term represented by an e-class.
//
// For a cost function that is monotone in its children (every node costs at
// least something positive on top of its children) the cheapest term is the
// least fixed point of
//     best(c) = min over nodes n in c of cost(n, best(children(n)))
// which we compute by iterating until nothing improves. E-graphs are cyclic
// in general (x = x * 1), and this Bellman-Ford style relaxation handles that
// without any special casing.

export const AstSize = (node, childCosts) => 1 + childCosts.reduce((a, b) => a + b, 0);
export const AstDepth = (node, childCosts) => 1 + childCosts.reduce((a, b) => Math.max(a, b), 0);

// Build a weighted-size cost function from an operator table.
export function opCost(table, fallback = 1) {
  return (node, childCosts) => (table[node.op] ?? fallback) + childCosts.reduce((a, b) => a + b, 0);
}

export class Extractor {
  constructor(eg, cost = AstSize) {
    if (!eg.clean) eg.rebuild();
    this.eg = eg;
    this.cost = cost;
    this.best = new Map(); // class id -> { cost, node }
    this.#compute();
  }

  #compute() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, cls] of this.eg.classes) {
        let cur = this.best.get(id);
        for (const node of cls.nodes) {
          const cc = [];
          let ok = true;
          for (const ch of node.children) {
            const b = this.best.get(this.eg.find(ch));
            if (!b) {
              ok = false;
              break;
            }
            cc.push(b.cost);
          }
          if (!ok) continue;
          const c = this.cost(node, cc);
          if (!cur || c < cur.cost) {
            cur = { cost: c, node };
            this.best.set(id, cur);
            changed = true;
          }
        }
      }
    }
  }

  costOf(id) {
    const b = this.best.get(this.eg.find(id));
    return b ? b.cost : Infinity;
  }

  extract(id) {
    const b = this.best.get(this.eg.find(id));
    if (!b) throw new Error(`e-class ${id} represents no finite term`);
    return { op: b.node.op, children: b.node.children.map((c) => this.extract(c)) };
  }
}
