import { signal } from '@weave-framework/runtime';
import Chips from '@weave-framework/ui/chips';

// Capitalized tags in the template resolve to this import.
void Chips;

interface Setup {
  tags: () => string[];
  setTags: (v: string[]) => void;
  addTag: () => void;
}

/**
 * `onAdd` renders the dashed "+ Add" chip; `addLabel` sets its text. Chips is controlled,
 * so you decide what "add" means — here we prompt and append.
 */
export function setup(): Setup {
  const tags = signal<string[]>(['weave', 'signals']);
  const addTag = (): void => {
    const next = window.prompt('New tag?')?.trim();
    if (next) tags.set([...tags(), next]);
  };
  return { tags, setTags: (v) => tags.set(v), addTag };
}
