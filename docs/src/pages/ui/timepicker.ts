import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/timepicker.gen';

// `<DocPage>` is referenced in timepicker.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Timepicker (route `/ui/timepicker`). */
export function setup(): Setup {
  return { source };
}
