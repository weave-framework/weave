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
  sizes: number[];
  onPage: (e: PageEvent) => void;
}

/** `pageSizeOptions` adds the page-size menu; changing it keeps the first item in view. */
export function setup(): Setup {
  const page = signal(0);
  const size = signal(12);
  const onPage = (e: PageEvent): void => {
    page.set(e.pageIndex);
    size.set(e.pageSize);
  };
  return { page, size, sizes: [12, 24, 48], onPage };
}
