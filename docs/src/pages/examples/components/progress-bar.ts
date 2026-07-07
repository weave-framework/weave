import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in progress-bar.html.
void DocPage;

interface ProgressBarExamplesSetup {
  source: string;
}

/** Examples → Components → ProgressBar (route `/examples/components/progress-bar`). A full live example
 *  gallery covering the whole `<ProgressBar>` surface. Authored in Markdown
 *  (src/content/examples/components/progress-bar.md) and rendered by <DocPage>. */
export function setup(): ProgressBarExamplesSetup {
  return { source: content['examples/components/progress-bar'] ?? '' };
}
