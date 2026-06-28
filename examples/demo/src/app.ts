import { RouterView, Link } from '@weave/router';
import { router } from './router';

// `RouterView` / `Link` are used as components in app.html — capitalized tags
// resolve to these module-level imports, so they need no entry in setup's return.
// Referencing them keeps the imports "used" for the type-checker.
void RouterView;
void Link;

/** Root shell: the app chrome (header + nav) around the routed view. */
export function setup() {
  return { router };
}
