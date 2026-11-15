// Shared test utilities: a seeded PRNG, random term generators and reference
// evaluators that the rewrite rules are checked against.

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
export const leaf = (op) => ({ op, children: [] });
export const node = (op, ...children) => ({ op, children });

// Random arithmetic term. Division only ever divides by a nonzero literal,
// so every generated term is total over the rationals.
export function randomArith(r, depth) {
  if (depth === 0 || r() < 0.25) {
    return r() < 0.6 ? leaf(pick(r, ['x', 'y', 'z'])) : leaf(String(Math.floor(r() * 7) - 2));
  }
  const op = pick(r, ['+', '+', '-', '*', '*', '/', '<<']);
  if (op === '/') return node('/', randomArith(r, depth - 1), leaf(pick(r, ['1', '2', '3', '-2'])));
  if (op === '<<') return node('<<', randomArith(r, depth - 1), leaf(pick(r, ['0', '1', '2'])));
  return node(op, randomArith(r, depth - 1), randomArith(r, depth - 1));
}

// Exact rational arithmetic on [num, den] BigInt pairs.
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const norm = ([n, d]) => { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d) || 1n; return [n / g, d / g]; };
export const rat = (n) => [BigInt(n), 1n];

export function evalArith(t, env) {
  if (t.children.length === 0) return /^-?\d+$/.test(t.op) ? rat(t.op) : env[t.op];
  const [a, b] = t.children.map((c) => evalArith(c, env));
  switch (t.op) {
    case '+': return norm([a[0] * b[1] + b[0] * a[1], a[1] * b[1]]);
    case '-': return norm([a[0] * b[1] - b[0] * a[1], a[1] * b[1]]);
    case '*': return norm([a[0] * b[0], a[1] * b[1]]);
    case '/': if (b[0] === 0n) throw new Error('div0'); return norm([a[0] * b[1], a[1] * b[0]]);
    case '<<': return norm([a[0] * (1n << (b[0] / b[1])), a[1]]);
    default: throw new Error('unknown op ' + t.op);
  }
}

export function randomBool(r, depth) {
  if (depth === 0 || r() < 0.25) return leaf(pick(r, ['p', 'q', 's', 'p', 'q', 'true', 'false']));
  const op = pick(r, ['and', 'or', 'not']);
  if (op === 'not') return node('not', randomBool(r, depth - 1));
  return node(op, randomBool(r, depth - 1), randomBool(r, depth - 1));
}

export function evalBool(t, env) {
  switch (t.op) {
    case 'true': return true;
    case 'false': return false;
    case 'and': return evalBool(t.children[0], env) && evalBool(t.children[1], env);
    case 'or': return evalBool(t.children[0], env) || evalBool(t.children[1], env);
    case 'not': return !evalBool(t.children[0], env);
    default: return env[t.op];
  }
}
