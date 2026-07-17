import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/examples/dashboard.gen';

// `<DocPage>` is referenced in dashboard.html.
void DocPage;

interface Setup {
  source: string;
}

/** Examples → Data dashboard (route `/examples/dashboard`). */
export function setup(): Setup {
  return { source };
}
