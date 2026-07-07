import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in datepicker.html.
void DocPage;

interface DatepickerExamplesSetup {
  source: string;
}

/** Examples → Components → Datepicker (route `/examples/components/datepicker`). Authored in Markdown
 *  (src/content/examples/components/datepicker.md) and rendered by <DocPage>. */
export function setup(): DatepickerExamplesSetup {
  return { source: content['examples/components/datepicker'] ?? '' };
}
