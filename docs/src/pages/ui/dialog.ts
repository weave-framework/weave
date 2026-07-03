import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in dialog.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Dialog (route `/ui/dialog`). */
export function setup(): Setup {
  return { source: content['ui/dialog'] ?? '' };
}
