import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/select.gen';

// `<DocPage>` is referenced in select.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Select (route `/ui/select`). */
export function setup(): Setup {
  return { source };
}
