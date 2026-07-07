import { signal } from '@weave-framework/runtime';
import Select from '@weave-framework/ui/select';

// Capitalized tags in the template resolve to this import.
void Select;

interface Setup {
  options: { value: string; label: string }[];
  value: () => string;
  setValue: (v: unknown) => void;
}

/**
 * `position` places the panel relative to the trigger — here `top-start` opens it
 * above the field (it still flips on overflow). Default is `bottom-start`.
 */
export function setup(): Setup {
  const options = [
    { value: 'one', label: 'One' },
    { value: 'two', label: 'Two' },
    { value: 'three', label: 'Three' },
  ];
  const value = signal('two');
  return { options, value, setValue: (v) => value.set(v as string) };
}
