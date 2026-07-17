import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/enterprise/incremental-adoption.gen';

// `<DocPage>` is referenced in incremental-adoption.html.
void DocPage;

interface Setup {
  source: string;
}

/** Enterprise → Adopt Weave one piece at a time (route `/enterprise/incremental-adoption`). */
export function setup(): Setup {
  return { source };
}
