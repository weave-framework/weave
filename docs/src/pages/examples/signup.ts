import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/examples/signup.gen';

// `<DocPage>` is referenced in signup.html.
void DocPage;

interface Setup {
  source: string;
}

/** Examples → Sign-up wizard (route `/examples/signup`). */
export function setup(): Setup {
  return { source };
}
