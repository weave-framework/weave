import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/menu.gen';

// `<DocPage>` is referenced in menu.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Menu (route `/ui/menu`). */
export function setup(): Setup {
  return { source };
}
