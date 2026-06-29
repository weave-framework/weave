import { provide } from '@weave/runtime';
import { RouterView, Link, currentPath, afterEach, type Router } from '@weave/router';
import { ErrorBoundary } from '@weave/runtime/dom';
import { router } from './router';
import { SessionContext } from './session';
import TaskModal from '../components/task-modal/task-modal';
import ToastHost from '../components/toast-host/toast-host';

interface ShellSetup {
  router: Router;
  errorFallback: (err: unknown, reset: () => void) => Node;
  path: () => string;
}

// Used as components in app.html (capitalized tags resolve to these imports).
void RouterView;
void Link;
void ErrorBoundary;
void TaskModal;
void ToastHost;

/** Root shell: app chrome + an error boundary around the routed view. */
export function setup(): ShellSetup {
  // Provide the session at the root owner — every routed view, card, and the
  // deferred insights panel inject it without prop-drilling (A.1 context).
  provide(SessionContext, { currentUser: 'Lina' });

  // Keep the document title in sync with the route (R.3 `afterEach` hook). Scroll
  // is handled by the router itself (top-on-navigate, restore on back/forward).
  const setTitle = (p: string): void => {
    const seg: string | undefined = p.split('/').filter(Boolean).pop();
    document.title = seg ? `${seg[0].toUpperCase()}${seg.slice(1)} · Weave Board` : 'Weave Board';
  };
  setTitle(currentPath()); // initial load (afterEach only fires on a navigation)
  afterEach(({ path }) => setTitle(path));


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
