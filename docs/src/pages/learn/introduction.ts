import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/introduction.gen';

// `<DocPage>` is referenced in introduction.html.
void DocPage;

interface IntroductionSetup {
  source: string;
}

/** Learn → Introduction (route `/learn/introduction`). Content authored in
 *  Markdown (src/content/learn/introduction.md) and rendered by <DocPage>. */
export function setup(): IntroductionSetup {
  return { source };
}
