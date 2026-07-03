import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in checkbox.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Checkbox (route `/ui/checkbox`). */
export function setup(): Setup {
  return { source: content['ui/checkbox'] ?? '' };
}
