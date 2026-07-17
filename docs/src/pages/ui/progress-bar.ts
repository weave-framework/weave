import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/progress-bar.gen';

// `<DocPage>` is referenced in progress-bar.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Progress Bar (route `/ui/progress-bar`). */
export function setup(): Setup {
  return { source };
}
