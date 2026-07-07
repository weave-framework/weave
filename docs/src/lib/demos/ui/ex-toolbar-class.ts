import Toolbar from '@weave-framework/ui/toolbar';
import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';

// Capitalized tags in the template resolve to these imports.
void Toolbar;
void Button;
void Icon;

/** `class` is forwarded onto the container, so layout tweaks stay the consumer's job. */
export function setup(): Record<string, never> {
  return {};
}
