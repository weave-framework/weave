import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in settings.html.
void DocPage;

interface Setup {
  source: string;
}

/** Examples → Settings panel (route `/examples/settings`). */
export function setup(): Setup {
  return { source: content['examples/settings'] ?? '' };
}
