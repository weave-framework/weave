import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in table.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Table (route `/ui/table`). */
export function setup(): Setup {
  return { source: content['ui/table'] ?? '' };
}
