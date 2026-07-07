import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in tree.html.
void DocPage;

interface TreeExamplesSetup {
  source: string;
}

/** Examples → Components → Tree (route `/examples/components/tree`). Authored in Markdown
 *  (src/content/examples/components/tree.md) and rendered by <DocPage>. */
export function setup(): TreeExamplesSetup {
  return { source: content['examples/components/tree'] ?? '' };
}
