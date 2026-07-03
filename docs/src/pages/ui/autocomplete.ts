import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in autocomplete.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Autocomplete (route `/ui/autocomplete`). */
export function setup(): Setup {
  return { source: content['ui/autocomplete'] ?? '' };
}
