import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/slider.gen';

// `<DocPage>` is referenced in slider.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Slider (route `/ui/slider`). */
export function setup(): Setup {
  return { source };
}
