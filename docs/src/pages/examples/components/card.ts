import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/card.gen';

// `<DocPage>` is referenced in card.html.
void DocPage;

interface CardExamplesSetup {
  source: string;
}

/** Examples → Components → Card (route `/examples/components/card`). A full live example
 *  gallery covering the whole `<Card>` surface. Authored in Markdown
 *  (src/content/examples/components/card.md) and rendered by <DocPage>. */
export function setup(): CardExamplesSetup {
  return { source };
}
