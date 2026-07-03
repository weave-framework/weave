import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in radio.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Radio Group (route `/ui/radio`). */
export function setup(): Setup {
  return { source: content['ui/radio'] ?? '' };
}
