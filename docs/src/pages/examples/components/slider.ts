import DocPage from '../../../lib/doc-page/doc-page';
import { source } from '../../../content/examples/components/slider.gen';

// `<DocPage>` is referenced in slider.html.
void DocPage;

interface SliderExamplesSetup {
  source: string;
}

/** Examples → Components → Slider (route `/examples/components/slider`). A full live example
 *  gallery covering the whole `<Slider>` surface. Authored in Markdown
 *  (src/content/examples/components/slider.md) and rendered by <DocPage>. */
export function setup(): SliderExamplesSetup {
  return { source };
}
