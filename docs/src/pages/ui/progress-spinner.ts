import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in progress-spinner.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Progress Spinner (route `/ui/progress-spinner`). */
export function setup(): Setup {
  return { source: content['ui/progress-spinner'] ?? '' };
}
