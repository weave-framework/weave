import { signal } from '@weave-framework/runtime';
import Badge from '@weave-framework/ui/badge';
import Icon from '@weave-framework/ui/icon';

// Capitalized tags in the template resolve to these imports.
void Badge;
void Icon;

interface Setup {
  count: () => number;
  inc: () => void;
  clear: () => void;
}

/**
 * `content` is the number/text the `count` pill shows. It's reactive — drive it from a signal and the
 * pill tracks it. A `count` badge with empty/missing `content` renders no pill at all.
 */
export function setup(): Setup {
  const count = signal(2);
  return {
    count,
    inc: (): void => count.set((n) => n + 1),
    clear: (): void => count.set(0),
  };
}
