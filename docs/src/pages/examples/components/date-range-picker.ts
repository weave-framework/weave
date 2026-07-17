import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/date-range-picker.gen';

// `<DocPage>` is referenced in date-range-picker.html.
void DocPage;

interface DateRangePickerExamplesSetup {
  source: string;
}

/** Examples → Components → DateRangePicker (route `/examples/components/date-range-picker`). Authored in
 *  Markdown (src/content/examples/components/date-range-picker.md) and rendered by <DocPage>. */
export function setup(): DateRangePickerExamplesSetup {
  return { source };
}
