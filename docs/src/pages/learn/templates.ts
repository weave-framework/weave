import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/templates.gen';

// `<DocPage>` is referenced in templates.html.
void DocPage;

interface TemplatesSetup {
  source: string;
}

/** Learn → templates (route `/learn/templates`). Content authored in
 *  Markdown (src/content/learn/templates.md) and rendered by <DocPage>. */
export function setup(): TemplatesSetup {
  return { source };
}
