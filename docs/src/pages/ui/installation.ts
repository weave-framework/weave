import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/installation.gen';

// `<DocPage>` is referenced in installation.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Installation (route `/ui/installation`). */
export function setup(): Setup {
  return { source };
}
