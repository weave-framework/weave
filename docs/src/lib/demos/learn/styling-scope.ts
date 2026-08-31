import A from './styling-scope-a';
import B from './styling-scope-b';

// Both child tags in the template resolve to these imports.
void A;
void B;

/** Two siblings, one class name, no collision — and the page prints each one's real scope attribute. */
export function setup(): Record<string, never> {
  return {};
}
