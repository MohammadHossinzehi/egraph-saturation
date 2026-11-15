// Disjoint set forest with path halving and union by size.
// Ids are dense integers handed out by makeSet().

export class UnionFind {
  constructor() {
    this.parent = [];
    this.size = [];
  }

  makeSet() {
    const id = this.parent.length;
    this.parent.push(id);
    this.size.push(1);
    return id;
  }

  find(x) {
    const p = this.parent;
    while (p[x] !== x) {
      p[x] = p[p[x]];
      x = p[x];
    }
    return x;
  }

  // Returns [root, absorbed] or null when already in the same set.
  union(a, b) {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return null;
    if (this.size[a] < this.size[b]) [a, b] = [b, a];
    this.parent[b] = a;
    this.size[a] += this.size[b];
    return [a, b];
  }

  get length() {
    return this.parent.length;
  }
}
