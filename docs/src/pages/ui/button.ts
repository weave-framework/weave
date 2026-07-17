import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/button.gen';

// `<DocPage>` is referenced in button.html.
void DocPage;

interface ButtonSetup {
  source: string;
}

/** UI → Button (route `/ui/button`). Content authored in Markdown
 *  (src/content/ui/button.md) and rendered by <DocPage>. */
export function setup(): ButtonSetup {
  return { source };
}
