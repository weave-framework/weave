import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in paginator.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Paginator (route `/ui/paginator`). */
export function setup(): Setup {
  return { source: content['ui/paginator'] ?? '' };
}
