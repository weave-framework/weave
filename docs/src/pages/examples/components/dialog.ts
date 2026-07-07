import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in dialog.html.
void DocPage;

interface DialogExamplesSetup {
  source: string;
}

/** Examples → Components → Dialog (route `/examples/components/dialog`). Authored in Markdown
 *  (src/content/examples/components/dialog.md) and rendered by <DocPage>. */
export function setup(): DialogExamplesSetup {
  return { source: content['examples/components/dialog'] ?? '' };
}
