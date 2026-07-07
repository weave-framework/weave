import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in icon.html.
void DocPage;

interface IconExamplesSetup {
  source: string;
}

/** Examples → Components → Icon (route `/examples/components/icon`). A full live example
 *  gallery covering the whole `<Icon>` surface. Authored in Markdown
 *  (src/content/examples/components/icon.md) and rendered by <DocPage>. */
export function setup(): IconExamplesSetup {
  return { source: content['examples/components/icon'] ?? '' };
}
