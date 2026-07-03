import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

// Capitalized tags in the template resolve to this import.
void ButtonToggle;

interface Setup {
  opts: { value: string; label: string }[];
  view: () => string;
  setView: (v: string | string[]) => void;
}

/** Single-select (radio-group semantics) — the value is the chosen key. */
export function setup(): Setup {
  const view = signal('list');
  const opts = [
    { value: 'list', label: 'List' },
    { value: 'grid', label: 'Grid' },
    { value: 'map', label: 'Map' },
  ];
  return { opts, view, setView: (v) => view.set(v as string) };
}
