import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in bottom-sheet.html.
void DocPage;

interface BottomSheetExamplesSetup {
  source: string;
}

/** Examples → Components → BottomSheet (route `/examples/components/bottom-sheet`). Authored in Markdown
 *  (src/content/examples/components/bottom-sheet.md) and rendered by <DocPage>. */
export function setup(): BottomSheetExamplesSetup {
  return { source: content['examples/components/bottom-sheet'] ?? '' };
}
