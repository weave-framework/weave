import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in stepper.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Stepper (route `/ui/stepper`). */
export function setup(): Setup {
  return { source: content['ui/stepper'] ?? '' };
}
