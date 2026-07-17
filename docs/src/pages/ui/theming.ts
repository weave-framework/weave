import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/theming.gen';

// `<DocPage>` is referenced in theming.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Styling & theming (route `/ui/theming`). */
export function setup(): Setup {
  return { source };
}
