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

/** `label` names the <nav> landmark for assistive tech; `class` forwards extra classes onto it. */
export function setup(): Setup {
  const page = signal(0);
  const onPage = (e: PageEvent): void => page.set(e.pageIndex);
  return { page, onPage };
}
