import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/examples/kanban.gen';

// `<DocPage>` is referenced in kanban.html.
void DocPage;

interface Setup {
  source: string;
}

/** Examples → Kanban board (route `/examples/kanban`). */
export function setup(): Setup {
  return { source };
}
