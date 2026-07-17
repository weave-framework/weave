import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/table.gen';

// `<DocPage>` is referenced in table.html.
void DocPage;

interface TableExamplesSetup {
  source: string;
}

/** Examples → Components → Table (route `/examples/components/table`). Authored in Markdown
 *  (src/content/examples/components/table.md) and rendered by <DocPage>. */
export function setup(): TableExamplesSetup {
  return { source };
}
