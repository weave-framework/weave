import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in context-menu.html.
void DocPage;

interface ContextMenuExamplesSetup {
  source: string;
}

/** Examples → Components → ContextMenu (route `/examples/components/context-menu`). Authored in Markdown
 *  (src/content/examples/components/context-menu.md) and rendered by <DocPage>. */
export function setup(): ContextMenuExamplesSetup {
  return { source: content['examples/components/context-menu'] ?? '' };
}
