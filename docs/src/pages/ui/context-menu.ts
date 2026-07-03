import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in context-menu.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Context Menu (route `/ui/context-menu`). */
export function setup(): Setup {
  return { source: content['ui/context-menu'] ?? '' };
}
