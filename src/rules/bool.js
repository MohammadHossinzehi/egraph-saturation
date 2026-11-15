// Boolean algebra over and / or / not with the constants true and false.

import { rewrite, birewrite } from '../rewrite.js';

export const boolRules = [
  rewrite('comm-and', '(and ?a ?b)', '(and ?b ?a)'),
  rewrite('comm-or', '(or ?a ?b)', '(or ?b ?a)'),
  ...birewrite('assoc-and', '(and ?a (and ?b ?c))', '(and (and ?a ?b) ?c)'),
  ...birewrite('assoc-or', '(or ?a (or ?b ?c))', '(or (or ?a ?b) ?c)'),
  rewrite('double-neg', '(not (not ?a))', '?a'),
  ...birewrite('de-morgan-and', '(not (and ?a ?b))', '(or (not ?a) (not ?b))'),
  ...birewrite('de-morgan-or', '(not (or ?a ?b))', '(and (not ?a) (not ?b))'),
  rewrite('and-true', '(and ?a true)', '?a'),
  rewrite('or-false', '(or ?a false)', '?a'),
  rewrite('and-false', '(and ?a false)', 'false'),
  rewrite('or-true', '(or ?a true)', 'true'),
  rewrite('and-idem', '(and ?a ?a)', '?a'),
  rewrite('or-idem', '(or ?a ?a)', '?a'),
  rewrite('excluded-middle', '(or ?a (not ?a))', 'true'),
  rewrite('contradiction', '(and ?a (not ?a))', 'false'),
  rewrite('absorb-and', '(and ?a (or ?a ?b))', '?a'),
  rewrite('absorb-or', '(or ?a (and ?a ?b))', '?a'),
  rewrite('dist-and', '(and ?a (or ?b ?c))', '(or (and ?a ?b) (and ?a ?c))'),
  rewrite('factor-and', '(or (and ?a ?b) (and ?a ?c))', '(and ?a (or ?b ?c))'),
  rewrite('not-true', '(not true)', 'false'),
  rewrite('not-false', '(not false)', 'true'),
];
