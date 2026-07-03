import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in tabs.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Tabs (route `/ui/tabs`). */
export function setup(): Setup {
  return { source: content['ui/tabs'] ?? '' };
}
