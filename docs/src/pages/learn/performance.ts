import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/performance.gen';

// `<DocPage>` is referenced in performance.html.
void DocPage;

interface PerformanceSetup {
  source: string;
}

/** Learn → performance (route `/learn/performance`). Content authored in
 *  Markdown (src/content/learn/performance.md) and rendered by <DocPage>. */
export function setup(): PerformanceSetup {
  return { source };
}
