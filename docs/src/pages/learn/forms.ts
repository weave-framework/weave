import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/forms.gen';

// `<DocPage>` is referenced in forms.html.
void DocPage;

interface FormsSetup {
  source: string;
}

/** Learn → forms (route `/learn/forms`). Content authored in
 *  Markdown (src/content/learn/forms.md) and rendered by <DocPage>. */
export function setup(): FormsSetup {
  return { source };
}
