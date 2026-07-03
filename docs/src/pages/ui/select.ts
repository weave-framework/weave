import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in select.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Select (route `/ui/select`). */
export function setup(): Setup {
  return { source: content['ui/select'] ?? '' };
}
