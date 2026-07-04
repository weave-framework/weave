import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in todo.html.
void DocPage;

interface Setup {
  source: string;
}

/** Examples → Todo list (route `/examples/todo`). */
export function setup(): Setup {
  return { source: content['examples/todo'] ?? '' };
}
