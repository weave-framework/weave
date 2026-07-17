import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/paginator.gen';

// `<DocPage>` is referenced in paginator.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Paginator (route `/ui/paginator`). */
export function setup(): Setup {
  return { source };
}
