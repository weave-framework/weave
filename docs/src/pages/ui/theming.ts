import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in theming.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Styling & theming (route `/ui/theming`). */
export function setup(): Setup {
  return { source: content['ui/theming'] ?? '' };
}
