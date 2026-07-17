import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/menubar.gen';

// `<DocPage>` is referenced in menubar.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Menubar (route `/ui/menubar`). */
export function setup(): Setup {
  return { source };
}
