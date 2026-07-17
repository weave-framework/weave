import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/grid-list.gen';

// `<DocPage>` is referenced in grid-list.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Grid List (route `/ui/grid-list`). */
export function setup(): Setup {
  return { source };
}
