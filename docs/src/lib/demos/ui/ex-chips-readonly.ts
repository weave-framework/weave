import { signal } from '@weave-framework/runtime';
import Chips from '@weave-framework/ui/chips';

// Capitalized tags in the template resolve to this import.
void Chips;

interface Setup {
  tags: () => string[];
}

/** `removable={{ false }}` drops the `×` button — read-only display tags. */
export function setup(): Setup {
  const tags = signal<string[]>(['stable', 'zero-dep', 'signal-native']);
  return { tags };
}
