import { signal } from '@weave-framework/runtime';
import Select from '@weave-framework/ui/select';

// Capitalized tags in the template resolve to this import.
void Select;

interface Setup {
  options: { value: string; label: string }[];
  a: () => string;
  setA: (v: unknown) => void;
  b: () => string;
  setB: (v: unknown) => void;
}

/** The two aria/state flags: `disabled` blocks interaction, `required` marks it required. */
export function setup(): Setup {
  const options = [
    { value: 'lt', label: 'Lithuania' },
    { value: 'lv', label: 'Latvia' },
    { value: 'ee', label: 'Estonia' },
  ];
  const a = signal('lt');
  const b = signal('');
  return {
    options,
    a,
    setA: (v) => a.set(v as string),
    b,
    setB: (v) => b.set(v as string),
  };
}
