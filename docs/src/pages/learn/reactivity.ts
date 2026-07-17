import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/reactivity.gen';

// `<DocPage>` is referenced in reactivity.html.
void DocPage;

interface ReactivitySetup {
  source: string;
}

/** Learn → reactivity (route `/learn/reactivity`). Content authored in
 *  Markdown (src/content/learn/reactivity.md) and rendered by <DocPage>. */
export function setup(): ReactivitySetup {
  return { source };
}
