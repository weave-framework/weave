import { test, assert } from '../../../tools/harness.js';
import { signal, effect, root, catchError, type Signal } from '@weave-framework/runtime';
import { mount, ErrorBoundary, type Component } from '@weave-framework/runtime/dom';

const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

function span(text: string): HTMLSpanElement {
  const el: HTMLSpanElement = document.createElement('span');
  el.textContent = text;
  return el;
}
function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
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
  const trigger: Signal<number> = signal(0);
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
  let threw: boolean = false;
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
  const el: HTMLElement = host();
  mount(ErrorBoundary({ fallback }, { default: child }), el);
  return el;
}

test('ErrorBoundary renders the protected content when nothing throws', () => {
  const el: HTMLElement = mountEB((e) => span('fallback'), () => span('content'));
  assert.ok(el.textContent?.includes('content'));
  assert.ok(!el.textContent?.includes('fallback'));
});

test('ErrorBoundary shows the fallback when a child throws during render', async () => {
  const el: HTMLElement = mountEB(
    (err) => span('caught:' + (err as Error).message),
    () => {
      throw new Error('render-fail');
    }
  );
  await tick();
  assert.ok(el.textContent?.includes('caught:render-fail'));
});

test('ErrorBoundary catches an effect error and swaps to the fallback', async () => {
  const blow: Signal<boolean> = signal(false);
  const Child: Component = () => {
    const el: HTMLSpanElement = document.createElement('span');
    effect(() => {
      if (blow()) throw new Error('late');
      el.textContent = 'live';
    });
    return el;
  };
  const el: HTMLElement = mountEB((err) => span('boom:' + (err as Error).message), () => Child());
  assert.ok(el.textContent?.includes('live'), 'renders normally first');
  blow.set(true);
  await tick();
  assert.ok(el.textContent?.includes('boom:late'), 'fallback shown after the effect throws');
  assert.ok(!el.textContent?.includes('live'));
});

test('ErrorBoundary resetKey clears the error when the key changes', async () => {
  const blow: Signal<boolean> = signal(true);
  const key: Signal<number> = signal(0);
  const Child: Component = () => {
    const el: HTMLSpanElement = document.createElement('span');
    effect(() => {
      if (blow()) throw new Error('x');
      el.textContent = 'recovered';
    });
    return el;
  };
  const el: HTMLElement = host();
  mount(
    ErrorBoundary(
      {
        fallback: () => span('failed'),
        get resetKey() {
          return key();
        },
      },
      { default: () => Child() }
    ),
    el
  );
  await tick();
  assert.ok(el.textContent?.includes('failed'), 'fallback shown initially');
  blow.set(false); // fix the underlying condition
  key.set(1); // changing resetKey clears the error — no manual reset() call
  await tick();
  assert.ok(el.textContent?.includes('recovered'), 'recovered when resetKey changed');
  assert.ok(!el.textContent?.includes('failed'));
});

test('ErrorBoundary reset() re-renders the protected content', async () => {
  const blow: Signal<boolean> = signal(true);
  const Child: Component = () => {
    const el: HTMLSpanElement = document.createElement('span');
    effect(() => {
      if (blow()) throw new Error('x');
      el.textContent = 'recovered';
    });
    return el;
  };
  let doReset!: () => void;
  const el: HTMLElement = mountEB(
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
