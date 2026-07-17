import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/quick-start.gen';

// `<DocPage>` is referenced in quick-start.html.
void DocPage;

interface QuickStartSetup {
  source: string;
}

/** Learn → quick-start (route `/learn/quick-start`). Content authored in
 *  Markdown (src/content/learn/quick-start.md) and rendered by <DocPage>. */
export function setup(): QuickStartSetup {
  return { source };
}
