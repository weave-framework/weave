import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in icon.html.
void DocPage;

interface IconSetup {
  source: string;
}

/** UI → Icon (route `/ui/icon`). Content authored in Markdown
 *  (src/content/ui/icon.md) and rendered by <DocPage>. */
export function setup(): IconSetup {
  return { source: content['ui/icon'] ?? '' };
}
