import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/tree.gen';

// `<DocPage>` is referenced in tree.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Tree (route `/ui/tree`). */
export function setup(): Setup {
  return { source };
}
