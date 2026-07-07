import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in toolbar.html.
void DocPage;

interface ToolbarExamplesSetup {
  source: string;
}

/** Examples → Components → Toolbar (route `/examples/components/toolbar`). A full live example
 *  gallery covering the whole `<Toolbar>` surface. Authored in Markdown
 *  (src/content/examples/components/toolbar.md) and rendered by <DocPage>. */
export function setup(): ToolbarExamplesSetup {
  return { source: content['examples/components/toolbar'] ?? '' };
}
