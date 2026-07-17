import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/button-toggle.gen';

// `<DocPage>` is referenced in button-toggle.html.
void DocPage;

interface ButtonToggleExamplesSetup {
  source: string;
}

/** Examples → Components → ButtonToggle (route `/examples/components/button-toggle`). A full live example
 *  gallery covering the whole `<ButtonToggle>` surface. Authored in Markdown
 *  (src/content/examples/components/button-toggle.md) and rendered by <DocPage>. */
export function setup(): ButtonToggleExamplesSetup {
  return { source };
}
