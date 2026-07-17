import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/button.gen';

// `<DocPage>` is referenced in button.html.
void DocPage;

interface ButtonExamplesSetup {
  source: string;
}

/** Examples → Components → Button (route `/examples/components/button`). A full live example
 *  gallery covering the whole `<Button>` surface. Authored in Markdown
 *  (src/content/examples/components/button.md) and rendered by <DocPage>. */
export function setup(): ButtonExamplesSetup {
  return { source };
}
