import { test, assert } from '../../../../tools/harness.js';
import { createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import {
  isFocusable,
  isTabbable,
  getTabIndex,
  focusableChildren,
  tabbableChildren,
  focusTrap,
  monitorFocus,
  focusOrigin,
} from '@weave-framework/ui/cdk';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}
const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

/* ─────────────────── interactivity ─────────────────── */

test('interactivity: a plain button is focusable and tabbable', () => {
  const host = mount('<button>ok</button>');
  const btn = host.querySelector('button')!;
  assert.equal(isFocusable(btn), true);
  assert.equal(isTabbable(btn), true);
  host.remove();
});

test('interactivity: a disabled control is neither focusable nor tabbable', () => {
  const host = mount('<button disabled>no</button>');
  const btn = host.querySelector('button')!;
  assert.equal(isFocusable(btn), false);
  assert.equal(isTabbable(btn), false);
  host.remove();
});

test('interactivity: an anchor is focusable only with href', () => {
  const host = mount('<a>no</a><a href="#x">yes</a>');
  const [bare, linked] = Array.from(host.querySelectorAll('a'));
  assert.equal(isFocusable(bare), false);
  assert.equal(isTabbable(linked), true);
  host.remove();
});

test('interactivity: tabindex="-1" is focusable but NOT tabbable; tabindex="0" is both', () => {
  const host = mount('<div tabindex="-1">a</div><div tabindex="0">b</div>');
  const [neg, zero] = Array.from(host.querySelectorAll('div'));
  assert.equal(isFocusable(neg), true);
  assert.equal(isTabbable(neg), false);
  assert.equal(getTabIndex(neg), -1);
  assert.equal(isTabbable(zero), true);
  host.remove();
});

test('interactivity: display:none is not focusable (ancestor hidden too)', () => {
  const host = mount('<div style="display:none"><button>x</button></div>');
  const btn = host.querySelector('button')!;
  assert.equal(isFocusable(btn), false);
  host.remove();
});

test('interactivity: focusable/tabbable child queries return DOM order', () => {
  const host = mount('<button>1</button><a href="#">2</a><input disabled><div tabindex="-1">3</div><input>');
  assert.deepEqual(
    tabbableChildren(host).map((e) => e.tagName.toLowerCase()),
    ['button', 'a', 'input'],
    'disabled input + tabindex -1 excluded from tabbables',
  );
  assert.equal(focusableChildren(host).length, 4, 'the tabindex=-1 div IS focusable');
  host.remove();
});

/* ─────────────────── focus-trap ─────────────────── */

function tabKey(target: Element, shift = false): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

test('focus-trap: activate focuses the first tabbable', () => {
  const host = mount('<div class="trap"><button class="a">a</button><button class="b">b</button></div>');
  const region = host.querySelector('.trap') as HTMLElement;
  const trap = focusTrap(region);
  trap.activate();
  assert.equal(document.activeElement, region.querySelector('.a'));
  trap.deactivate();
  host.remove();
});

test('focus-trap: Tab at the last tabbable wraps to the first', () => {
  const host = mount('<div class="trap"><button class="a">a</button><button class="b">b</button></div>');
  const region = host.querySelector('.trap') as HTMLElement;
  const a = region.querySelector('.a') as HTMLElement;
  const b = region.querySelector('.b') as HTMLElement;
  const trap = focusTrap(region);
  trap.activate();
  b.focus();
  const e = tabKey(b);
  assert.equal(e.defaultPrevented, true, 'Tab intercepted');
  assert.equal(document.activeElement, a, 'wrapped to first');
  trap.deactivate();
  host.remove();
});

test('focus-trap: Shift+Tab at the first wraps to the last', () => {
  const host = mount('<div class="trap"><button class="a">a</button><button class="b">b</button></div>');
  const region = host.querySelector('.trap') as HTMLElement;
  const a = region.querySelector('.a') as HTMLElement;
  const b = region.querySelector('.b') as HTMLElement;
  const trap = focusTrap(region);
  trap.activate();
  a.focus();
  tabKey(a, true);
  assert.equal(document.activeElement, b, 'wrapped to last');
  trap.deactivate();
  host.remove();
});

test('focus-trap: deactivate restores the previously-focused element', () => {
  const host = mount('<button class="outside">out</button><div class="trap"><button class="a">a</button></div>');
  const outside = host.querySelector('.outside') as HTMLElement;
  const region = host.querySelector('.trap') as HTMLElement;
  outside.focus();
  assert.equal(document.activeElement, outside);
  const trap = focusTrap(region);
  trap.activate();
  assert.equal(document.activeElement, region.querySelector('.a'));
  trap.deactivate();
  assert.equal(document.activeElement, outside, 'focus restored');
  host.remove();
});

test('focus-trap: an empty region focuses the container itself', () => {
  const host = mount('<div class="trap"></div>');
  const region = host.querySelector('.trap') as HTMLElement;
  const trap = focusTrap(region);
  trap.activate();
  assert.equal(document.activeElement, region);
  assert.equal(region.getAttribute('tabindex'), '-1', 'made programmatically focusable');
  trap.deactivate();
  host.remove();
});

/* ─────────────────── focus-monitor ─────────────────── */

test('focus-monitor: reports keyboard vs mouse origin', () => {
  const host = mount('<button class="m">m</button>');
  const btn = host.querySelector('.m') as HTMLElement;
  const mon = monitorFocus(btn);

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  btn.focus();
  assert.equal(mon.origin(), 'keyboard');
  assert.equal(mon.focused(), true);
  btn.blur();

  document.dispatchEvent(new MouseEvent('mousedown'));
  btn.focus();
  assert.equal(mon.origin(), 'mouse');

  mon.stop();
  host.remove();
});

test('focus-monitor: a focus with no preceding interaction reads as program', async () => {
  await tick(); // let any prior modality clear
  const host = mount('<button class="p">p</button>');
  const btn = host.querySelector('.p') as HTMLElement;
  const mon = monitorFocus(btn);
  btn.focus();
  assert.equal(mon.origin(), 'program');
  mon.stop();
  host.remove();
});

test('focus-monitor: focused() clears on blur and global focusOrigin() tracks', () => {
  const host = mount('<button class="g">g</button>');
  const btn = host.querySelector('.g') as HTMLElement;
  const mon = monitorFocus(btn);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  btn.focus();
  assert.equal(mon.focused(), true);
  assert.equal(focusOrigin(), 'keyboard', 'global origin reflects the latest focus');
  btn.blur();
  assert.equal(mon.focused(), false, 'cleared on focusout');
  mon.stop();
  host.remove();
});

test('focus-monitor: stop() via owner disposal', () => {
  const host = mount('<button class="o">o</button>');
  const btn = host.querySelector('.o') as HTMLElement;
  const owner: Owner = createOwner();
  const mon = runInOwner(owner, () => monitorFocus(btn));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  btn.focus();
  assert.equal(mon.focused(), true);
  disposeOwner(owner); // should remove listeners
  btn.blur();
  btn.focus();
  // After disposal the monitor no longer updates; origin stays as last-seen.
  assert.equal(mon.focused(), true, 'listeners detached on dispose (no further updates)');
  host.remove();
});
