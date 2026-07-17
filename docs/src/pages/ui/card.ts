import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/card.gen';

// `<DocPage>` is referenced in card.html.
void DocPage;

interface CardSetup {
  source: string;
}

/** UI → Card (route `/ui/card`). Content authored in Markdown
 *  (src/content/ui/card.md) and rendered by <DocPage>. */
export function setup(): CardSetup {
  return { source };
}
