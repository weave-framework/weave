import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/date-range-picker.gen';

// `<DocPage>` is referenced in date-range-picker.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → DateRangePicker (route `/ui/date-range-picker`). */
export function setup(): Setup {
  return { source };
}
