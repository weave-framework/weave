import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in performance.html.
void DocPage;

interface PerformanceSetup {
  source: string;
}

/** Learn → performance (route `/learn/performance`). Content authored in
 *  Markdown (src/content/learn/performance.md) and rendered by <DocPage>. */
export function setup(): PerformanceSetup {
  return { source: content['learn/performance'] ?? '' };
}
