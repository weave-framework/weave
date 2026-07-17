import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/slide-toggle.gen';

// `<DocPage>` is referenced in slide-toggle.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Slide Toggle (route `/ui/slide-toggle`). */
export function setup(): Setup {
  return { source };
}
