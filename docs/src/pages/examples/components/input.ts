import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/input.gen';

// `<DocPage>` is referenced in input.html.
void DocPage;

interface InputExamplesSetup {
  source: string;
}

/** Examples → Components → Input (route `/examples/components/input`). A full live example
 *  gallery covering the whole `<Input>` surface. Authored in Markdown
 *  (src/content/examples/components/input.md) and rendered by <DocPage>. */
export function setup(): InputExamplesSetup {
  return { source };
}
