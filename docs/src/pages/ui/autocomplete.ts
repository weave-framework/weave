import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/autocomplete.gen';

// `<DocPage>` is referenced in autocomplete.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Autocomplete (route `/ui/autocomplete`). */
export function setup(): Setup {
  return { source };
}
