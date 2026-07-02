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
import { setup, template, type ButtonProps, type ButtonContext } from '@weave-framework/ui/button';

type RenderFn = (ctx: ButtonContext, slots: Record<string, () => Node>) => HTMLButtonElement;
type MakeRender = (ctx: ButtonContext, rt: unknown, c: unknown) => RenderFn;

// The runtime object the compiled (function-mode) template references as `rt`.
const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

/** Let queued effects / microtasks flush (also fires deferred onMount actions). */
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

/**
 * Instantiate `<Button>` (setup + template) in a fresh owner, projecting `content`
 * into the default slot, and attach it. Uses the real slot mechanism (function mode
 * always passes `{}`, so we lift `render` out and call it with real slots).
 */
function mountButton(
  props: ButtonProps,
  content?: () => Node
): { btn: HTMLButtonElement; dispose: () => void } {
  const owner: Owner = createOwner();
  const btn: HTMLButtonElement = runInOwner(owner, () => {
    const ctx: ButtonContext = setup(props);
    const { code } = compileTemplate(template, {
      mode: 'function',
      scope: ['classes', 'type', 'disabled', 'label', 'onClick', 'rippleOptions', 'ripple'],
    });
    const make: MakeRender = new Function(
      'ctx',
      'rt',
      '_c',
      code.replace('return render(ctx, {});', 'return render;')
    ) as MakeRender;
    const render: RenderFn = make(ctx, rt, {});
    const slots: Record<string, () => Node> = content ? { default: content } : {};
    return render(ctx, slots);
  });
  document.body.appendChild(btn);
  return { btn, dispose: () => { disposeOwner(owner); btn.remove(); } };
}

/* ─────────────────────────── native + content ─────────────────────────── */

test('renders a real native <button>, type defaults to "button"', () => {
  const { btn, dispose } = mountButton({});
  assert.equal(btn.tagName, 'BUTTON', 'a real <button> element');
  assert.equal(btn.getAttribute('type'), 'button', 'defaults to type=button (never submits by accident)');
  assert.ok(btn.classList.contains('weave-button'), 'base class present');
  dispose();
});

test('projects slotted content (the label)', () => {
  const { btn, dispose } = mountButton({}, () => document.createTextNode('Save'));
  assert.equal(btn.textContent, 'Save', 'default slot content is projected');
  dispose();
});

test('type=submit is forwarded (native form submission)', () => {
  const { btn, dispose } = mountButton({ type: 'submit' });
  assert.equal(btn.getAttribute('type'), 'submit');
  dispose();
});

/* ─────────────────────────── variants (class contract) ─────────────────────────── */

test('primary is the default — no modifier class', () => {
  const { btn, dispose } = mountButton({ variant: 'primary' });
  assert.ok(btn.classList.contains('weave-button'));
  assert.ok(!btn.className.includes('weave-button--'), 'primary carries no --variant modifier');
  dispose();
});

test('each non-primary variant adds its --<variant> modifier', () => {
  for (const v of ['outline', 'marked', 'ghost', 'icon'] as const) {
    const { btn, dispose } = mountButton({ variant: v });
    assert.ok(btn.classList.contains(`weave-button--${v}`), `${v} → weave-button--${v}`);
    dispose();
  }
});

test('forwarded class is appended, base class preserved', () => {
  const { btn, dispose } = mountButton({ variant: 'ghost', class: 'cta mt' });
  assert.ok(btn.classList.contains('weave-button'), 'base kept');
  assert.ok(btn.classList.contains('weave-button--ghost'), 'variant kept');
  assert.ok(btn.classList.contains('cta') && btn.classList.contains('mt'), 'consumer classes forwarded');
  dispose();
});

test('variant changes reactively update the class', async () => {
  const variant: Signal<'primary' | 'outline'> = signal<'primary' | 'outline'>('primary');
  const { btn, dispose } = mountButton({ get variant() { return variant(); } });
  assert.ok(!btn.className.includes('--outline'));
  variant.set('outline');
  await tick();
  assert.ok(btn.classList.contains('weave-button--outline'), 'reflected the new variant');
  dispose();
});

/* ─────────────────────────── disabled (native attr) ─────────────────────────── */

test('disabled reflects the native attribute + property, and toggles reactively', async () => {
  const off: Signal<boolean> = signal(false);
  const { btn, dispose } = mountButton({ get disabled() { return off(); } });
  assert.equal(btn.hasAttribute('disabled'), false, 'enabled → no attribute');
  assert.equal(btn.disabled, false, 'native .disabled false');
  off.set(true);
  await tick();
  assert.equal(btn.hasAttribute('disabled'), true, 'disabled attribute set');
  assert.equal(btn.disabled, true, 'native .disabled true');
  dispose();
});

/* ─────────────────────────── a11y ─────────────────────────── */

test('label sets aria-label (accessible name for icon-only buttons)', () => {
  const { btn, dispose } = mountButton({ variant: 'icon', label: 'Delete' });
  assert.equal(btn.getAttribute('aria-label'), 'Delete');
  dispose();
});

test('no label → no aria-label attribute (visible text is the name)', () => {
  const { btn, dispose } = mountButton({}, () => document.createTextNode('Save'));
  assert.equal(btn.hasAttribute('aria-label'), false);
  dispose();
});

/* ─────────────────────────── ripple ─────────────────────────── */

test('pointerdown spawns a .weave-ripple element (click feedback)', async () => {
  const { btn, dispose } = mountButton({});
  await tick(); // let the deferred use:ripple onMount attach the listener
  btn.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 5, bubbles: true }));
  assert.ok(btn.querySelector('.weave-ripple'), 'a ripple circle was appended');
  dispose();
});

test('a disabled button does not ripple', async () => {
  const { btn, dispose } = mountButton({ disabled: true });
  await tick();
  btn.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 5, bubbles: true }));
  assert.equal(btn.querySelector('.weave-ripple'), null, 'no ripple while disabled');
  dispose();
});
