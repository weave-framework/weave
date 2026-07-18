import { signal } from '@weave-framework/runtime';
import { menu, type MenuOptions } from '@weave-framework/ui/menu';
import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';

// `menu` is a use: action — it must be in scope for `use:menu` in the template.
void menu;
// Capitalized tags in the template resolve to these imports.
void Button;
void Icon;

interface Setup {
  menu: typeof menu;
  visibility: MenuOptions;
  chosen: () => string;
}

/**
 * `description` renders a smaller, lighter subtext line under an item's label — handy for a
 * one-line explanation of what each choice does.
 */
export function setup(): Setup {
  const chosen = signal('—');
  const visibility: MenuOptions = {
    items: [
      { value: 'public', label: 'Public', description: 'Anyone with the link can view' },
      { value: 'team', label: 'Team', description: 'Only people in your workspace' },
      { value: 'private', label: 'Private', description: 'Just you' },
    ],
    onSelect: (v) => chosen.set(String(v)),
  };
  return { menu, visibility, chosen };
}
