import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/progress-spinner.gen';

// `<DocPage>` is referenced in progress-spinner.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Progress Spinner (route `/ui/progress-spinner`). */
export function setup(): Setup {
  return { source };
}
