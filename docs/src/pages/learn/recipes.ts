import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/recipes.gen';

// `<DocPage>` is referenced in recipes.html.
void DocPage;

interface RecipesSetup {
  source: string;
}

/** Learn → recipes (route `/learn/recipes`). Content authored in
 *  Markdown (src/content/learn/recipes.md) and rendered by <DocPage>. */
export function setup(): RecipesSetup {
  return { source };
}
