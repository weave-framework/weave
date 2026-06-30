import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in router.html.
void DocPage;

interface RouterSetup {
  source: string;
}

/** Learn → router (route `/learn/router`). Content authored in
 *  Markdown (src/content/learn/router.md) and rendered by <DocPage>. */
export function setup(): RouterSetup {
  return { source: content['learn/router'] ?? '' };
}
