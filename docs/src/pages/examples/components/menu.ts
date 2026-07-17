import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/menu.gen';

// `<DocPage>` is referenced in menu.html.
void DocPage;

interface MenuExamplesSetup {
  source: string;
}

/** Examples → Components → Menu (route `/examples/components/menu`). Authored in Markdown
 *  (src/content/examples/components/menu.md) and rendered by <DocPage>. */
export function setup(): MenuExamplesSetup {
  return { source };
}
