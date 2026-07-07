import { signal } from '@weave-framework/runtime';
import Select from '@weave-framework/ui/select';

// Capitalized tags in the template resolve to this import.
void Select;

interface Setup {
  options: { value: string; label: string }[];
  langs: () => string[];
  setLangs: (v: unknown) => void;
}

/** Multi-select — the value is an array; the panel stays open and options show a check. */
export function setup(): Setup {
  const langs = signal<string[]>(['ts']);
  const options = [
    { value: 'ts', label: 'TypeScript' },
    { value: 'js', label: 'JavaScript' },
    { value: 'rs', label: 'Rust' },
    { value: 'go', label: 'Go' },
  ];
  return { options, langs, setLangs: (v) => langs.set(v as string[]) };
}
