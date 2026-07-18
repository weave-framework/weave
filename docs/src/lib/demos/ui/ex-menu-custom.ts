import { signal } from '@weave-framework/runtime';
import { menu, type MenuOptions } from '@weave-framework/ui/menu';
import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';

// `menu` is a use: action — it must be in scope for `use:menu` in the template.
void menu;
// Capitalized tags in the template resolve to these imports.
void Button;
void Icon;

interface Lang {
  value: string;
  label: string;
  flag: string;
}

interface Setup {
  menu: typeof menu;
  langMenu: MenuOptions<Lang>;
  locale: () => string;
}

/**
 * `optionContent` returns a DOM node used as the row body in place of the default label span —
 * here a flag + the native name. `optionLabel` still drives the accessible name and typeahead,
 * so typing "ne" still jumps to Nederlands even though the row shows a flag. For a row whose
 * design depends on state (checked/active), reach for `itemTemplate` instead.
 */
export function setup(): Setup {
  const locale = signal('en');
  const langs: Lang[] = [
    { value: 'en', label: 'English', flag: '🇬🇧' },
    { value: 'nl', label: 'Nederlands', flag: '🇳🇱' },
    { value: 'lt', label: 'Lietuvių', flag: '🇱🇹' },
  ];
  const flagRow = (l: Lang): Node => {
    const row = document.createElement('span');
    row.style.cssText = 'display:inline-flex; gap:8px; align-items:center;';
    const flag = document.createElement('span');
    flag.textContent = l.flag;
    const name = document.createElement('span');
    name.textContent = l.label;
    row.append(flag, name);
    return row;
  };
  const langMenu: MenuOptions<Lang> = {
    items: langs,
    optionValue: (l) => l.value,
    optionLabel: (l) => l.label,
    optionContent: flagRow,
    onSelect: (v) => locale.set(String(v)),
  };
  return { menu, langMenu, locale };
}
