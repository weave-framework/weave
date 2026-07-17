import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/popover-edit.gen';

// `<DocPage>` is referenced in popover-edit.html.
void DocPage;

interface PopoverEditExamplesSetup {
  source: string;
}

/** Examples → Components → PopoverEdit (route `/examples/components/popover-edit`). Authored in Markdown
 *  (src/content/examples/components/popover-edit.md) and rendered by <DocPage>. */
export function setup(): PopoverEditExamplesSetup {
  return { source };
}
