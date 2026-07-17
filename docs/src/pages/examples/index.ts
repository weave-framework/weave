import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/examples/index.gen';

// `<DocPage>` is referenced in index.html.
void DocPage;

interface Setup {
  source: string;
}

/** Examples → Overview (route `/examples`). Content authored in Markdown
 *  (src/content/examples/index.md) and rendered by <DocPage>. */
export function setup(): Setup {
  return { source };
}
