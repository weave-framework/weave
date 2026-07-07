import { signal } from '@weave-framework/runtime';
import Chips from '@weave-framework/ui/chips';

// Capitalized tags in the template resolve to this import.
void Chips;

interface Setup {
  tags: () => string[];
  setTags: (v: string[]) => void;
  addTag: () => void;
}

/** `disabled` freezes the whole group — no focus, no removal, and the add chip is inert. */
export function setup(): Setup {
  const tags = signal<string[]>(['locked', 'frozen']);
  return {
    tags,
    setTags: (v) => tags.set(v),
    addTag: () => tags.set([...tags(), 'never']),
  };
}
