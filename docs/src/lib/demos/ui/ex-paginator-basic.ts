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
  size: () => number;
  onPage: (e: PageEvent) => void;
  from: () => number;
  to: () => number;
}

/** A paginator over 240 items, controlled by page + size signals. */
export function setup(): Setup {
  const page = signal(0);
  const size = signal(10);
  const onPage = (e: PageEvent): void => {
    page.set(e.pageIndex);
    size.set(e.pageSize);
  };
  const from = (): number => page() * size() + 1;
  const to = (): number => Math.min(240, (page() + 1) * size());
  return { page, size, onPage, from, to };
}
