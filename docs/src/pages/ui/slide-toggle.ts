import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in slide-toggle.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Slide Toggle (route `/ui/slide-toggle`). */
export function setup(): Setup {
  return { source: content['ui/slide-toggle'] ?? '' };
}
