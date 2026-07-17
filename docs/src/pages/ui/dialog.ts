import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/dialog.gen';

// `<DocPage>` is referenced in dialog.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Dialog (route `/ui/dialog`). */
export function setup(): Setup {
  return { source };
}
