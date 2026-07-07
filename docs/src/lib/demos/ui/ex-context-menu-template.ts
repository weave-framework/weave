import { signal } from '@weave-framework/runtime';
import { contextMenu } from '@weave-framework/ui/context-menu';
import Icon from '@weave-framework/ui/icon';

// `contextMenu` is a use: action — it must be in scope for `use:contextMenu`.
void contextMenu;
// Capitalized tags in the (snippet) template resolve to this import.
void Icon;

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
 * `itemTemplate` renders the whole row from an authored `@snippet` (see app.html), bound to the
 * full row context — `row.item` plus state (`row.checked`, reactive `row.active()`, `row.index`,
 * `row.disabled`). The template owns the layout, marker (a trailing `<Icon>` on the checked row)
 * and selected styling; `selected` still sets the ARIA. It's added inline
 * (`{ ...ctxOpts, itemTemplate: langRow }`) because a `@snippet` is a template-local value.
 */
export function setup(): Setup {
  const locale = signal('nl');
  const langs: Lang[] = [
    { value: 'en', label: 'English', flag: '🇬🇧' },
    { value: 'nl', label: 'Nederlands', flag: '🇳🇱' },
    { value: 'lt', label: 'Lietuvių', flag: '🇱🇹' },
  ];
  const ctxOpts = {
    items: langs,
    optionValue: (l: Lang) => l.value,
    optionLabel: (l: Lang) => l.label,
    selected: () => locale(),
    onSelect: (v: string | Lang) => locale.set(typeof v === 'string' ? v : v.value),
  };
  return { contextMenu, ctxOpts, locale };
}
