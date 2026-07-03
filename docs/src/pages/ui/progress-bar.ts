import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in progress-bar.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Progress Bar (route `/ui/progress-bar`). */
export function setup(): Setup {
  return { source: content['ui/progress-bar'] ?? '' };
}
