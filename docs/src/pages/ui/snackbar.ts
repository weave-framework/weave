import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/snackbar.gen';

// `<DocPage>` is referenced in snackbar.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Snackbar (route `/ui/snackbar`). */
export function setup(): Setup {
  return { source };
}
