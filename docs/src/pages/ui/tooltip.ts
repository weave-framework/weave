import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/tooltip.gen';

// `<DocPage>` is referenced in tooltip.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Tooltip (route `/ui/tooltip`). */
export function setup(): Setup {
  return { source };
}
