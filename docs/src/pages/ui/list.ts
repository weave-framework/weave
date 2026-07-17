import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/list.gen';

// `<DocPage>` is referenced in list.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → List (route `/ui/list`). */
export function setup(): Setup {
  return { source };
}
