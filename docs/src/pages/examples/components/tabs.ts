import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/tabs.gen';

// `<DocPage>` is referenced in tabs.html.
void DocPage;

interface TabsExamplesSetup {
  source: string;
}

/** Examples → Components → Tabs (route `/examples/components/tabs`). A full live example
 *  gallery covering the whole `<Tabs>` surface. Authored in Markdown
 *  (src/content/examples/components/tabs.md) and rendered by <DocPage>. */
export function setup(): TabsExamplesSetup {
  return { source };
}
