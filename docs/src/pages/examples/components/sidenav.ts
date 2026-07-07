import DocPage from '../../../lib/doc-page/doc-page';
import { content } from '../../../content/content.gen';

// `<DocPage>` is referenced in sidenav.html.
void DocPage;

interface SidenavExamplesSetup {
  source: string;
}

/** Examples → Components → Sidenav (route `/examples/components/sidenav`). Authored in Markdown
 *  (src/content/examples/components/sidenav.md) and rendered by <DocPage>. */
export function setup(): SidenavExamplesSetup {
  return { source: content['examples/components/sidenav'] ?? '' };
}
