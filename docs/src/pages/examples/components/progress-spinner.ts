import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/progress-spinner.gen';

// `<DocPage>` is referenced in progress-spinner.html.
void DocPage;

interface ProgressSpinnerExamplesSetup {
  source: string;
}

/** Examples → Components → ProgressSpinner (route `/examples/components/progress-spinner`). A full live example
 *  gallery covering the whole `<ProgressSpinner>` surface. Authored in Markdown
 *  (src/content/examples/components/progress-spinner.md) and rendered by <DocPage>. */
export function setup(): ProgressSpinnerExamplesSetup {
  return { source };
}
