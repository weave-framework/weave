import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/lifecycle-context-di.gen';

// `<DocPage>` is referenced in lifecycle-context-di.html.
void DocPage;

interface LifecycleContextDiSetup {
  source: string;
}

/** Learn → lifecycle-context-di (route `/learn/lifecycle-context-di`). Content authored in
 *  Markdown (src/content/learn/lifecycle-context-di.md) and rendered by <DocPage>. */
export function setup(): LifecycleContextDiSetup {
  return { source };
}
