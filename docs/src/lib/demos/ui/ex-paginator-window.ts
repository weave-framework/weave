import { signal } from '@weave-framework/runtime';
import Paginator from '@weave-framework/ui/paginator';

// Capitalized tags in the template resolve to this import.
void Paginator;

interface PageEvent {
  pageIndex: number;
  pageSize: number;
  length: number;
}
interface Setup {
  page: () => number;
  onPage: (e: PageEvent) => void;
}

/** `siblingCount` / `boundaryCount` widen the run of numbers around the current page and at each end. */
export function setup(): Setup {
  const page = signal(24);
  const onPage = (e: PageEvent): void => page.set(e.pageIndex);
  return { page, onPage };
}
