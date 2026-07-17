import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/router.gen';

// `<DocPage>` is referenced in router.html.
void DocPage;

interface RouterSetup {
  source: string;
}

/** Learn → router (route `/learn/router`). Content authored in
 *  Markdown (src/content/learn/router.md) and rendered by <DocPage>. */
export function setup(): RouterSetup {
  return { source };
}
