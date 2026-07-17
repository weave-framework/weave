import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/table.gen';

// `<DocPage>` is referenced in table.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Table (route `/ui/table`). */
export function setup(): Setup {
  return { source };
}
