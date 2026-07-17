import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/enterprise/safe-to-bet-on.gen';

// `<DocPage>` is referenced in safe-to-bet-on.html.
void DocPage;

interface Setup {
  source: string;
}

/** Enterprise → Is Weave safe to bet on? (route `/enterprise/safe-to-bet-on`). */
export function setup(): Setup {
  return { source };
}
