import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

// Capitalized tags in the template resolve to this import.
void Button;

interface Setup {
  pages: number[];
  page: () => number;
  select: (n: number) => void;
  currentOf: (n: number) => string | undefined;
}

/**
 * `ariaCurrent` sets `aria-current` — mark the active item in a set (here, the current page in a
 * paginator). Screen readers announce the selected page as "current".
 */
export function setup(): Setup {
  const page = signal(1);
  return {
    pages: [1, 2, 3, 4],
    page,
    select: (n: number): void => page.set(n),
    // `'page'` on the active button, undefined on the rest → no attribute at all.
    currentOf: (n: number): string | undefined => (page() === n ? 'page' : undefined),
  };
}
