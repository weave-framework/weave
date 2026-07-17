import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/snackbar.gen';

// `<DocPage>` is referenced in snackbar.html.
void DocPage;

interface SnackbarExamplesSetup {
  source: string;
}

/** Examples → Components → Snackbar (route `/examples/components/snackbar`). Authored in Markdown
 *  (src/content/examples/components/snackbar.md) and rendered by <DocPage>. */
export function setup(): SnackbarExamplesSetup {
  return { source };
}
