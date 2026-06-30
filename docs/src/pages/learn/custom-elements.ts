import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in custom-elements.html.
void DocPage;

interface CustomElementsSetup {
  source: string;
}

/** Learn → custom-elements (route `/learn/custom-elements`). Content authored in
 *  Markdown (src/content/learn/custom-elements.md) and rendered by <DocPage>. */
export function setup(): CustomElementsSetup {
  return { source: content['learn/custom-elements'] ?? '' };
}
