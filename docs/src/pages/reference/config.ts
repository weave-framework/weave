import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in config.html.
void DocPage;

interface ConfigSetup {
  source: string;
}

/** Reference → Configuration (route `/reference/config`). Authored in Markdown
 *  (src/content/reference/config.md), rendered by <DocPage>. */
export function setup(): ConfigSetup {
  return { source: content['reference/config'] ?? '' };
}
