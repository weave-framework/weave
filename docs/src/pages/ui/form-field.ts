import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/ui/form-field.gen';

// `<DocPage>` is referenced in form-field.html.
void DocPage;

interface Setup {
  source: string;
}

/** UI → Form Field (route `/ui/form-field`). */
export function setup(): Setup {
  return { source };
}
