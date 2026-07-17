import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/chips.gen';

// `<DocPage>` is referenced in chips.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Chips (route `/ui/chips`). */
export function setup(): Setup {
  return { source };
}
