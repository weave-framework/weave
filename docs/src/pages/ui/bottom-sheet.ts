import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/bottom-sheet.gen';

// `<DocPage>` is referenced in bottom-sheet.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Bottom Sheet (route `/ui/bottom-sheet`). */
export function setup(): Setup {
  return { source };
}
