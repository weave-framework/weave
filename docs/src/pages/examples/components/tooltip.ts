import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in tooltip.html.
void DocPage;

interface TooltipExamplesSetup {
  source: string;
}

/** Examples → Components → Tooltip (route `/examples/components/tooltip`). Authored in Markdown
 *  (src/content/examples/components/tooltip.md) and rendered by <DocPage>. */
export function setup(): TooltipExamplesSetup {
  return { source: content['examples/components/tooltip'] ?? '' };
}
