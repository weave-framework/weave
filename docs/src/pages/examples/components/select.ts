import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in select.html.
void DocPage;

interface SelectExamplesSetup {
  source: string;
}

/** Examples → Components → Select (route `/examples/components/select`). A full live example
 *  gallery covering the whole `<Select>` surface. Authored in Markdown
 *  (src/content/examples/components/select.md) and rendered by <DocPage>. */
export function setup(): SelectExamplesSetup {
  return { source: content['examples/components/select'] ?? '' };
}
