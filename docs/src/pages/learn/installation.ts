import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in installation.html.
void DocPage;

interface InstallationSetup {
  source: string;
}

/** Learn → installation (route `/learn/installation`). Content authored in
 *  Markdown (src/content/learn/installation.md) and rendered by <DocPage>. */
export function setup(): InstallationSetup {
  return { source: content['learn/installation'] ?? '' };
}
