import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

// Capitalized tags in the template resolve to this import.
void ButtonToggle;

interface Setup {
  opts: { value: string; label: string; icon: string }[];
  view: () => string;
  setView: (v: string | string[]) => void;
}

/** An `icon` on each option renders a leading <Icon> before the label. */
export function setup(): Setup {
  const view = signal('list');
  const opts = [
    { value: 'list', label: 'List', icon: 'menu' },
    { value: 'board', label: 'Board', icon: 'house' },
    { value: 'calendar', label: 'Calendar', icon: 'calendar' },
  ];
  return { opts, view, setView: (v) => view.set(v as string) };
}
