import { signal } from '@weave-framework/runtime';
import Chips from '@weave-framework/ui/chips';

// Capitalized tags in the template resolve to this import.
void Chips;

interface Setup {
  tags: () => string[];
  setTags: (v: string[]) => void;
  removeLabel: (chip: string) => string;
}

/**
 * `removeLabel(chip)` customises each remove button's `aria-label` (default `Remove <chip>`).
 * `class` forwards extra classes onto the group.
 */
export function setup(): Setup {
  const tags = signal<string[]>(['design', 'engineering']);
  return {
    tags,
    setTags: (v) => tags.set(v),
    removeLabel: (chip) => `Dismiss the ${chip} team`,
  };
}
