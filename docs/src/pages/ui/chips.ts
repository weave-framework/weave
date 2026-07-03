import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in chips.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Chips (route `/ui/chips`). */
export function setup(): Setup {
  return { source: content['ui/chips'] ?? '' };
}
