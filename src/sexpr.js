// S-expression reader/printer for terms and patterns.
//
// A term is { op: string, children: Term[] }. Atoms are terms with no
// children, so `x` and `42` are both { op, children: [] }.
// A pattern is the same shape, except atoms that start with `?` become
// pattern variables: { var: 'name' }.

export class ParseError extends Error {}

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(;[^\n]*)|([()])|([^\s()]+))/gy;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const start = re.lastIndex;
    m = re.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(start))) break;
      throw new ParseError(`unexpected input at offset ${start}`);
    }
    if (m[1]) continue; // comment
    if (m[2]) tokens.push(m[2]);
    else if (m[3]) tokens.push(m[3]);
    else break;
  }
  return tokens;
}

function readForm(tokens, pos, asPattern) {
  const tok = tokens[pos];
  if (tok === undefined) throw new ParseError('unexpected end of input');
  if (tok === ')') throw new ParseError('unexpected )');
  if (tok !== '(') {
    if (asPattern && tok.startsWith('?')) {
      if (tok.length === 1) throw new ParseError('empty pattern variable');
      return [{ var: tok.slice(1) }, pos + 1];
    }
    return [{ op: tok, children: [] }, pos + 1];
  }
  const head = tokens[pos + 1];
  if (head === undefined) throw new ParseError('unexpected end of input');
  if (head === '(' || head === ')') throw new ParseError('operator must be an atom');
  if (asPattern && head.startsWith('?')) throw new ParseError('operator cannot be a pattern variable');
  const children = [];
  let p = pos + 2;
  while (tokens[p] !== ')') {
    if (tokens[p] === undefined) throw new ParseError('missing )');
    const [child, next] = readForm(tokens, p, asPattern);
    children.push(child);
    p = next;
  }
  return [{ op: head, children }, p + 1];
}

function readOne(src, asPattern) {
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new ParseError('empty input');
  const [form, end] = readForm(tokens, 0, asPattern);
  if (end !== tokens.length) throw new ParseError('trailing input after expression');
  return form;
}

export const parseTerm = (src) => readOne(src, false);
export const parsePattern = (src) => readOne(src, true);

export function print(t) {
  if (t.var !== undefined) return '?' + t.var;
  if (t.children.length === 0) return t.op;
  return '(' + t.op + ' ' + t.children.map(print).join(' ') + ')';
}

export function termSize(t) {
  let n = 1;
  for (const c of t.children) n += termSize(c);
  return n;
}

export function termDepth(t) {
  let d = 0;
  for (const c of t.children) d = Math.max(d, termDepth(c));
  return d + 1;
}

export const isIntLiteral = (op) => /^-?\d+$/.test(op);
