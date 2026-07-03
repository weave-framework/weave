import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in toolbar.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Toolbar (route `/ui/toolbar`). */
export function setup(): Setup {
  return { source: content['ui/toolbar'] ?? '' };
}
