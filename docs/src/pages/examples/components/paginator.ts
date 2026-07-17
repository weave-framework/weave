import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/paginator.gen';

// `<DocPage>` is referenced in paginator.html.
void DocPage;

interface PaginatorExamplesSetup {
  source: string;
}

/** Examples → Components → Paginator (route `/examples/components/paginator`). Authored in Markdown
 *  (src/content/examples/components/paginator.md) and rendered by <DocPage>. */
export function setup(): PaginatorExamplesSetup {
  return { source };
}
