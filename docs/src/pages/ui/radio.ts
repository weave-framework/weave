import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/radio.gen';

// `<DocPage>` is referenced in radio.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Radio Group (route `/ui/radio`). */
export function setup(): Setup {
  return { source };
}
