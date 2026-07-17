import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/tabs.gen';

// `<DocPage>` is referenced in tabs.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Tabs (route `/ui/tabs`). */
export function setup(): Setup {
  return { source };
}
