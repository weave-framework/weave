import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in chips.html.
void DocPage;

interface ChipsExamplesSetup {
  source: string;
}

/** Examples → Components → Chips (route `/examples/components/chips`). A full live example
 *  gallery covering the whole `<Chips>` surface. Authored in Markdown
 *  (src/content/examples/components/chips.md) and rendered by <DocPage>. */
export function setup(): ChipsExamplesSetup {
  return { source: content['examples/components/chips'] ?? '' };
}
