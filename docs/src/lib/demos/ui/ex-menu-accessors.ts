import { signal } from '@weave-framework/runtime';
import { menu, type MenuOptions } from '@weave-framework/ui/menu';
import Button from '@weave-framework/ui/button';

// `menu` is a use: action — it must be in scope for `use:menu` in the template.
void menu;
// Capitalized tags in the template resolve to this import.
void Button;

/** An arbitrary domain object — not the default `{ value, label }` shape. */
interface User {
  id: string;
  name: string;
  role: string;
  suspended: boolean;
  sep?: boolean;
}

interface Setup {
  menu: typeof menu;
  assignMenu: MenuOptions<User>;
  assignee: () => string;
}

/**
 * Drive a menu from arbitrary objects: the `option*` accessors map each object to its
 * value / label / description / disabled, `isDivider` marks separators, and `emit: 'object'`
 * hands the whole object (not just a value string) to `onSelect`.
 */
export function setup(): Setup {
  const assignee = signal('—');
  const users: User[] = [
    { id: 'u1', name: 'Ada Lovelace', role: 'Owner', suspended: false },
    { id: 'u2', name: 'Alan Turing', role: 'Editor', suspended: false },
    { id: 'sep', name: '', role: '', suspended: false, sep: true },
    { id: 'u3', name: 'Grace Hopper', role: 'Viewer · suspended', suspended: true },
  ];
  const assignMenu: MenuOptions<User> = {
    items: users,
    optionValue: (u) => u.id,
    optionLabel: (u) => u.name,
    optionDescription: (u) => u.role,
    optionDisabled: (u) => u.suspended,
    isDivider: (u) => Boolean(u.sep),
    emit: 'object',
    onSelect: (u) => assignee.set(typeof u === 'string' ? u : u.name),
  };
  return { menu, assignMenu, assignee };
}
