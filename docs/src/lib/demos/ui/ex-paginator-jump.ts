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

/** `showJump` keeps the manual go-to-page input; `jumpLabel` renames it. Type a page and press Enter. */
export function setup(): Setup {
  const page = signal(0);
  const onPage = (e: PageEvent): void => page.set(e.pageIndex);
  return { page, onPage };
}
