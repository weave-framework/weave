import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

// Capitalized tags in the template resolve to this import.
void ButtonToggle;

interface Setup {
  opts: { value: string; label: string }[];
  size: () => string;
  setSize: (v: string | string[]) => void;
  disabled: () => boolean;
  toggle: () => void;
  label: () => string;
}

/** `disabled` on the group disables every segment at once — flip a signal to re-enable. */
export function setup(): Setup {
  const size = signal('m');
  const disabled = signal(true);
  const opts = [
    { value: 's', label: 'S' },
    { value: 'm', label: 'M' },
    { value: 'l', label: 'L' },
  ];
  return {
    opts,
    size,
    setSize: (v) => size.set(v as string),
    disabled,
    toggle: () => disabled.set((d) => !d),
    label: () => (disabled() ? 'Enable' : 'Disable'),
  };
}
