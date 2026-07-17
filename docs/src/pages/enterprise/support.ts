import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/enterprise/support.gen';

// `<DocPage>` is referenced in support.html.
void DocPage;

interface Setup {
  source: string;
}

/** Enterprise → Support (route `/enterprise/support`). */
export function setup(): Setup {
  return { source };
}
