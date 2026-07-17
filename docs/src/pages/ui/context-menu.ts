import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/context-menu.gen';

// `<DocPage>` is referenced in context-menu.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Context Menu (route `/ui/context-menu`). */
export function setup(): Setup {
  return { source };
}
