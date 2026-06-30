import { Link } from '@weave-framework/router';

interface HomeSetup {
  repoUrl: string;
}

// `<Link>` is referenced in index.html.
void Link;

/** The docs landing page (route `/`). */
export function setup(): HomeSetup {
  return { repoUrl: 'https://github.com/weave-framework/weave' };
}
