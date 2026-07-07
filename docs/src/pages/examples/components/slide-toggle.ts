import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in slide-toggle.html.
void DocPage;

interface SlideToggleExamplesSetup {
  source: string;
}

/** Examples → Components → SlideToggle (route `/examples/components/slide-toggle`). A full live example
 *  gallery covering the whole `<SlideToggle>` surface. Authored in Markdown
 *  (src/content/examples/components/slide-toggle.md) and rendered by <DocPage>. */
export function setup(): SlideToggleExamplesSetup {
  return { source: content['examples/components/slide-toggle'] ?? '' };
}
