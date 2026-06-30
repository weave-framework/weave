import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in tooling.html.
void DocPage;

interface ToolingSetup {
  source: string;
}

/** Learn → tooling (route `/learn/tooling`). Content authored in
 *  Markdown (src/content/learn/tooling.md) and rendered by <DocPage>. */
export function setup(): ToolingSetup {
  return { source: content['learn/tooling'] ?? '' };
}
