import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in divider.html.
void DocPage;

interface DividerExamplesSetup {
  source: string;
}

/** Examples → Components → Divider (route `/examples/components/divider`). A full live example
 *  gallery covering the whole `<Divider>` surface. Authored in Markdown
 *  (src/content/examples/components/divider.md) and rendered by <DocPage>. */
export function setup(): DividerExamplesSetup {
  return { source: content['examples/components/divider'] ?? '' };
}
