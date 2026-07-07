import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in form-field.html.
void DocPage;

interface FormFieldExamplesSetup {
  source: string;
}

/** Examples → Components → FormField (route `/examples/components/form-field`). A full live example
 *  gallery covering the whole `<FormField>` surface. Authored in Markdown
 *  (src/content/examples/components/form-field.md) and rendered by <DocPage>. */
export function setup(): FormFieldExamplesSetup {
  return { source: content['examples/components/form-field'] ?? '' };
}
