import DocPage from '../../lib/doc-page/doc-page';
import { content } from '../../content/content.gen';

// `<DocPage>` is referenced in static-generation.html.
void DocPage;

interface StaticGenerationSetup {
  source: string;
}

/** Learn → static generation & resume (route `/learn/static-generation`). Content authored in
 *  Markdown (src/content/learn/static-generation.md) and rendered by <DocPage>. */
export function setup(): StaticGenerationSetup {
  return { source: content['learn/static-generation'] ?? '' };
}
