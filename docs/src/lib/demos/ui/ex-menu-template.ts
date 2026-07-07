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
 * `itemTemplate` hands the menu an authored `@snippet` (see app.html) that renders the WHOLE
 * row and receives the full row context — `row.item` (the JSON), plus state: `row.checked`
 * (matches `selected`), `row.active()` (reactive keyboard highlight), `row.index`,
 * `row.disabled`. The template owns the layout, the marker (here a trailing `<Icon>` on the
 * checked row) and the selected background — none of it weave's default markup. `optionLabel`
 * still drives the accessible name + typeahead; `selected` still sets `role=menuitemradio` +
 * `aria-checked`. The template is added inline (`{ ...langMenu, itemTemplate: langRow }`)
 * because a `@snippet` is a template-local value.
 */
export function setup(): Setup {
  const locale = signal('nl');
  const langs: Lang[] = [
    { value: 'en', label: 'English', flag: '🇬🇧' },
    { value: 'nl', label: 'Nederlands', flag: '🇳🇱' },
    { value: 'lt', label: 'Lietuvių', flag: '🇱🇹' },
  ];
  const langMenu: MenuOptions<Lang> = {
    items: langs,
    optionValue: (l) => l.value,
    optionLabel: (l) => l.label,
    selected: () => locale(),
    onSelect: (v) => locale.set(String(v)),
  };
  return { menu, langMenu, locale };
}
