import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in menubar.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Menubar (route `/ui/menubar`). */
export function setup(): Setup {
  return { source: content['ui/menubar'] ?? '' };
}
