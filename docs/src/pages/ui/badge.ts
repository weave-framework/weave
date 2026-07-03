import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in badge.html.
void DocPage;

interface BadgeSetup {
  source: string;
}

/** UI → Badge (route `/ui/badge`). Content authored in Markdown
 *  (src/content/ui/badge.md) and rendered by <DocPage>. */
export function setup(): BadgeSetup {
  return { source: content['ui/badge'] ?? '' };
}
