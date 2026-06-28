import { test, assert } from '../../../tools/harness.js';
import { signal, effect, root, catchError } from '@weave/runtime';
import { mount, ErrorBoundary, type Component } from '@weave/runtime/dom';

const tick = () => new Promise<void>((r) => queueMicrotask(r));

function span(text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.textContent = text;
  return el;
}
function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/* ── catchError primitive ── */

test('catchError catches a synchronous error thrown in fn', () => {
  let caught: unknown = null;
  root(() => {
    catchError(
      (e) => {
        caught = e;
      },
      () => {
        throw new Error('boom');
      }
    );
  });
  assert.ok(caught instanceof Error && (caught as Error).message === 'boom');
});

test('catchError catches an error thrown later in an inner effect', () => {
  const trigger = signal(0);
  let caught: unknown = null;
  root(() => {
    catchError(
      (e) => {
        caught = e;
      },
      () => {
        effect(() => {
          if (trigger() > 0) throw new Error('effect-boom');
        });
      }
    );
  });
  assert.equal(caught, null, 'no error initially');
  trigger.set(1); // effect re-runs and throws → routed to the handler
  assert.ok(caught instanceof Error && (caught as Error).message === 'effect-boom');
});

test('an effect error with no boundary propagates', () => {
  let threw = false;
  try {
    root(() => {
      effect(() => {
        throw new Error('unbounded');
      });
    });
  } catch {
    threw = true;
  }
  assert.ok(threw, 'error propagates when there is no boundary');
});

/* ── ErrorBoundary component ── */

function mountEB(
  fallback: (err: unknown, reset: () => void) => Node,
  child: () => Node
): HTMLElement {
  const el = host();
  mount(ErrorBoundary({ fallback }, { default: child }), el);
  return el;
}

test('ErrorBoundary renders the protected content when nothing throws', () => {
  const el = mountEB((e) => span('fallback'), () => span('content'));
  assert.ok(el.textContent?.includes('content'));
  assert.ok(!el.textContent?.includes('fallback'));
});

test('ErrorBoundary shows the fallback when a child throws during render', async () => {
  const el = mountEB(
    (err) => span('caught:' + (err as Error).message),
    () => {
      throw new Error('render-fail');
    }
  );
  await tick();
  assert.ok(el.textContent?.includes('caught:render-fail'));
});

test('ErrorBoundary catches an effect error and swaps to the fallback', async () => {
  const blow = signal(false);
  const Child: Component = () => {
    const el = document.createElement('span');
    effect(() => {
      if (blow()) throw new Error('late');
      el.textContent = 'live';
    });
    return el;
  };
  const el = mountEB((err) => span('boom:' + (err as Error).message), () => Child());
  assert.ok(el.textContent?.includes('live'), 'renders normally first');
  blow.set(true);
  await tick();
  assert.ok(el.textContent?.includes('boom:late'), 'fallback shown after the effect throws');
  assert.ok(!el.textContent?.includes('live'));
});

test('ErrorBoundary reset() re-renders the protected content', async () => {
  const blow = signal(true);
  const Child: Component = () => {
    const el = document.createElement('span');
    effect(() => {
      if (blow()) throw new Error('x');
      el.textContent = 'recovered';
    });
    return el;
  };
  let doReset!: () => void;
  const el = mountEB(
    (err, reset) => {
      doReset = reset;
      return span('failed');
    },
    () => Child()
  );
  await tick();
  assert.ok(el.textContent?.includes('failed'), 'fallback shown initially');
  blow.set(false); // fix the underlying condition
  doReset(); // clear the error → re-render the protected content
  assert.ok(el.textContent?.includes('recovered'), 'content recovered after reset');
  assert.ok(!el.textContent?.includes('failed'));
});
