import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in checkbox.html.
void DocPage;

interface CheckboxExamplesSetup {
  source: string;
}

/** Examples → Components → Checkbox (route `/examples/components/checkbox`). A full live example
 *  gallery covering the whole `<Checkbox>` surface. Authored in Markdown
 *  (src/content/examples/components/checkbox.md) and rendered by <DocPage>. */
export function setup(): CheckboxExamplesSetup {
  return { source: content['examples/components/checkbox'] ?? '' };
}
