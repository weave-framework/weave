import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/ripple.gen';

// `<DocPage>` is referenced in ripple.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Ripple (route `/ui/ripple`). */
export function setup(): Setup {
  return { source };
}
