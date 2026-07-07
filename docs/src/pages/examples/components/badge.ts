import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in badge.html.
void DocPage;

interface BadgeExamplesSetup {
  source: string;
}

/** Examples → Components → Badge (route `/examples/components/badge`). A full live example
 *  gallery covering the whole `<Badge>` surface. Authored in Markdown
 *  (src/content/examples/components/badge.md) and rendered by <DocPage>. */
export function setup(): BadgeExamplesSetup {
  return { source: content['examples/components/badge'] ?? '' };
}
