import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in stepper.html.
void DocPage;

interface StepperExamplesSetup {
  source: string;
}

/** Examples → Components → Stepper (route `/examples/components/stepper`). Authored in Markdown
 *  (src/content/examples/components/stepper.md) and rendered by <DocPage>. */
export function setup(): StepperExamplesSetup {
  return { source: content['examples/components/stepper'] ?? '' };
}
