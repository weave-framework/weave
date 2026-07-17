import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/examples/todo.gen';

// `<DocPage>` is referenced in todo.html.
void DocPage;

interface Setup {
  source: string;
}

/** Examples → Todo list (route `/examples/todo`). */
export function setup(): Setup {
  return { source };
}
