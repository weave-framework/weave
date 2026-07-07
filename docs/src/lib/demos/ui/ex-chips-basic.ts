import { signal } from '@weave-framework/runtime';
import Chips from '@weave-framework/ui/chips';

// Capitalized tags in the template resolve to this import.
void Chips;

interface Setup {
  tags: () => string[];
  setTags: (v: string[]) => void;
}

/** The value is the array of chip strings; removing a chip emits the shorter array. */
export function setup(): Setup {
  const tags = signal<string[]>(['weave', 'signals', 'zero-dep']);
  return { tags, setTags: (v) => tags.set(v) };
}
