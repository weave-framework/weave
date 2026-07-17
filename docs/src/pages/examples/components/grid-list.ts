import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/grid-list.gen';

// `<DocPage>` is referenced in grid-list.html.
void DocPage;

interface GridListExamplesSetup {
  source: string;
}

/** Examples → Components → GridList (route `/examples/components/grid-list`). Authored in Markdown
 *  (src/content/examples/components/grid-list.md) and rendered by <DocPage>. */
export function setup(): GridListExamplesSetup {
  return { source };
}
