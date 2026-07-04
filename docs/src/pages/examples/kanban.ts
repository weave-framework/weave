import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in kanban.html.
void DocPage;

interface Setup {
  source: string;
}

/** Examples → Kanban board (route `/examples/kanban`). */
export function setup(): Setup {
  return { source: content['examples/kanban'] ?? '' };
}
