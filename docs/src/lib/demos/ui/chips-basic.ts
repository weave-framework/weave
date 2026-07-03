import { signal } from '@weave-framework/runtime';
import Chips from '@weave-framework/ui/chips';

// Capitalized tags in the template resolve to this import.
void Chips;

interface Setup {
  tags: () => string[];
  setTags: (v: string[]) => void;
  addTag: () => void;
}

/** A removable tag list — the value is the array of strings. */
export function setup(): Setup {
  const tags = signal<string[]>(['weave', 'signals', 'zero-dep']);
  let n = 0;
  return {
    tags,
    setTags: (v) => tags.set(v),
    addTag: () => tags.set([...tags(), `tag-${(n += 1)}`]),
  };
}
