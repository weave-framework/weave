import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/components.gen';

// `<DocPage>` is referenced in components.html.
void DocPage;

interface ComponentsSetup {
  source: string;
}

/** Learn → components (route `/learn/components`). Content authored in
 *  Markdown (src/content/learn/components.md) and rendered by <DocPage>. */
export function setup(): ComponentsSetup {
  return { source };
}
