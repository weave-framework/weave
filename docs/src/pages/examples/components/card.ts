import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in card.html.
void DocPage;

interface CardExamplesSetup {
  source: string;
}

/** Examples → Components → Card (route `/examples/components/card`). A full live example
 *  gallery covering the whole `<Card>` surface. Authored in Markdown
 *  (src/content/examples/components/card.md) and rendered by <DocPage>. */
export function setup(): CardExamplesSetup {
  return { source: content['examples/components/card'] ?? '' };
}
