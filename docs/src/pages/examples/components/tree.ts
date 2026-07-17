import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/tree.gen';

// `<DocPage>` is referenced in tree.html.
void DocPage;

interface TreeExamplesSetup {
  source: string;
}

/** Examples → Components → Tree (route `/examples/components/tree`). Authored in Markdown
 *  (src/content/examples/components/tree.md) and rendered by <DocPage>. */
export function setup(): TreeExamplesSetup {
  return { source };
}
