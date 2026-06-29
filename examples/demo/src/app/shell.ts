import { RouterView, Link, currentPath, type Router } from '@weave/router';
import { ErrorBoundary } from '@weave/runtime/dom';
import { router } from './router';

interface ShellSetup {
  router: Router;
  errorFallback: (err: unknown, reset: () => void) => Node;
  path: () => string;
}

// Used as components in app.html (capitalized tags resolve to these imports).
void RouterView;
void Link;
void ErrorBoundary;

/** Root shell: app chrome + an error boundary around the routed view. */
export function setup(): ShellSetup {
  /** Fallback UI when a route throws (built imperatively — it returns a DOM node). */
  const errorFallback = (err: unknown, reset: () => void): Node => {
    const div: HTMLDivElement = document.createElement('div');
    div.className = 'route-error';
    const p: HTMLParagraphElement = document.createElement('p');
    p.textContent = err instanceof Error ? err.message : String(err);
    const btn: HTMLButtonElement = document.createElement('button');
    btn.className = 'ghost';
    btn.textContent = 'Try again';
    btn.addEventListener('click', reset);
    div.append(p, btn);
    return div;
  };

  return { router, errorFallback, path: currentPath };
}
