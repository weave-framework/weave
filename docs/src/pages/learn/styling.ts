import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in styling.html.
void DocPage;

interface StylingSetup {
  source: string;
}

/** Learn → styling (route `/learn/styling`). Content authored in
 *  Markdown (src/content/learn/styling.md) and rendered by <DocPage>. */
export function setup(): StylingSetup {
  return { source: content['learn/styling'] ?? '' };
}
