import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in forms.html.
void DocPage;

interface FormsSetup {
  source: string;
}

/** Learn → forms (route `/learn/forms`). Content authored in
 *  Markdown (src/content/learn/forms.md) and rendered by <DocPage>. */
export function setup(): FormsSetup {
  return { source: content['learn/forms'] ?? '' };
}
