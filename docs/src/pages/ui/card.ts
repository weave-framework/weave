import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in card.html.
void DocPage;

interface CardSetup {
  source: string;
}

/** UI → Card (route `/ui/card`). Content authored in Markdown
 *  (src/content/ui/card.md) and rendered by <DocPage>. */
export function setup(): CardSetup {
  return { source: content['ui/card'] ?? '' };
}
