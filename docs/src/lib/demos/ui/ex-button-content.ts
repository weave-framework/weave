import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';

// Capitalized tags in the template resolve to these imports.
void Button;
void Icon;

/** The default slot — whatever you project becomes the button's content: text, icon + text, or an icon alone. */
export function setup(): Record<string, never> {
  return {};
}
