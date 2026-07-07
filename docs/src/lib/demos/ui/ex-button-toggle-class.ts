import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

// Capitalized tags in the template resolve to this import.
void ButtonToggle;

interface Setup {
  opts: { value: string; label: string }[];
  view: () => string;
  setView: (v: string | string[]) => void;
}

/** `class` is forwarded onto the group container alongside the Weave classes. */
export function setup(): Setup {
  const view = signal('all');
  const opts = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'done', label: 'Done' },
  ];
  return { opts, view, setView: (v) => view.set(v as string) };
}
