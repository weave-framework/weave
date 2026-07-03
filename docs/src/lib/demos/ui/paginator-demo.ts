import { signal } from '@weave-framework/runtime';
import Paginator from '@weave-framework/ui/paginator';

// Capitalized tags in the template resolve to this import.
void Paginator;

interface PageEvent {
  pageIndex: number;
  pageSize: number;
}
interface Setup {
  page: () => number;
  size: () => number;
  onPage: (e: PageEvent) => void;
}

/** A paginator over 240 items, controlled by page + size signals. */
export function setup(): Setup {
  const page = signal(0);
  const size = signal(10);
  const onPage = (e: PageEvent): void => {
    page.set(e.pageIndex);
    size.set(e.pageSize);
  };
  return { page, size, onPage };
}
