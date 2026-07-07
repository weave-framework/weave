import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in timepicker.html.
void DocPage;

interface TimepickerExamplesSetup {
  source: string;
}

/** Examples → Components → Timepicker (route `/examples/components/timepicker`). Authored in Markdown
 *  (src/content/examples/components/timepicker.md) and rendered by <DocPage>. */
export function setup(): TimepickerExamplesSetup {
  return { source: content['examples/components/timepicker'] ?? '' };
}
