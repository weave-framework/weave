import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/button-toggle.gen';

// `<DocPage>` is referenced in button-toggle.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Button Toggle (route `/ui/button-toggle`). */
export function setup(): Setup {
  return { source };
}
