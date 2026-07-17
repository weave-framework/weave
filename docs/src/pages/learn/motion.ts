import DocPage from '../../lib/doc-page/doc-page';
import { source } from '../../content/learn/motion.gen';

// `<DocPage>` is referenced in motion.html.
void DocPage;

interface MotionSetup {
  source: string;
}

/** Learn → motion (route `/learn/motion`). Content authored in
 *  Markdown (src/content/learn/motion.md) and rendered by <DocPage>. */
export function setup(): MotionSetup {
  return { source };
}
