import { signal } from '@weave-framework/runtime';
import Tabs from '@weave-framework/ui/tabs';
import Icon from '@weave-framework/ui/icon';

// Capitalized tags in the template resolve to these imports.
void Tabs;
void Icon;

interface TabData {
  icon: string;
}

interface Setup {
  tabs: { label: string; content: string; data: TabData }[];
  idx: () => number;
  setIdx: (i: number) => void;
}

/**
 * `tabTemplate` hands `<Tabs>` an authored `@snippet` (see app.html) that renders the WHOLE
 * tab-button content — here an `<Icon>` before the label — from each tab's `row.item.data`.
 * The framework still owns the `<button role=tab>`, ARIA, roving tabindex and the panels;
 * `row.label` stays the accessible name, and the active tab is styled via the framework's
 * `[aria-selected='true']` hook. Mirrors the menu's `itemTemplate` (FW-10 / FW-12). The
 * snippet is added inline (`tabTemplate={{ tabButton }}`) because a `@snippet` is a
 * template-local value.
 */
export function setup(): Setup {
  const idx = signal(0);
  const tabs = [
    { label: 'Profile', content: 'Your public profile.', data: { icon: 'user' } },
    { label: 'Password', content: 'Change your password.', data: { icon: 'lock' } },
    { label: 'Preferences', content: 'Theme, language and more.', data: { icon: 'settings' } },
  ];
  return { tabs, idx, setIdx: (i) => idx.set(i) };
}
