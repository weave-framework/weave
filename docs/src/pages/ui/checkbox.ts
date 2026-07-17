import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/checkbox.gen';

// `<DocPage>` is referenced in checkbox.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Checkbox (route `/ui/checkbox`). */
export function setup(): Setup {
  return { source };
}
