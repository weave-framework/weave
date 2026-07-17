import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/sidenav.gen';

// `<DocPage>` is referenced in sidenav.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Sidenav (route `/ui/sidenav`). */
export function setup(): Setup {
  return { source };
}
