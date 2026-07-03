import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in timepicker.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Timepicker (route `/ui/timepicker`). */
export function setup(): Setup {
  return { source: content['ui/timepicker'] ?? '' };
}
