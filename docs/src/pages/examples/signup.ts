import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in signup.html.
void DocPage;

interface Setup {
  source: string;
}

/** Examples → Sign-up wizard (route `/examples/signup`). */
export function setup(): Setup {
  return { source: content['examples/signup'] ?? '' };
}
