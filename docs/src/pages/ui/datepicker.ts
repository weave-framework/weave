import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in datepicker.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Datepicker (route `/ui/datepicker`). */
export function setup(): Setup {
  return { source: content['ui/datepicker'] ?? '' };
}
