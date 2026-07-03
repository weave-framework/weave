import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in input.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Input (route `/ui/input`). */
export function setup(): Setup {
  return { source: content['ui/input'] ?? '' };
}
