import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in tree.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Tree (route `/ui/tree`). */
export function setup(): Setup {
  return { source: content['ui/tree'] ?? '' };
}
