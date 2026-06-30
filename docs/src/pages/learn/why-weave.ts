import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in why-weave.html.
void DocPage;

interface WhyWeaveSetup {
  source: string;
}

/** Learn → why-weave (route `/learn/why-weave`). Content authored in
 *  Markdown (src/content/learn/why-weave.md) and rendered by <DocPage>. */
export function setup(): WhyWeaveSetup {
  return { source: content['learn/why-weave'] ?? '' };
}
