import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in lifecycle-context-di.html.
void DocPage;

interface LifecycleContextDiSetup {
  source: string;
}

/** Learn → lifecycle-context-di (route `/learn/lifecycle-context-di`). Content authored in
 *  Markdown (src/content/learn/lifecycle-context-di.md) and rendered by <DocPage>. */
export function setup(): LifecycleContextDiSetup {
  return { source: content['learn/lifecycle-context-di'] ?? '' };
}
