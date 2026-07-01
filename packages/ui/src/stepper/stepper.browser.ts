import { test, assert } from '../../../../tools/harness.js';
import {
  signal,
  effect,
  createOwner,
  runInOwner,
  disposeOwner,
  type Signal,
  type Owner,
} from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import { setup, template, type StepperProps, type StepperContext, type StepItem } from '@weave-framework/ui/stepper';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

/** Flush microtasks (fires the deferred onMount content-append). */
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

const SCOPE: string[] = [
  'host', 'steps', 'rootClass', 'label', 'stepId', 'panelId', 'stepStateAttr', 'connectorStateAttr',
  'currentAttr', 'navDisabledAttr', 'isHidden', 'showNav', 'backText', 'nextText',
  'backDisabled', 'nextDisabled', 'goTo', 'back', 'next',
];

interface Mounted {
  root: HTMLElement;
  steps: HTMLButtonElement[];
  panels: HTMLElement[];
  connectors: HTMLElement[];
  back: HTMLButtonElement | null;
  next: HTMLButtonElement | null;
  dispose: () => void;
}

function mount(props: StepperProps): Mounted {
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: StepperContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (
      c: unknown,
      r: unknown,
      k: unknown
    ) => HTMLElement;
    return fn(ctx, rt, {});
  });
  document.body.appendChild(root);
  return {
    root,
    steps: Array.from(root.querySelectorAll<HTMLButtonElement>('.weave-stepper__step')),
    panels: Array.from(root.querySelectorAll<HTMLElement>('.weave-stepper__panel')),
    connectors: Array.from(root.querySelectorAll<HTMLElement>('.weave-stepper__connector')),
    back: root.querySelector<HTMLButtonElement>('.weave-stepper__back'),
    next: root.querySelector<HTMLButtonElement>('.weave-stepper__next'),
    dispose: (): void => { disposeOwner(owner); root.remove(); },
  };
}

const STEPS: StepItem[] = [
  { label: 'Account', content: 'Account body' },
  { label: 'Profile', content: 'Profile body' },
  { label: 'Confirm', content: 'Confirm body' },
];

/* ─────────────────────────── structure + a11y ─────────────────────────── */

test('renders steps + connectors + panels; first active by default', () => {
  const { steps, panels, connectors, dispose } = mount({ steps: STEPS });
  assert.equal(steps.length, 3);
  assert.equal(panels.length, 3);
  assert.equal(connectors.length, 2, 'a connector between each pair (not after the last)');
  assert.equal(steps[0].getAttribute('data-state'), 'active');
  assert.equal(steps[1].getAttribute('data-state'), 'upcoming');
  assert.equal(steps[2].getAttribute('data-state'), 'upcoming');
  dispose();
});

test('a11y: active step has aria-current=step; panels are labelled by their step', () => {
  const { steps, panels, dispose } = mount({ steps: STEPS });
  assert.equal(steps[0].getAttribute('aria-current'), 'step');
  assert.ok(!steps[1].hasAttribute('aria-current'));
  steps.forEach((s, i) => assert.equal(panels[i].getAttribute('aria-labelledby'), s.id));
  dispose();
});

test('renders the step number, and an Optional tag when flagged', () => {
  const { steps, dispose } = mount({
    steps: [{ label: 'A', content: 'a' }, { label: 'B', content: 'b', optional: true }],
  });
  assert.equal(steps[0].querySelector('.weave-stepper__number')?.textContent, '1');
  assert.equal(steps[1].querySelector('.weave-stepper__optional')?.textContent, 'Optional');
  assert.equal(steps[0].querySelector('.weave-stepper__optional'), null);
  dispose();
});

/* ─────────────────────────── content + visibility ─────────────────────────── */

test('appends step content on mount; only the active panel is visible', async () => {
  const { panels, dispose } = mount({ steps: STEPS });
  await tick();
  assert.ok(panels[0].textContent?.includes('Account body'));
  assert.equal(panels[0].hidden, false);
  assert.equal(panels[1].hidden, true);
  dispose();
});

/* ─────────────────────────── Back / Continue nav ─────────────────────────── */

test('Continue advances, Back returns; passed steps become done, connectors go accent', async () => {
  const { steps, connectors, back, next, dispose } = mount({ steps: STEPS });
  assert.equal(back?.disabled, true, 'Back disabled on the first step');
  assert.equal(next?.textContent, 'Continue');
  next?.click();
  await tick();
  assert.equal(steps[0].getAttribute('data-state'), 'done', 'passed step is done (✓)');
  assert.equal(steps[1].getAttribute('data-state'), 'active');
  assert.equal(connectors[0].getAttribute('data-state'), 'done', 'connector behind is accent');
  assert.equal(back?.disabled, false);
  back?.click();
  await tick();
  assert.equal(steps[0].getAttribute('data-state'), 'active');
  dispose();
});

test('the last step shows Finish and fires onComplete', async () => {
  let completed: number = 0;
  const { next, dispose } = mount({ steps: STEPS, defaultIndex: 2, onComplete: (): void => { completed += 1; } });
  assert.equal(next?.textContent, 'Finish');
  next?.click();
  await tick();
  assert.equal(completed, 1, 'Finish fired onComplete');
  dispose();
});

test('showNav={{false}} hides the Back/Continue row', () => {
  const { back, next, dispose } = mount({ steps: STEPS, showNav: false });
  assert.equal(back, null);
  assert.equal(next, null);
  dispose();
});

/* ─────────────────────────── controlled + click nav ─────────────────────────── */

test('controlled value drives the step; onChange reports the next index', async () => {
  const idx: Signal<number> = signal<number>(0);
  const seen: number[] = [];
  const { next, steps, dispose } = mount({
    steps: STEPS,
    get value(): number { return idx(); },
    onChange: (i): void => { seen.push(i); idx.set(i); },
  } as StepperProps);
  next?.click();
  await tick();
  assert.deepEqual(seen, [1]);
  assert.equal(steps[1].getAttribute('data-state'), 'active', 'value re-drove the DOM');
  dispose();
});

test('non-linear (default): clicking any step navigates to it', async () => {
  const { steps, dispose } = mount({ steps: STEPS });
  steps[2].click();
  await tick();
  assert.equal(steps[2].getAttribute('data-state'), 'active');
  dispose();
});

/* ─────────────────────────── linear gating ─────────────────────────── */

test('linear: cannot jump past an incomplete step; Continue is gated on completed', async () => {
  const { steps, next, dispose } = mount({ steps: STEPS, linear: true });
  assert.equal(steps[2].getAttribute('aria-disabled'), 'true', 'ahead step not reachable');
  assert.equal(next?.disabled, true, 'Continue gated (step 0 not completed)');
  steps[2].click();
  await tick();
  assert.equal(steps[0].getAttribute('data-state'), 'active', 'jump was blocked');
  dispose();
});

test('linear: a completed step opens Continue and forward navigation', async () => {
  const { steps, next, dispose } = mount({
    steps: [
      { label: 'A', content: 'a', completed: true },
      { label: 'B', content: 'b' },
      { label: 'C', content: 'c' },
    ],
    linear: true,
  });
  assert.equal(next?.disabled, false, 'Continue enabled once step 0 is completed');
  assert.equal(steps[1].getAttribute('aria-disabled'), null, 'the immediate next is reachable');
  next?.click();
  await tick();
  assert.equal(steps[1].getAttribute('data-state'), 'active');
  dispose();
});

test('linear: an optional step does not gate Continue', () => {
  const { next, dispose } = mount({
    steps: [{ label: 'A', content: 'a', optional: true }, { label: 'B', content: 'b' }],
    linear: true,
  });
  assert.equal(next?.disabled, false, 'optional current step keeps Continue enabled');
  dispose();
});

/* ─────────────────────────── disabled ─────────────────────────── */

test('a disabled step is not navigable', async () => {
  const { steps, dispose } = mount({
    steps: [{ label: 'A', content: 'a' }, { label: 'B', content: 'b', disabled: true }, { label: 'C', content: 'c' }],
  });
  assert.equal(steps[1].getAttribute('aria-disabled'), 'true');
  steps[1].click();
  await tick();
  assert.equal(steps[0].getAttribute('data-state'), 'active', 'click on disabled step ignored');
  dispose();
});

/* ─────────────────────────── class forwarding ─────────────────────────── */

test('forwards a custom class onto the container', () => {
  const { root, dispose } = mount({ steps: STEPS, class: 'my-stepper' });
  assert.ok(root.classList.contains('weave-stepper') && root.classList.contains('my-stepper'));
  dispose();
});
