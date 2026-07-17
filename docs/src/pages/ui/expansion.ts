import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/expansion.gen';

// `<DocPage>` is referenced in expansion.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Expansion Panel (route `/ui/expansion`). */
export function setup(): Setup {
  return { source };
}
