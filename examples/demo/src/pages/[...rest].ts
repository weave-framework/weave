import { Link, currentPath } from '@weave/router';

// `<Link>` is used in [...rest].html.
void Link;

interface NotFoundSetup {
  path: () => string;
}

/** Catch-all 404 (`path: '*'`) — file-based: a `[...rest].*` page becomes the fallback route. */
export function setup(): NotFoundSetup {
  return { path: currentPath };
}
