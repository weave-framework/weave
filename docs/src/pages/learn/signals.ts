import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in signals.html.
void DocPage;

interface SignalsSetup {
  source: string;
}

/** Learn → Thinking in signals (route `/learn/signals`). Content authored in
 *  Markdown (src/content/learn/signals.md) and rendered by <DocPage>. */
export function setup(): SignalsSetup {
  return { source: content['learn/signals'] ?? '' };
}
