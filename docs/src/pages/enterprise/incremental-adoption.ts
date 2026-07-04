import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in incremental-adoption.html.
void DocPage;

interface Setup {
  source: string;
}

/** Enterprise → Adopt Weave one piece at a time (route `/enterprise/incremental-adoption`). */
export function setup(): Setup {
  return { source: content['enterprise/incremental-adoption'] ?? '' };
}
