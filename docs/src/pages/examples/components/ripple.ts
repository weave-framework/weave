import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/ripple.gen';

// `<DocPage>` is referenced in ripple.html.
void DocPage;

interface RippleExamplesSetup {
  source: string;
}

/** Examples → Components → Ripple (route `/examples/components/ripple`). A full live example
 *  gallery covering the whole `<Ripple>` surface. Authored in Markdown
 *  (src/content/examples/components/ripple.md) and rendered by <DocPage>. */
export function setup(): RippleExamplesSetup {
  return { source };
}
