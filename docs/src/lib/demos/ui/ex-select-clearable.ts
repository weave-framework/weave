import { signal } from '@weave-framework/runtime';
import Select from '@weave-framework/ui/select';

// Capitalized tags in the template resolve to this import.
void Select;

interface Setup {
  options: { value: string; label: string }[];
  fruit: () => string | undefined;
  setFruit: (v: unknown) => void;
}

/**
 * `clearable` shows a `×` button once something is selected; it empties the value.
 * `clearLabel` names it for assistive tech.
 */
export function setup(): Setup {
  const fruit = signal<string | undefined>('apple');
  const options = [
    { value: 'apple', label: 'Apple' },
    { value: 'pear', label: 'Pear' },
    { value: 'plum', label: 'Plum' },
  ];
  return { options, fruit, setFruit: (v) => fruit.set(v as string | undefined) };
}
