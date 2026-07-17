import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/reference/template-syntax.gen';

// `<DocPage>` is referenced in template-syntax.html.
void DocPage;

interface TemplateSyntaxSetup {
  source: string;
}

/** Reference → Template syntax (route `/reference/template-syntax`). Authored in
 *  Markdown (src/content/reference/template-syntax.md), rendered by <DocPage>. */
export function setup(): TemplateSyntaxSetup {
  return { source };
}
