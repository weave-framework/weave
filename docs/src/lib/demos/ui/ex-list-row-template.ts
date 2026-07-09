import { signal } from '@weave-framework/runtime';
import List from '@weave-framework/ui/list';
import Badge from '@weave-framework/ui/badge';
import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';

// Capitalized tags in the template resolve to these imports.
void List;
void Badge;
void Button;
void Icon;

interface Role {
  id: string;
  name: string;
  color: string;
  users: number;
  system: boolean;
  description: string;
}

interface Setup {
  items: { value: string; title: string; data: Role }[];
  lastAction: () => string;
  dot: (color: string) => string;
  edit: (r: Role) => void;
  remove: (r: Role) => void;
}

/**
 * `rowTemplate` hands a non-selectable `<List>` an authored `@snippet` (see app.html) that
 * renders the WHOLE row body — a colour dot, the name, count pills and trailing action
 * buttons — from each row's `row.data`. The framework still owns `.weave-list__row`, its
 * `role="listitem"` and layout; the template only fills the content. Because the row is not
 * selectable, the trailing `<Button>`s are plain clickable controls. Mirrors the menu's
 * `itemTemplate` (FW-10) and tabs' `tabTemplate` (FW-12); the snippet is passed inline
 * (`rowTemplate={{ roleRow }}`) because a `@snippet` is a template-local value.
 */
export function setup(): Setup {
  const lastAction = signal('—');
  const roles: Role[] = [
    { id: 'admin', name: 'Admin', color: '#e11d48', users: 3, system: true, description: 'Full access to every setting.' },
    { id: 'editor', name: 'Editor', color: '#0d9488', users: 9, system: false, description: 'Create and edit content.' },
    { id: 'viewer', name: 'Viewer', color: '#3b82f6', users: 42, system: false, description: 'Read-only access.' },
  ];
  const items = roles.map((r) => ({ value: r.id, title: r.name, data: r }));
  return {
    items,
    lastAction,
    dot: (color) => `width:10px; height:10px; border-radius:50%; flex:none; background:${color}`,
    edit: (r) => lastAction.set(`Edit ${r.name}`),
    remove: (r) => lastAction.set(`Delete ${r.name}`),
  };
}
