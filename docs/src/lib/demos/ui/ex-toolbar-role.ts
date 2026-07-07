import Toolbar from '@weave-framework/ui/toolbar';
import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';

// Capitalized tags in the template resolve to these imports.
void Toolbar;
void Button;
void Icon;

/** Toolbar sets no role itself — add `role="banner"` (or `"toolbar"`) yourself when the context calls for one. */
export function setup(): Record<string, never> {
  return {};
}
