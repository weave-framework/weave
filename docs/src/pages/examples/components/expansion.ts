import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/expansion.gen';

// `<DocPage>` is referenced in expansion.html.
void DocPage;

interface ExpansionExamplesSetup {
  source: string;
}

/** Examples → Components → Expansion (route `/examples/components/expansion`). A full live example
 *  gallery covering the whole `<Expansion>` surface. Authored in Markdown
 *  (src/content/examples/components/expansion.md) and rendered by <DocPage>. */
export function setup(): ExpansionExamplesSetup {
  return { source };
}
