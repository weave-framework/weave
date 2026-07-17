import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/stepper.gen';

// `<DocPage>` is referenced in stepper.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Stepper (route `/ui/stepper`). */
export function setup(): Setup {
  return { source };
}
