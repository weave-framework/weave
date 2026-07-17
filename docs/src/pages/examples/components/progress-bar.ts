import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/progress-bar.gen';

// `<DocPage>` is referenced in progress-bar.html.
void DocPage;

interface ProgressBarExamplesSetup {
  source: string;
}

/** Examples → Components → ProgressBar (route `/examples/components/progress-bar`). A full live example
 *  gallery covering the whole `<ProgressBar>` surface. Authored in Markdown
 *  (src/content/examples/components/progress-bar.md) and rendered by <DocPage>. */
export function setup(): ProgressBarExamplesSetup {
  return { source };
}
