import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in list.html.
void DocPage;

interface ListExamplesSetup {
  source: string;
}

/** Examples → Components → List (route `/examples/components/list`). Authored in Markdown
 *  (src/content/examples/components/list.md) and rendered by <DocPage>. */
export function setup(): ListExamplesSetup {
  return { source: content['examples/components/list'] ?? '' };
}
