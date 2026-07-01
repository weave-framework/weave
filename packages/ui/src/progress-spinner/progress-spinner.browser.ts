import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import {
  setup,
  template,
  type ProgressSpinnerProps,
  type ProgressSpinnerContext,
} from '@weave-framework/ui/progress-spinner';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

const SCOPE: string[] = ['spinnerClass', 'label'];

function mount(props: ProgressSpinnerProps): { el: HTMLElement; dispose: () => void } {
  const owner: Owner = createOwner();
  const el: HTMLElement = runInOwner(owner, () => {
    const ctx: ProgressSpinnerContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (
      c: unknown,
      r: unknown,
      k: unknown
    ) => HTMLElement;
    return fn(ctx, rt, {});
  });
  document.body.appendChild(el);
  return { el, dispose: (): void => { disposeOwner(owner); el.remove(); } };
}

test('renders a role=progressbar ring with the base class', () => {
  const { el, dispose } = mount({});
  assert.ok(el.classList.contains('weave-progress-spinner'), 'base class');
  assert.equal(el.getAttribute('role'), 'progressbar');
  dispose();
});

test('default size carries no modifier', () => {
  const { el, dispose } = mount({});
  assert.ok(!el.className.includes('weave-progress-spinner--'), 'no size modifier by default');
  dispose();
});

test('small adds the --small modifier', () => {
  const { el, dispose } = mount({ small: true });
  assert.ok(el.classList.contains('weave-progress-spinner--small'));
  dispose();
});

test('indeterminate: no aria-valuenow (unknown-length work)', () => {
  const { el, dispose } = mount({ label: 'Loading' });
  assert.ok(!el.hasAttribute('aria-valuenow'), 'a spinner never reports a value');
  dispose();
});

test('label sets the aria-label', () => {
  const { el, dispose } = mount({ label: 'Loading' });
  assert.equal(el.getAttribute('aria-label'), 'Loading');
  dispose();
});

test('forwarded class is appended to the ring', () => {
  const { el, dispose } = mount({ small: true, class: 'centered' });
  assert.ok(
    el.classList.contains('weave-progress-spinner') &&
      el.classList.contains('weave-progress-spinner--small') &&
      el.classList.contains('centered')
  );
  dispose();
});
