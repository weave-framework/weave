import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in snackbar.html.
void DocPage;

interface SnackbarExamplesSetup {
  source: string;
}

/** Examples → Components → Snackbar (route `/examples/components/snackbar`). Authored in Markdown
 *  (src/content/examples/components/snackbar.md) and rendered by <DocPage>. */
export function setup(): SnackbarExamplesSetup {
  return { source: content['examples/components/snackbar'] ?? '' };
}
