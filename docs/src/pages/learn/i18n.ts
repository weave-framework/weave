import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/i18n.gen';

// `<DocPage>` is referenced in i18n.html.
void DocPage;

interface I18nSetup {
  source: string;
}

/** Learn → i18n (route `/learn/i18n`). Content authored in
 *  Markdown (src/content/learn/i18n.md) and rendered by <DocPage>. */
export function setup(): I18nSetup {
  return { source };
}
