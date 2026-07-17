import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/radio.gen';

// `<DocPage>` is referenced in radio.html.
void DocPage;

interface RadioExamplesSetup {
  source: string;
}

/** Examples → Components → Radio (route `/examples/components/radio`). A full live example
 *  gallery covering the whole `<Radio>` surface. Authored in Markdown
 *  (src/content/examples/components/radio.md) and rendered by <DocPage>. */
export function setup(): RadioExamplesSetup {
  return { source };
}
