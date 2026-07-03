import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in divider.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Divider (route `/ui/divider`). */
export function setup(): Setup {
  return { source: content['ui/divider'] ?? '' };
}
