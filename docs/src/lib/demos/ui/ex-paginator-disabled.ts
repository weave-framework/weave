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

/** `disabled` freezes every control — navigation, the jump input and the size menu all ignore input. */
export function setup(): Setup {
  const page = signal(3);
  const onPage = (e: PageEvent): void => page.set(e.pageIndex);
  return { page, onPage };
}
