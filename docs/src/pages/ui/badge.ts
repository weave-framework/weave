import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/badge.gen';

// `<DocPage>` is referenced in badge.html.
void DocPage;

interface BadgeSetup {
  source: string;
}

/** UI → Badge (route `/ui/badge`). Content authored in Markdown
 *  (src/content/ui/badge.md) and rendered by <DocPage>. */
export function setup(): BadgeSetup {
  return { source };
}
