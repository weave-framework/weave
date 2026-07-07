import { signal } from '@weave-framework/runtime';
import { contextMenu } from '@weave-framework/ui/context-menu';

// `contextMenu` is a use: action — it must be in scope for `use:contextMenu`.
void contextMenu;

interface Lang {
  value: string;
  label: string;
  flag: string;
}

interface Setup {
  contextMenu: typeof contextMenu;
  ctxOpts: unknown;
  locale: () => string;
}

/**
 * `optionContent` returns a DOM node used as the row body in place of the default label — here
 * a flag + the native name. `optionLabel` still drives the accessible name + typeahead. For a
 * row whose design depends on state (checked/active), use `itemTemplate`.
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
  const ctxOpts = {
    items: langs,
    optionValue: (l: Lang) => l.value,
    optionLabel: (l: Lang) => l.label,
    optionContent: flagRow,
    onSelect: (v: string | Lang) => locale.set(typeof v === 'string' ? v : v.value),
  };
  return { contextMenu, ctxOpts, locale };
}
