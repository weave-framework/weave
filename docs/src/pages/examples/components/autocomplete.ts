import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/autocomplete.gen';

// `<DocPage>` is referenced in autocomplete.html.
void DocPage;

interface AutocompleteExamplesSetup {
  source: string;
}

/** Examples → Components → Autocomplete (route `/examples/components/autocomplete`). A full live example
 *  gallery covering the whole `<Autocomplete>` surface. Authored in Markdown
 *  (src/content/examples/components/autocomplete.md) and rendered by <DocPage>. */
export function setup(): AutocompleteExamplesSetup {
  return { source };
}
