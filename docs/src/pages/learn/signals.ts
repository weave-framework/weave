import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/signals.gen';

// `<DocPage>` is referenced in signals.html.
void DocPage;

interface SignalsSetup {
  source: string;
}

/** Learn → Thinking in signals (route `/learn/signals`). Content authored in
 *  Markdown (src/content/learn/signals.md) and rendered by <DocPage>. */
export function setup(): SignalsSetup {
  return { source };
}
