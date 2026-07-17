import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/input.gen';

// `<DocPage>` is referenced in input.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Input (route `/ui/input`). */
export function setup(): Setup {
  return { source };
}
