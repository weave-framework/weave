import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in template-syntax.html.
void DocPage;

interface TemplateSyntaxSetup {
  source: string;
}

/** Reference → Template syntax (route `/reference/template-syntax`). Authored in
 *  Markdown (src/content/reference/template-syntax.md), rendered by <DocPage>. */
export function setup(): TemplateSyntaxSetup {
  return { source: content['reference/template-syntax'] ?? '' };
}
