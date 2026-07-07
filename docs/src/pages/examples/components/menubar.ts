import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in menubar.html.
void DocPage;

interface MenubarExamplesSetup {
  source: string;
}

/** Examples → Components → Menubar (route `/examples/components/menubar`). Authored in Markdown
 *  (src/content/examples/components/menubar.md) and rendered by <DocPage>. */
export function setup(): MenubarExamplesSetup {
  return { source: content['examples/components/menubar'] ?? '' };
}
