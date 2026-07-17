import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/store.gen';

// `<DocPage>` is referenced in store.html.
void DocPage;

interface StoreSetup {
  source: string;
}

/** Learn → store (route `/learn/store`). Content authored in
 *  Markdown (src/content/learn/store.md) and rendered by <DocPage>. */
export function setup(): StoreSetup {
  return { source };
}
