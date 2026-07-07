import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in table.html.
void DocPage;

interface TableExamplesSetup {
  source: string;
}

/** Examples → Components → Table (route `/examples/components/table`). Authored in Markdown
 *  (src/content/examples/components/table.md) and rendered by <DocPage>. */
export function setup(): TableExamplesSetup {
  return { source: content['examples/components/table'] ?? '' };
}
